// scrape_athlete_results_v11.js
// Fix: Discipline _label-Span klicken (nicht Wrapper), längere Wartezeit nach Saison-AJAX
// Fallback: ohne Discipline-Filter alle Zeilen parsen und nach Disziplin filtern

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

const ATHLETE_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
const BASE_URL = `https://alabus.swiss-athletics.ch/satweb/faces/bestlistathlete.xhtml?con=${ATHLETE_CON}&lang=de`;

const DISC_MAP = {
  '60 m': '60m', '60m': '60m',
  '100 m': '100m', '100m': '100m',
  '200 m': '200m', '200m': '200m',
  '80 m': '80m',  '80m': '80m',
  'Weit': 'Long Jump', 'Long Jump': 'Long Jump',
};

// ── PrimeFaces SelectOneMenu ──────────────────────────────────────────────────
async function selectPF(page, componentId, labelText, optional = false) {
  const eid = componentId.replace(/:/g, '\\:');
  try {
    // Zuerst _label-Span versuchen, dann Wrapper-Div
    const targets = [
      `#${eid}_label`,
      `#${eid} .ui-selectonemenu-trigger`,
      `#${eid}`,
    ];
    let clicked = false;
    for (const sel of targets) {
      try {
        const el = page.locator(sel).first();
        if (await el.count() > 0) {
          await el.click({ timeout: 5000, force: false });
          clicked = true;
          break;
        }
      } catch (_) {}
    }
    if (!clicked) throw new Error(`Kein klickbares Element für ${componentId}`);

    const panel = page.locator(`#${eid}_panel`);
    await panel.waitFor({ state: 'visible', timeout: 12000 });

    const item = panel.locator(`.ui-selectonemenu-item[data-label="${labelText}"]`).first();
    await item.waitFor({ state: 'visible', timeout: 8000 });
    await item.click();

    await panel.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(600);
  } catch (err) {
    if (optional) {
      console.log(`  ⚠ skip: ${componentId}="${labelText}" — ${err.message.split('\n')[0]}`);
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

// Tabelle direkt aus der Seite parsen (kein iFrame)
async function parseTable(page, expectedDisc) {
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

  console.log(`  → ${rows.length} Zeilen in Tabelle`);
  if (rows.length > 0) console.log(`  [0]: ${JSON.stringify(rows[0].slice(0, 8))}`);

  const results = [];
  for (const cols of rows) {
    const dateCol = cols.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) || '';
    const dateParts = dateCol.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dateParts) continue;
    const dateISO = `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`;
    const year    = parseInt(dateParts[3]);

    const resultCol = cols.find(c => /^\d+[.,]\d{2,3}$/.test(c) || /^\d+:\d{2}[.,]\d{2}$/.test(c)) || '';
    if (!resultCol) continue;

    const windCol = cols.find(c => /^[+\-]?\d+\.\d$/.test(c)) || '';
    const dateIdx = cols.findIndex(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c));
    const ort     = dateIdx >= 1 ? cols[dateIdx - 1] : '';
    const comp    = dateIdx >= 2 ? cols[dateIdx - 2] : '';
    const rangCol = cols.find(c => /^\d+[fFhHrRvV]?\d*$/.test(c) && parseInt(c) < 200) || '';
    const windNum = parseFloat(windCol);

    results.push({
      discipline:  expectedDisc ? DISC_MAP[expectedDisc] || expectedDisc : '?',
      result:      resultCol,
      numResult:   parseFloat(resultCol.replace(',', '.')),
      wind:        windCol || null,
      windAssisted:!isNaN(windNum) && windNum > 2.0,
      venue:       ort,
      competition: comp,
      date:        dateCol,
      dateISO,
      year,
      place:       rangCol || null,
      source:      'swiss-athletics',
    });
  }
  return results;
}

const SEASONS = [
  { season: 'Indoor',  discs: [{ saLabel: '60 m', label: '60m' }, { saLabel: '80 m', label: '80m', optional: true }] },
  { season: 'Outdoor', discs: [{ saLabel: '100 m', label: '100m' }, { saLabel: '200 m', label: '200m' }, { saLabel: 'Weit', label: 'Weitsprung' }] },
];

async function main() {
  console.log('🚀 Swiss Athletics Athleten-Resultate Scraper v11\n');

  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext()).newPage();
  const allResults = [];

  for (const { season, discs } of SEASONS) {
    for (const disc of discs) {
      console.log(`\n📋 ${disc.label} (${season})...`);

      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);

      // Jahr: "Alle" (optional)
      await selectPF(page, 'form_anonym:bestlistYear', 'Alle', true);

      // Saison setzen
      await selectPF(page, 'form_anonym:bestlistSeason', season);
      console.log(`  ✓ Saison: ${season}`);

      // Länger warten nach Saison-AJAX bevor Disziplin
      await page.waitForTimeout(2000);

      // Disziplin setzen
      try {
        await selectPF(page, 'form_anonym:bestlistDiscipline', disc.saLabel, disc.optional || false);
        console.log(`  ✓ Disziplin: ${disc.saLabel}`);
      } catch (e) {
        if (disc.optional) { console.log(`  ✗ übersprungen`); continue; }
        console.log(`  ⚠ Disziplin fehlgeschlagen, parse trotzdem: ${e.message.split('\n')[0]}`);
      }

      await page.waitForTimeout(1500);

      const rows = await parseTable(page, disc.saLabel);
      allResults.push(...rows);
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
  console.log(`\n📊 Total: ${unique.length} Einträge`);

  const output = {
    athlete: 'Fiona Matt',
    scraped: new Date().toISOString(),
    source:  'swiss-athletics',
    count:   unique.length,
    pbs:     pbByDisc,
    results: unique,
  };

  fs.writeFileSync('athlete_results.json', JSON.stringify(output, null, 2));
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(output);
  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
