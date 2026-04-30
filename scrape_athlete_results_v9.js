// scrape_athlete_results_v9.js — Playwright wie bestenliste scraper

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
  { saLabel: 'Weit',  season: 'Outdoor', label: 'Weitsprung'  },
];

const SEL = {
  year:   '#form_anonym\\:bestlistYear_input',
  season: '#form_anonym\\:bestlistSeason_input',
  disc:   '#form_anonym\\:bestlistDiscipline_input',
  type:   '#form_anonym\\:bestlistType_input',
  tops:   '#form_anonym\\:bestlistTops_input',
};

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

  // Jahr: Alle
  await page.selectOption(SEL.year, { index: 0 }).catch(() => {});
  await page.waitForTimeout(600);

  // Saison
  await page.selectOption(SEL.season, { label: combo.season });
  await page.waitForTimeout(800);

  // Disziplin
  try {
    await page.selectOption(SEL.disc, { label: combo.saLabel });
  } catch(e) {
    console.log(`  ✗ Disziplin "${combo.saLabel}" nicht gefunden`);
    return [];
  }
  await page.waitForTimeout(600);

  // Typ: Alle Resultate
  await page.selectOption(SEL.type, { index: 0 }).catch(() => {});
  await page.waitForTimeout(400);

  // Max Anzahl
  const topsOptions = await page.locator(`${SEL.tops} option`).all();
  if (topsOptions.length > 0) {
    await page.selectOption(SEL.tops, { index: topsOptions.length - 1 }).catch(() => {});
  }
  await page.waitForTimeout(400);

  // Anzeigen
  await page.locator('input[type=submit][value*=Anzeigen], button:has-text("Anzeigen")').first().click();
  await page.waitForTimeout(3000);

  // iFrame
  let frame = null;
  for (const f of page.frames()) {
    if (f.url().includes('bestlistathlete') || f.url().includes('alabus')) { frame = f; break; }
  }
  if (!frame) {
    const el = await page.$('iframe');
    if (el) frame = await el.contentFrame();
  }
  if (!frame) { console.log('  ✗ Kein iFrame'); return []; }
  await frame.waitForTimeout(2000);

  // Rows parsen
  const rows = await frame.evaluate(() => {
    const trs = document.querySelectorAll('table tr');
    const result = [];
    for (const tr of trs) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 4) continue;
      const cols = Array.from(tds).map(td =>
        td.textContent.trim().replace(/^(Nr|Resultat|Wind|Rang|Name|Verein|Nat\.|Geb\. Dat\.|Wettkampf|Ort|Datum|Punkte)/, '').trim()
      );
      // Zeilen mit Datum (dd.mm.yyyy)
      if (cols.some(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c))) result.push(cols);
    }
    return result;
  });

  console.log(`  → ${rows.length} Zeilen`);
  if (rows.length > 0) console.log(`  [0]: ${JSON.stringify(rows[0].slice(0,8))}`);

  // Parsen
  const results = [];
  for (const cols of rows) {
    // Datum finden
    const dateCol = cols.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) || '';
    const dateParts = dateCol.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const dateISO = dateParts ? `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}` : '';
    const year    = dateParts ? parseInt(dateParts[3]) : 0;

    // Resultat (erste Zahl die wie Zeit/Weite aussieht)
    const resultCol = cols.find(c => /^\d+[.:]\d+$/.test(c) || /^\d+\.\d{2}$/.test(c)) || '';
    if (!resultCol || !dateCol) continue;

    // Wind
    const windCol = cols.find(c => /^[+-]?\d+\.\d$/.test(c)) || '';

    // Ort
    const ortIdx = cols.findIndex(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) - 1;
    const ort = ortIdx >= 0 ? cols[ortIdx] : '';

    // Wettkampf
    const compIdx = ortIdx - 1;
    const comp = compIdx >= 0 ? cols[compIdx] : '';

    // Rang
    const rangCol = cols.find(c => /^\d+[fFhHrRvV]\d*$/.test(c)) || '';

    const numResult = parseFloat(resultCol.replace(',', '.'));
    const windNum   = parseFloat(windCol);

    results.push({
      discipline:      DISC_MAP[combo.saLabel] || combo.saLabel,
      disciplineLabel: combo.label,
      result:          resultCol,
      numResult,
      wind:            windCol,
      windAssisted:    !isNaN(windNum) && windNum > 2.0,
      indoor:          combo.season === 'Indoor',
      venue:           ort,
      competition:     comp,
      date:            dateCol,
      dateISO,
      year,
      place:           rangCol,
      source:          'swiss-athletics',
    });
  }

  return results;
}

async function main() {
  console.log('🚀 Swiss Athletics Athleten-Resultate Scraper v9\n');

  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext()).newPage();

  const allResults = [];

  for (const combo of COMBOS) {
    const rows = await scrapeCombo(page, combo);
    allResults.push(...rows);
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

  console.log('\nPBs:');
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

  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(output);
  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
