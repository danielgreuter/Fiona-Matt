// scrape_athlete_results_v12.js
// Strategie: PrimeFaces-Widget direkt per JS aufrufen statt UI-Click
// Saison via selectPF (funktioniert), Disziplin via widget.select()

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

// ── PrimeFaces SelectOneMenu via Klick (für Saison, funktioniert) ────────────
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

// ── PrimeFaces-Widget direkt per JS aufrufen (für Disziplin) ────────────────
async function selectPFviaJS(page, componentId, labelText) {
  const result = await page.evaluate(({ cid, label }) => {
    // Variante 1: PrimeFaces.widgets Map durchsuchen
    const widgets = window.PrimeFaces && window.PrimeFaces.widgets;
    if (widgets) {
      for (const [key, w] of Object.entries(widgets)) {
        if (!key.includes('Discipline') && !key.includes('bestlistDisc')) continue;
        const panel = document.querySelector(`#${w.id}_panel`);
        if (!panel) continue;
        const items = panel.querySelectorAll('.ui-selectonemenu-item');
        for (const item of items) {
          if (item.getAttribute('data-label') === label) {
            if (typeof w.select === 'function') { w.select(item); return 'widget.select: ' + label; }
          }
        }
      }
    }

    // Variante 2: Direkter Klick via JS auf das Item (Panel temporär einblenden)
    const panelEl = document.getElementById(cid + '_panel');
    const inputEl = document.getElementById(cid + '_input');
    const labelEl = document.getElementById(cid + '_label');
    if (!panelEl) return 'no panel';

    // Panel sichtbar machen
    panelEl.style.display = 'block';
    panelEl.classList.remove('ui-helper-hidden');
    panelEl.style.visibility = 'visible';
    panelEl.style.zIndex = '9999';

    // Item finden und klicken
    const items = panelEl.querySelectorAll('.ui-selectonemenu-item');
    for (const item of items) {
      if (item.getAttribute('data-label') === label) {
        // Native select aktualisieren
        if (inputEl) {
          const opts = inputEl.options;
          for (let i = 0; i < opts.length; i++) {
            if (opts[i].text === label) { inputEl.selectedIndex = i; break; }
          }
          // Change-Event feuern
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // Label aktualisieren
        if (labelEl) labelEl.textContent = label;
        // Panel verstecken
        panelEl.classList.add('ui-helper-hidden');
        panelEl.style.display = 'none';
        // PrimeFaces AJAX über jsf.ajax.request triggern
        try {
          const form = inputEl ? inputEl.closest('form') : null;
          if (form && window.jsf) {
            jsf.ajax.request(inputEl, null, { execute: '@form', render: '@form' });
            return 'jsf.ajax: ' + label;
          }
        } catch(e) {}
        return 'click-and-change: ' + label;
      }
    }
    return 'item not found: ' + label;
  }, { cid: componentId.replace(/\\/g, ''), label: labelText });

  console.log(`  JS select: ${result}`);

  // Nach JS-Manipulation kurz warten und dann auf AJAX warten
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1000);
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
    const dateCol = cols.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) || '';
    const dateParts = dateCol.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dateParts) continue;
    const dateISO = `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`;
    const year    = parseInt(dateParts[3]);
    const resultCol = cols.find(c => /^\d+[.,]\d{2,3}$/.test(c)) || '';
    if (!resultCol) continue;
    const windCol = cols.find(c => /^[+\-]?\d+\.\d$/.test(c)) || '';
    const dateIdx = cols.findIndex(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c));
    const ort  = dateIdx >= 1 ? cols[dateIdx - 1] : '';
    const comp = dateIdx >= 2 ? cols[dateIdx - 2] : '';
    const rangCol = cols.find(c => /^\d+[fFhHrRvV]?\d*$/.test(c) && parseInt(c) < 200) || '';
    const windNum = parseFloat(windCol);
    results.push({
      discipline:   DISC_MAP[discLabel] || discLabel,
      result:       resultCol,
      numResult:    parseFloat(resultCol.replace(',', '.')),
      wind:         windCol || null,
      windAssisted: !isNaN(windNum) && windNum > 2.0,
      venue: dateIdx >= 1 ? cols[dateIdx - 1] : '',
      competition: dateIdx >= 2 ? cols[dateIdx - 2] : '',
      date: dateCol, dateISO, year,
      place: rangCol || null,
      source: 'swiss-athletics',
    });
  }
  return results;
}

async function main() {
  console.log('🚀 Swiss Athletics Athleten-Resultate Scraper v12\n');
  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext()).newPage();
  const allResults = [];

  for (const { season, discs } of SEASONS) {
    for (const discLabel of discs) {
      console.log(`\n📋 ${DISC_MAP[discLabel] || discLabel} (${season})...`);

      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);

      // Jahr: Alle (optional)
      await selectPF(page, 'form_anonym:bestlistYear', 'Alle', true);

      // Saison (funktioniert zuverlässig)
      try {
        await selectPF(page, 'form_anonym:bestlistSeason', season);
        console.log(`  ✓ Saison: ${season}`);
      } catch(e) {
        console.log(`  ❌ Saison failed: ${e.message.split('\n')[0]}`);
        continue;
      }

      // Disziplin via JS-Widget
      await selectPFviaJS(page, 'form_anonym:bestlistDiscipline', discLabel);

      // Typ: Alle Resultate (optional)
      await selectPF(page, 'form_anonym:bestlistType', 'Alle Resultate', true);

      await page.waitForTimeout(1500);
      const rows = await parseTable(page, discLabel);
      if (rows.length === 0 && discLabel !== '80 m') {
        console.log(`  ⚠ 0 Zeilen — Disziplin-Filter evtl. nicht gesetzt`);
      }
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
