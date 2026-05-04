// scrape_athlete_results_v22.js
// Fix: PrimeFaces.ab() direkt aufrufen + JSF-Partial-Response loggen

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

const ATHLETE_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
const BASE_URL = `https://alabus.swiss-athletics.ch/satweb/faces/bestlistathlete.xhtml?con=${ATHLETE_CON}&lang=de`;

const DISC_MAP = { '60 m':'60m','100 m':'100m','200 m':'200m','Weit':'Long Jump' };

function categoryForYear(year) {
  const age = year - 2009;
  if (age >= 16) return 'U18 Frauen';
  if (age >= 14) return 'U16 Frauen';
  return 'U14 Frauen';
}

const COMBOS = [
  { season:'Indoor',  disc:'60 m'  },
  { season:'Outdoor', disc:'100 m' },
  { season:'Outdoor', disc:'200 m' },
  { season:'Outdoor', disc:'Weit'  },
];

const YEARS = [2026, 2025, 2024];

async function selectPF(page, componentId, labelText, optional = false) {
  const eid = componentId.replace(/:/g, '\\:');
  try {
    await page.click(`#${eid}`, { timeout: 8000 });
    const panel = page.locator(`#${eid}_panel`);
    await panel.waitFor({ state:'visible', timeout:10000 });
    await panel.locator(`.ui-selectonemenu-item[data-label="${labelText}"]`).first().click();
    await panel.waitFor({ state:'hidden', timeout:10000 });
    await page.waitForLoadState('networkidle', { timeout:12000 }).catch(()=>{});
    await page.waitForTimeout(600);
    return true;
  } catch(err) {
    if (optional) { console.log(`    ⚠ skip "${labelText}": ${err.message.split('\n')[0]}`); return false; }
    throw err;
  }
}

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/results:fiona:sa`;
  const res = await fetch(url, {
    method:'PUT',
    headers:{ Authorization:`Bearer ${CF_API_TOKEN}`, 'Content-Type':'application/json' },
    body:JSON.stringify(data),
  });
  console.log(res.ok ? '✅ KV OK' : `❌ KV ${res.status}`);
}

async function clickAnzeigenAndCapture(page, debugTag) {
  let jsfResponse = null;

  // JSF partial-update Response abfangen
  const responseHandler = async (response) => {
    const url = response.url();
    if (url.includes('bestlistathlete') || url.includes('faces')) {
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('xml') || ct.includes('html') || ct.includes('json')) {
        try {
          const body = await response.text();
          jsfResponse = { url, status: response.status(), ct, body: body.substring(0, 2000) };
        } catch(e) {}
      }
    }
  };
  page.on('response', responseHandler);

  // Versuch 1: PrimeFaces.ab() direkt aufrufen
  const pfResult = await page.evaluate(() => {
    try {
      const btn = document.querySelector('[id="form_anonym:loadDataBtn"]');
      if (!btn) return 'btn-not-found';

      // PrimeFaces CommandButton ruft intern PrimeFaces.ab() auf
      // cfg aus dem onclick-Attribut extrahieren
      const onclick = btn.getAttribute('onclick') || '';

      if (typeof PrimeFaces !== 'undefined' && PrimeFaces.ab) {
        // ViewState für JSF-Request
        const vs = document.querySelector('[name="javax.faces.ViewState"]');
        const formId = 'form_anonym';
        PrimeFaces.ab({
          s: 'form_anonym:loadDataBtn',
          f: formId,
          p: 'form_anonym:loadDataBtn',
          u: 'form_anonym:resultTable form_anonym:messages',
        });
        return 'pf-ab-called';
      }

      // Fallback: direkter onclick
      btn.click();
      return 'dom-click';
    } catch(e) {
      return `error: ${e.message}`;
    }
  });
  console.log(`    🔘 clickAnzeigen: ${pfResult}`);

  // Warten auf AJAX Response
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  page.off('response', responseHandler);

  if (jsfResponse) {
    console.log(`    📡 JSF Response: ${jsfResponse.status} ${jsfResponse.ct}`);
    // Tabellen-Update in Response suchen
    if (jsfResponse.body.includes('<tr') || jsfResponse.body.includes('update')) {
      console.log(`    📡 Body (1500 chars): ${jsfResponse.body.substring(0, 1500)}`);
    } else {
      console.log(`    📡 Body: ${jsfResponse.body.substring(0, 300)}`);
    }
  } else {
    console.log(`    📡 Kein JSF Response gefangen`);
  }

  // Screenshot
  if (debugTag) {
    await page.screenshot({ path: `debug_${debugTag}.png`, fullPage: false }).catch(() => {});
    console.log(`    📸 debug_${debugTag}.png`);
  }

  // Aktuelle Tabellen-Info
  const tableInfo = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('table tr')];
    return {
      count: trs.length,
      rows: trs.slice(0, 5).map(r => r.textContent.trim().replace(/\s+/g,' ').slice(0, 120)),
    };
  });
  console.log(`    📋 Nach Click: ${tableInfo.count} Zeilen`);
  tableInfo.rows.forEach((r, i) => { if (r) console.log(`      [${i}]: ${r}`); });
}

async function parseTable(page, discLabel, year) {
  await page.waitForFunction(
    () => {
      const rows = document.querySelectorAll('table tr');
      if (rows.length <= 2) return false;
      const secondRow = rows[1] ? rows[1].textContent : '';
      return !secondRow.includes('Bitte') && !secondRow.includes('wählen');
    },
    { timeout: 8000 }
  ).catch(() => {});

  const info = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('table tr')];
    return {
      count: trs.length,
      first3: trs.slice(0,4).map(r => r.textContent.trim().replace(/\s+/g,' ').slice(0,120)),
    };
  });
  console.log(`    → ${info.count} Zeilen`);
  if (info.count > 2) {
    info.first3.slice(1,3).forEach((r,i) => { if(r) console.log(`    [${i+1}]: ${r}`); });
  }

  const secondRowText = info.first3[1] || '';
  if (info.count <= 2 || secondRowText.includes('Bitte') || secondRowText.includes('wählen')) return [];

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr, table tr')]
      .filter(tr => tr.querySelectorAll('td').length >= 4)
      .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
      .filter(cols => cols.some(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)))
  );

  return rows.map(cols => {
    const dateCol   = cols.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) || '';
    const dateParts = dateCol.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dateParts) return null;
    const rowYear   = parseInt(dateParts[3]);
    if (rowYear !== year) return null;
    const dateISO   = `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`;
    const resultCol = cols.find(c => /^\d+[.,]\d{2,3}$/.test(c)) || '';
    if (!resultCol) return null;
    const windCol   = cols.find(c => /^[+\-]?\d+\.\d$/.test(c)) || '';
    const dateIdx   = cols.findIndex(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c));
    const windNum   = parseFloat(windCol);
    return {
      discipline:   DISC_MAP[discLabel] || discLabel,
      result:       resultCol,
      numResult:    parseFloat(resultCol.replace(',','.')),
      wind:         windCol || null,
      windAssisted: !isNaN(windNum) && windNum > 2.0,
      indoor:       false,
      venue:        dateIdx >= 1 ? cols[dateIdx-1] : '',
      competition:  dateIdx >= 2 ? cols[dateIdx-2] : '',
      date: dateCol, dateISO, year: rowYear,
      place: cols.find(c => /^\d+[fFhHrRvV]?\d*$/.test(c) && parseInt(c) < 200) || null,
      source: 'swiss-athletics',
    };
  }).filter(Boolean);
}

async function main() {
  console.log('🚀 v22\n');
  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext()).newPage();
  const allResults = [];

  for (const year of YEARS) {
    const cat = categoryForYear(year);
    console.log(`\n📅 ${year} (${cat})`);

    for (let ci = 0; ci < COMBOS.length; ci++) {
      const { season, disc } = COMBOS[ci];
      const doDebug = ci === 0; // nur erste Combo pro Jahr debuggen
      console.log(`\n  📋 ${DISC_MAP[disc]} ${season}...`);
      await page.goto(BASE_URL, { waitUntil:'networkidle', timeout:30000 });
      await page.waitForTimeout(1200);

      await selectPF(page, 'form_anonym:bestlistYear', String(year), true);

      if (!await selectPF(page, 'form_anonym:bestlistSeason', season)) continue;
      console.log(`    ✓ Saison: ${season}`);

      const catOk = await selectPF(page, 'form_anonym:bestlistCategory', cat, true);
      console.log(`    ${catOk ? '✓' : '✗'} Kategorie: ${cat}`);

      if (!await selectPF(page, 'form_anonym:bestlistDiscipline', disc)) continue;
      console.log(`    ✓ Disziplin: ${disc}`);

      await selectPF(page, 'form_anonym:bestlistType', 'Alle Resultate', true);

      const debugTag = doDebug ? `${year}_${DISC_MAP[disc].replace(' ','')}_${season}` : null;
      await clickAnzeigenAndCapture(page, debugTag);

      const rows = await parseTable(page, disc, year);
      rows.forEach(r => { r.indoor = season === 'Indoor'; });
      console.log(`    ✓ ${rows.length} Resultate`);
      allResults.push(...rows);
    }
  }

  await browser.close();

  const seen = new Set();
  const unique = allResults.filter(r => {
    const k = `${r.discipline}|${r.date}|${r.result}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  }).sort((a,b) => b.dateISO.localeCompare(a.dateISO));

  const pbByDisc = {};
  unique.forEach(r => {
    if (r.windAssisted) return;
    const isJump = r.discipline === 'Long Jump';
    const ex = pbByDisc[r.discipline];
    const better = !ex || (isJump ? r.numResult > ex.numResult : r.numResult < ex.numResult);
    if (better) pbByDisc[r.discipline] = r;
  });

  console.log('\n📊 PBs:');
  Object.entries(pbByDisc).forEach(([d,r]) => console.log(`  ${d}: ${r.result} (${r.date})`));
  console.log(`📊 Total: ${unique.length}`);

  const output = { athlete:'Fiona Matt', scraped:new Date().toISOString(),
    source:'swiss-athletics', count:unique.length, pbs:pbByDisc, results:unique };
  fs.writeFileSync('athlete_results.json', JSON.stringify(output, null, 2));
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(output);
  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
