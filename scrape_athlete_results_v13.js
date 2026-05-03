// scrape_athlete_results_v13.js
// Fix: getElementById statt querySelector (Doppelpunkt in ID bricht querySelector)

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

const ATHLETE_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
const BASE_URL = `https://alabus.swiss-athletics.ch/satweb/faces/bestlistathlete.xhtml?con=${ATHLETE_CON}&lang=de`;

const DISC_MAP = {
  '60 m': '60m', '100 m': '100m', '200 m': '200m', '80 m': '80m', 'Weit': 'Long Jump',
};

const SEASONS = [
  { season: 'Indoor',  discs: ['60 m', '80 m'] },
  { season: 'Outdoor', discs: ['100 m', '200 m', 'Weit'] },
];

// ── PrimeFaces via Klick (Saison) ────────────────────────────────────────────
async function selectPF(page, componentId, labelText, optional = false) {
  const eid = componentId.replace(/:/g, '\\:');
  try {
    await page.click(`#${eid}`, { timeout: 8000 });
    const panel = page.locator(`#${eid}_panel`);
    await panel.waitFor({ state: 'visible', timeout: 10000 });
    const item = panel.locator(`.ui-selectonemenu-item[data-label="${labelText}"]`).first();
    await item.waitFor({ state: 'visible', timeout: 8000 });
    await item.click();
    await panel.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(800);
  } catch (err) {
    if (optional) { console.log(`  ⚠ skip ${componentId}="${labelText}"`); return; }
    throw err;
  }
}

// ── PrimeFaces Disziplin via JS — getElementById statt querySelector ──────────
async function selectDiscViaJS(page, rawId, labelText) {
  const result = await page.evaluate(({ id, label }) => {
    const panelEl = document.getElementById(id + '_panel');
    const inputEl = document.getElementById(id + '_input');
    const labelEl = document.getElementById(id + '_label');

    if (!panelEl) return 'ERR: no panel element with id=' + id + '_panel';

    // Variante A: PrimeFaces widget API
    try {
      const widgets = window.PrimeFaces && window.PrimeFaces.widgets;
      if (widgets) {
        for (const [, w] of Object.entries(widgets)) {
          if (!w || !w.id || !w.id.includes('Discipline')) continue;
          const panel2 = document.getElementById(w.id + '_panel');
          if (!panel2) continue;
          const items = panel2.querySelectorAll('.ui-selectonemenu-item');
          for (const item of items) {
            if (item.getAttribute('data-label') === label) {
              if (typeof w.select === 'function') { w.select(item); return 'A:widget.select:' + label; }
            }
          }
        }
      }
    } catch(e) {}

    // Variante B: native select + jsf.ajax.request
    if (inputEl) {
      for (let i = 0; i < inputEl.options.length; i++) {
        if (inputEl.options[i].text === label) {
          inputEl.selectedIndex = i;
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          if (labelEl) labelEl.textContent = label;
          // JSF AJAX
          try {
            if (window.jsf) {
              window.jsf.ajax.request(inputEl, null, {
                execute: inputEl.closest('form') ? inputEl.closest('form').id : '@form',
                render: '@form'
              });
              return 'B:jsf.ajax:' + label;
            }
          } catch(e2) {}
          return 'B:change-only:' + label;
        }
      }
      return 'B:option not found. Available: ' + Array.from(inputEl.options).map(o=>o.text).join('|');
    }

    return 'ERR: no input element';
  }, { id: rawId, label: labelText });

  console.log(`  JS: ${result}`);
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1000);
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

  const results = [];
  for (const cols of rows) {
    const dateCol  = cols.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) || '';
    const dateParts = dateCol.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dateParts) continue;
    const dateISO  = `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`;
    const year     = parseInt(dateParts[3]);
    const resultCol = cols.find(c => /^\d+[.,]\d{2,3}$/.test(c)) || '';
    if (!resultCol) continue;
    const windCol  = cols.find(c => /^[+\-]?\d+\.\d$/.test(c)) || '';
    const dateIdx  = cols.findIndex(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c));
    const windNum  = parseFloat(windCol);
    results.push({
      discipline:   DISC_MAP[discLabel] || discLabel,
      result:       resultCol,
      numResult:    parseFloat(resultCol.replace(',', '.')),
      wind:         windCol || null,
      windAssisted: !isNaN(windNum) && windNum > 2.0,
      venue:        dateIdx >= 1 ? cols[dateIdx - 1] : '',
      competition:  dateIdx >= 2 ? cols[dateIdx - 2] : '',
      date: dateCol, dateISO, year,
      place: cols.find(c => /^\d+[fFhHrRvV]?\d*$/.test(c) && parseInt(c) < 200) || null,
      source: 'swiss-athletics',
    });
  }
  return results;
}

async function main() {
  console.log('🚀 Swiss Athletics Athleten-Resultate Scraper v13\n');
  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext()).newPage();
  const allResults = [];

  for (const { season, discs } of SEASONS) {
    for (const discLabel of discs) {
      const isOptional = discLabel === '80 m';
      console.log(`\n📋 ${DISC_MAP[discLabel] || discLabel} (${season})...`);

      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);

      // Jahr: Alle (optional)
      await selectPF(page, 'form_anonym:bestlistYear', 'Alle', true);

      // Saison (funktioniert)
      try {
        await selectPF(page, 'form_anonym:bestlistSeason', season);
        console.log(`  ✓ Saison: ${season}`);
      } catch(e) {
        console.log(`  ❌ Saison: ${e.message.split('\n')[0]}`);
        if (!isOptional) allResults; // continue
        continue;
      }

      // Disziplin via JS
      const jsResult = await selectDiscViaJS(page, 'form_anonym:bestlistDiscipline', discLabel);
      if (jsResult.startsWith('ERR') || jsResult.includes('not found')) {
        if (isOptional) continue;
        console.log(`  ⚠ Disziplin-JS fehlgeschlagen: ${jsResult}`);
      }

      // Typ: Alle Resultate (optional)
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
