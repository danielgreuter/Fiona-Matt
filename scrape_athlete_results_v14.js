// scrape_athlete_results_v14.js
// Fix: jQuery .trigger('change') statt nativer dispatchEvent
// Fix: 80m entfernt (existiert nicht als Option)
// Debug: PrimeFaces widget-Keys loggen

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

const SEASONS = [
  { season: 'Indoor',  discs: ['60 m'] },
  { season: 'Outdoor', discs: ['100 m', '200 m', 'Weit'] },
];

// ── PrimeFaces via Klick (funktioniert für Saison) ───────────────────────────
async function selectPF(page, componentId, labelText, optional = false) {
  const eid = componentId.replace(/:/g, '\\:');
  try {
    await page.click(`#${eid}`, { timeout: 8000 });
    const panel = page.locator(`#${eid}_panel`);
    await panel.waitFor({ state: 'visible', timeout: 10000 });
    await panel.locator(`.ui-selectonemenu-item[data-label="${labelText}"]`).first().click();
    await panel.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(800);
  } catch (err) {
    if (optional) { console.log(`  ⚠ skip ${labelText}`); return; }
    throw err;
  }
}

// ── Disziplin via jQuery-Trigger (PrimeFaces hört auf jQuery-Events) ─────────
async function selectDiscViaJQ(page, rawId, labelText) {
  const result = await page.evaluate(({ id, label }) => {
    const inputEl = document.getElementById(id + '_input');
    const labelEl = document.getElementById(id + '_label');
    if (!inputEl) return 'ERR:no input';

    // PrimeFaces widget-Keys für Debug
    const wKeys = Object.keys(window.PrimeFaces && window.PrimeFaces.widgets || {}).join('|');

    // Option setzen
    let found = false;
    for (let i = 0; i < inputEl.options.length; i++) {
      if (inputEl.options[i].text === label) {
        inputEl.selectedIndex = i;
        if (labelEl) labelEl.textContent = label;
        found = true;
        break;
      }
    }
    if (!found) return 'ERR:option not found|widgets:' + wKeys;

    // Variante A: PrimeFaces widget direkt
    try {
      const w = window.PrimeFaces && window.PrimeFaces.widgets &&
        Object.values(window.PrimeFaces.widgets).find(w => w && w.id && w.id.includes('Discipline'));
      if (w && typeof w.triggerChange === 'function') {
        w.triggerChange(true); return 'A:triggerChange';
      }
      if (w && typeof w.callBehavior === 'function') {
        w.callBehavior('change'); return 'A:callBehavior';
      }
    } catch(e) {}

    // Variante B: jQuery trigger (PrimeFaces nutzt jQuery für Events)
    try {
      const jq = window.$ || window.jQuery;
      if (jq) {
        jq(inputEl).trigger('change');
        return 'B:jquery.trigger|widgets:' + wKeys;
      }
    } catch(e) {}

    // Variante C: Faces.ajax / PrimeFaces.ajax.Request
    try {
      if (window.PrimeFaces && window.PrimeFaces.ajax) {
        window.PrimeFaces.ajax.Request.handle({
          source: id,
          process: id,
          update: '@form',
          event: 'change'
        });
        return 'C:pf.ajax.Request';
      }
    } catch(e) {}

    return 'D:fallback-no-ajax|widgets:' + wKeys;
  }, { id: rawId, label: labelText });

  console.log(`  JS: ${result}`);
  await page.waitForTimeout(800);
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return result;
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

async function parseTable(page, discLabel) {
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
      venue:        dateIdx >= 1 ? cols[dateIdx - 1] : '',
      competition:  dateIdx >= 2 ? cols[dateIdx - 2] : '',
      date: dateCol, dateISO, year: parseInt(dateParts[3]),
      place: cols.find(c => /^\d+[fFhHrRvV]?\d*$/.test(c) && parseInt(c) < 200) || null,
      source: 'swiss-athletics',
    };
  }).filter(Boolean);
}

async function main() {
  console.log('🚀 Swiss Athletics Athleten-Resultate Scraper v14\n');
  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext()).newPage();
  const allResults = [];

  for (const { season, discs } of SEASONS) {
    for (const discLabel of discs) {
      console.log(`\n📋 ${DISC_MAP[discLabel]} (${season})...`);

      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);

      await selectPF(page, 'form_anonym:bestlistYear', 'Alle', true);

      try {
        await selectPF(page, 'form_anonym:bestlistSeason', season);
        console.log(`  ✓ Saison: ${season}`);
      } catch(e) {
        console.log(`  ❌ Saison: ${e.message.split('\n')[0]}`); continue;
      }

      await selectDiscViaJQ(page, 'form_anonym:bestlistDiscipline', discLabel);
      await selectPF(page, 'form_anonym:bestlistType', 'Alle Resultate', true);
      await page.waitForTimeout(1500);

      const rows = await parseTable(page, discLabel);
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
