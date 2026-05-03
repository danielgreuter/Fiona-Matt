// scrape_athlete_results_v16.js
// Fix: Kategorie wählen + Anzeigen-Button klicken (fehlten bisher komplett)

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

const ATHLETE_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
const BASE_URL = `https://alabus.swiss-athletics.ch/satweb/faces/bestlistathlete.xhtml?con=${ATHLETE_CON}&lang=de`;

const DISC_MAP = {
  '60 m': '60m', '100 m': '100m', '200 m': '200m', 'Weit': 'Long Jump',
};

// Fionas Kategorie nach Jahr (geb. 02.09.2009)
// U18 = 16-17 Jahre, U16 = 14-15 Jahre, U14 = 12-13 Jahre
function categoryForYear(year) {
  const age = year - 2009;
  if (age >= 16 && age <= 17) return 'U18 Frauen';
  if (age >= 14 && age <= 15) return 'U16 Frauen';
  if (age >= 12 && age <= 13) return 'U14 Frauen';
  return 'U18 Frauen'; // Fallback
}

const COMBOS = [
  { season: 'Indoor',  disc: '60 m'  },
  { season: 'Outdoor', disc: '100 m' },
  { season: 'Outdoor', disc: '200 m' },
  { season: 'Outdoor', disc: 'Weit'  },
];

const YEARS = [2026, 2025, 2024];

// ── PrimeFaces SelectOneMenu via Klick ────────────────────────────────────────
async function selectPF(page, componentId, labelText, optional = false) {
  const eid = componentId.replace(/:/g, '\\:');
  try {
    await page.click(`#${eid}`, { timeout: 8000 });
    const panel = page.locator(`#${eid}_panel`);
    await panel.waitFor({ state: 'visible', timeout: 10000 });
    await panel.locator(`.ui-selectonemenu-item[data-label="${labelText}"]`).first().click();
    await panel.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(600);
  } catch (err) {
    if (optional) { console.log(`  ⚠ skip "${labelText}"`); return false; }
    throw err;
  }
  return true;
}

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/results:fiona:sa`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '✅ KV OK' : `❌ KV ${res.status}`);
}

async function parseTable(page, discLabel, year) {
  const rows = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('table tbody tr, table tr')];
    const result = [];
    for (const tr of trs) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 4) continue;
      const cols = Array.from(tds).map(td => td.textContent.trim());
      if (cols.some(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c))) result.push(cols);
    }
    return result;
  });

  console.log(`  → ${rows.length} Zeilen`);
  if (rows.length > 0) console.log(`  [0]: ${JSON.stringify(rows[0].slice(0, 8))}`);

  return rows.map(cols => {
    const dateCol   = cols.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) || '';
    const dateParts = dateCol.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dateParts) return null;
    const rowYear   = parseInt(dateParts[3]);
    if (rowYear !== year) return null; // Nur das gesuchte Jahr
    const dateISO   = `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`;
    const resultCol = cols.find(c => /^\d+[.,]\d{2,3}$/.test(c)) || '';
    if (!resultCol) return null;
    const windCol   = cols.find(c => /^[+\-]?\d+\.\d$/.test(c)) || '';
    const dateIdx   = cols.findIndex(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c));
    const windNum   = parseFloat(windCol);
    return {
      discipline:   DISC_MAP[discLabel] || discLabel,
      result:       resultCol,
      numResult:    parseFloat(resultCol.replace(',', '.')),
      wind:         windCol || null,
      windAssisted: !isNaN(windNum) && windNum > 2.0,
      indoor:       false, // wird weiter unten gesetzt
      venue:        dateIdx >= 1 ? cols[dateIdx - 1] : '',
      competition:  dateIdx >= 2 ? cols[dateIdx - 2] : '',
      date: dateCol, dateISO, year: rowYear,
      place: cols.find(c => /^\d+[fFhHrRvV]?\d*$/.test(c) && parseInt(c) < 200) || null,
      source: 'swiss-athletics',
    };
  }).filter(Boolean);
}

async function main() {
  console.log('🚀 Swiss Athletics Athleten-Resultate Scraper v16\n');
  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext()).newPage();
  const allResults = [];

  for (const year of YEARS) {
    const cat = categoryForYear(year);
    console.log(`\n📅 Jahr ${year} (${cat})`);

    for (const { season, disc } of COMBOS) {
      console.log(`\n  📋 ${DISC_MAP[disc]} ${season}...`);

      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1200);

      // Jahr
      await selectPF(page, 'form_anonym:bestlistYear', String(year), true);

      // Saison
      const seasonOk = await selectPF(page, 'form_anonym:bestlistSeason', season);
      if (!seasonOk) { console.log('  ✗ Saison fehlgeschlagen'); continue; }
      console.log(`  ✓ Saison: ${season}`);

      // Kategorie ← NEU
      const catOk = await selectPF(page, 'form_anonym:bestlistCategory', cat, true);
      if (catOk) console.log(`  ✓ Kategorie: ${cat}`);

      // Disziplin
      const discOk = await selectPF(page, 'form_anonym:bestlistDiscipline', disc);
      if (!discOk) { console.log('  ✗ Disziplin fehlgeschlagen'); continue; }
      console.log(`  ✓ Disziplin: ${disc}`);

      // Typ: Alle Resultate (optional)
      await selectPF(page, 'form_anonym:bestlistType', 'Alle Resultate', true);

      // ← NEU: Anzeigen-Button klicken
      try {
        await page.locator('input[type=submit][value*=Anzeigen], button:has-text("Anzeigen")').first().click({ timeout: 5000 });
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(1500);
        console.log('  ✓ Anzeigen geklickt');
      } catch(e) {
        console.log(`  ⚠ Anzeigen-Button nicht gefunden: ${e.message.split('\n')[0]}`);
      }

      const rows = await parseTable(page, disc, year);
      rows.forEach(r => { r.indoor = season === 'Indoor'; });
      allResults.push(...rows);
    }
  }

  await browser.close();

  const seen = new Set();
  const unique = allResults.filter(r => {
    const k = `${r.discipline}|${r.date}|${r.result}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  }).sort((a, b) => b.dateISO.localeCompare(a.dateISO));

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
  console.log(`📊 Total: ${unique.length} Einträge`);

  const output = { athlete:'Fiona Matt', scraped:new Date().toISOString(),
    source:'swiss-athletics', count:unique.length, pbs:pbByDisc, results:unique };
  fs.writeFileSync('athlete_results.json', JSON.stringify(output, null, 2));
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(output);
  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
