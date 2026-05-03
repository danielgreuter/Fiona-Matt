// scrape_athlete_results_v10.js
// Fix: selectPF() statt page.selectOption() für PrimeFaces JSF Dropdowns
// Fix: Kein iFrame — Tabelle direkt auf der Seite

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

const ATHLETE_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
const BASE_URL = `https://alabus.swiss-athletics.ch/satweb/faces/bestlistathlete.xhtml?con=${ATHLETE_CON}&lang=de`;

const DISC_MAP = {
  '60 m': '60m', '100 m': '100m', '200 m': '200m',
  '80 m': '80m', 'Weit': 'Long Jump',
};

const COMBOS = [
  { saLabel: '60 m',  season: 'Indoor',  label: '60m Indoor'  },
  { saLabel: '100 m', season: 'Outdoor', label: '100m'        },
  { saLabel: '200 m', season: 'Outdoor', label: '200m'        },
  { saLabel: '80 m',  season: 'Outdoor', label: '80m',         optional: true },
  { saLabel: 'Weit',  season: 'Outdoor', label: 'Weitsprung'  },
];

// ── PrimeFaces SelectOneMenu — identisch wie bestenliste scraper v4 ──────────
async function selectPF(page, componentId, labelText, optional = false) {
  const eid = componentId.replace(/:/g, '\\:');
  try {
    // Sichtbaren Wrapper anklicken → öffnet Panel
    await page.click(`#${eid}`, { timeout: 10000 });

    // Panel abwarten
    const panel = page.locator(`#${eid}_panel`);
    await panel.waitFor({ state: 'visible', timeout: 10000 });

    // Item per data-label suchen und klicken
    const item = panel.locator(`.ui-selectonemenu-item[data-label="${labelText}"]`).first();
    await item.waitFor({ state: 'visible', timeout: 10000 });
    await item.click();

    // Panel schliessen abwarten (= AJAX ausgelöst)
    await panel.waitFor({ state: 'hidden', timeout: 10000 });

    // AJAX abwarten
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  } catch (err) {
    if (optional) {
      console.log(`  ⚠ selectPF optional skip: ${componentId} = "${labelText}" — ${err.message.split('\n')[0]}`);
    } else {
      throw err;
    }
  }
}

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/results:fiona:sa`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '✅ KV OK' : `❌ KV Fehler ${res.status}`);
}

async function scrapeCombo(page, combo) {
  console.log(`\n📋 ${combo.label}...`);

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  // Jahr: "Alle" (erster Eintrag im Panel, optional)
  await selectPF(page, 'form_anonym:bestlistYear', 'Alle', true);

  // Saison
  await selectPF(page, 'form_anonym:bestlistSeason', combo.season);
  console.log(`  ✓ Saison: ${combo.season}`);

  // Disziplin
  try {
    await selectPF(page, 'form_anonym:bestlistDiscipline', combo.saLabel);
    console.log(`  ✓ Disziplin: ${combo.saLabel}`);
  } catch (e) {
    if (combo.optional) {
      console.log(`  ✗ Disziplin "${combo.saLabel}" nicht gefunden — übersprungen`);
      return [];
    }
    throw e;
  }

  // Typ: "Alle Resultate" (index 0, optional)
  await selectPF(page, 'form_anonym:bestlistType', 'Alle Resultate', true);

  // Anzahl maximieren (optional)
  await selectPF(page, 'form_anonym:bestlistTops', '30', true);

  // Kurz warten — AJAX hat bereits gefeuert nach jedem selectPF
  await page.waitForTimeout(1500);

  // Tabelle direkt aus der Hauptseite lesen (kein iFrame!)
  const rows = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('table tbody tr, table tr')];
    const result = [];
    for (const tr of trs) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 4) continue;
      const cols = Array.from(tds).map(td => td.textContent.trim());
      // Nur Zeilen mit Datum (dd.mm.yyyy)
      if (cols.some(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c))) result.push(cols);
    }
    return result;
  });

  console.log(`  → ${rows.length} Zeilen`);
  if (rows.length > 0) console.log(`  [0]: ${JSON.stringify(rows[0].slice(0, 8))}`);

  // Parsen
  const results = [];
  for (const cols of rows) {
    const dateCol = cols.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) || '';
    const dateParts = dateCol.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const dateISO = dateParts ? `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}` : '';
    const year    = dateParts ? parseInt(dateParts[3]) : 0;

    // Resultat: erste Zahl die wie Zeit oder Weite aussieht
    const resultCol = cols.find(c => /^\d+[.,]\d{2,3}$/.test(c) || /^\d+:\d{2}[.,]\d{2}$/.test(c)) || '';
    if (!resultCol || !dateCol) continue;

    // Wind: Dezimalzahl mit Vorzeichen
    const windCol = cols.find(c => /^[+\-]?\d+\.\d$/.test(c)) || '';

    const dateIdx = cols.findIndex(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c));
    const ort  = dateIdx >= 1 ? cols[dateIdx - 1] : '';
    const comp = dateIdx >= 2 ? cols[dateIdx - 2] : '';

    // Rang: z.B. "1", "1f", "2F"
    const rangCol = cols.find(c => /^\d+[fFhHrRvV]?\d*$/.test(c) && parseInt(c) < 200) || '';

    const numResult = parseFloat(resultCol.replace(',', '.'));
    const windNum   = parseFloat(windCol);

    results.push({
      discipline:      DISC_MAP[combo.saLabel] || combo.saLabel,
      disciplineLabel: combo.label,
      result:          resultCol,
      numResult,
      wind:            windCol || null,
      windAssisted:    !isNaN(windNum) && windNum > 2.0,
      indoor:          combo.season === 'Indoor',
      venue:           ort,
      competition:     comp,
      date:            dateCol,
      dateISO,
      year,
      place:           rangCol || null,
      source:          'swiss-athletics',
    });
  }

  return results;
}

async function main() {
  console.log('🚀 Swiss Athletics Athleten-Resultate Scraper v10\n');
  console.log(`URL: ${BASE_URL}\n`);

  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext()).newPage();

  const allResults = [];

  for (const combo of COMBOS) {
    try {
      const rows = await scrapeCombo(page, combo);
      allResults.push(...rows);
    } catch (e) {
      console.error(`  ❌ ${combo.label}: ${e.message}`);
    }
  }

  await browser.close();

  // Deduplizieren + sortieren
  const seen = new Set();
  const unique = allResults.filter(r => {
    const key = `${r.discipline}|${r.date}|${r.result}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => b.dateISO.localeCompare(a.dateISO));

  // PBs
  const pbByDisc = {};
  unique.forEach(r => {
    if (r.windAssisted) return;
    const isJump = r.discipline === 'Long Jump';
    const ex = pbByDisc[r.discipline];
    const better = !ex || (isJump ? r.numResult > ex.numResult : r.numResult < ex.numResult);
    if (better) pbByDisc[r.discipline] = r;
  });

  console.log('\n📊 PBs:');
  Object.entries(pbByDisc).forEach(([d, r]) => console.log(`  ${d}: ${r.result} (${r.date})`));

  const output = {
    athlete: 'Fiona Matt',
    scraped: new Date().toISOString(),
    source:  'swiss-athletics',
    count:   unique.length,
    pbs:     pbByDisc,
    results: unique,
  };

  fs.writeFileSync('athlete_results.json', JSON.stringify(output, null, 2));
  console.log(`\n💾 athlete_results.json (${unique.length} Einträge)`);

  if (UPLOAD && CF_ACCOUNT_ID) {
    await uploadKV(output);
  }
  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
