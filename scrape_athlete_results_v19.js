// scrape_athlete_results_v19.js
// Fix: kein loadDataBtn auf bestlistathlete.xhtml — Tabelle lädt per AJAX nach Dropdown.
// Neu: Debug-Screenshot + HTML-Dump nach Disziplin-Selektion für erste Disziplin pro Jahr.

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

async function debugDump(page, tag) {
  try {
    await page.screenshot({ path: `debug_${tag}.png`, fullPage: true });
    console.log(`    📸 Screenshot: debug_${tag}.png`);
  } catch(e) { console.log(`    ⚠ Screenshot fehlgeschlagen: ${e.message}`); }

  // HTML-Struktur der Tabelle(n) loggen
  const tableInfo = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    return tables.map((t, i) => {
      const rows = [...t.querySelectorAll('tr')];
      return {
        index: i,
        id: t.id,
        className: t.className.substring(0,60),
        rowCount: rows.length,
        firstRows: rows.slice(0,4).map(r => r.textContent.trim().replace(/\s+/g,' ').substring(0,120)),
      };
    });
  });
  console.log(`    📋 Tabellen auf Seite: ${tableInfo.length}`);
  tableInfo.forEach(t => {
    console.log(`      [${t.index}] id="${t.id}" class="${t.className}" rows=${t.rowCount}`);
    t.firstRows.forEach((r,i) => { if(r) console.log(`        row${i}: ${r}`); });
  });

  // Alle sichtbaren Buttons loggen
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button, input[type=submit], .ui-button, .ui-commandlink')]
      .map(e => ({ id: e.id, text: e.textContent.trim().substring(0,30), visible: e.offsetParent !== null }))
      .filter(e => e.visible)
  );
  console.log(`    🔘 Sichtbare Buttons: ${buttons.map(b => `"${b.text}"(${b.id||'no-id'})`).join(', ')}`);

  // Aktuell gewählte Dropdown-Werte loggen
  const dropVals = await page.evaluate(() => {
    const ids = ['bestlistYear','bestlistSeason','bestlistCategory','bestlistDiscipline','bestlistType'];
    return ids.map(id => {
      const el = document.querySelector(`[id$="${id}_label"]`) || document.querySelector(`[id$="${id}"]`);
      return { id, value: el ? el.textContent.trim() : 'n/a' };
    });
  });
  console.log(`    📌 Dropdown-Werte: ${dropVals.map(d => `${d.id}="${d.value}"`).join(', ')}`);

  // Netzwerk-Fehler / leere Responses prüfen
  const pageUrl = page.url();
  console.log(`    🌐 Aktuelle URL: ${pageUrl}`);
}

async function parseTable(page, discLabel, year, debugTag = null) {
  // Warten bis Tabelle sich ändert (AJAX-Update) — kein Button nötig
  await page.waitForTimeout(2500);

  // Zusätzlich auf >2 Zeilen warten (max 10s)
  await page.waitForFunction(
    () => document.querySelectorAll('table tr').length > 2,
    { timeout: 10000 }
  ).catch(() => {});

  if (debugTag) await debugDump(page, debugTag);

  const info = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('table tr')];
    return {
      count: trs.length,
      first3: trs.slice(0,4).map(r => r.textContent.trim().replace(/\s+/g,' ').slice(0,120)),
    };
  });
  console.log(`    → ${info.count} Zeilen`);
  if (info.count > 2) {
    info.first3.slice(1).forEach((r,i) => { if(r) console.log(`    [${i+1}]: ${r}`); });
  }

  if (info.count <= 2) return [];

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
  console.log('🚀 v19\n');
  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext()).newPage();
  const allResults = [];

  // Einmalig Seite laden und HTML-Struktur loggen (vor Filterung)
  console.log('🔍 Initiale Seitenanalyse...');
  await page.goto(BASE_URL, { waitUntil:'networkidle', timeout:30000 });
  await page.waitForTimeout(2000);
  await debugDump(page, 'initial');

  for (const year of YEARS) {
    const cat = categoryForYear(year);
    console.log(`\n📅 ${year} (${cat})`);

    for (let ci = 0; ci < COMBOS.length; ci++) {
      const { season, disc } = COMBOS[ci];
      const discShort = DISC_MAP[disc];
      // Nur beim ersten Combo pro Jahr einen Debug-Dump machen
      const doDebug = ci === 0;

      console.log(`\n  📋 ${discShort} ${season}...`);
      await page.goto(BASE_URL, { waitUntil:'networkidle', timeout:30000 });
      await page.waitForTimeout(1200);

      // Jahr (optional)
      await selectPF(page, 'form_anonym:bestlistYear', String(year), true);

      // Saison
      if (!await selectPF(page, 'form_anonym:bestlistSeason', season)) continue;
      console.log(`    ✓ Saison: ${season}`);

      // Kategorie
      const catOk = await selectPF(page, 'form_anonym:bestlistCategory', cat, true);
      console.log(`    ${catOk ? '✓' : '✗'} Kategorie: ${cat}`);

      // Disziplin
      if (!await selectPF(page, 'form_anonym:bestlistDiscipline', disc)) continue;
      console.log(`    ✓ Disziplin: ${disc}`);

      // Typ: Alle Resultate (optional)
      await selectPF(page, 'form_anonym:bestlistType', 'Alle Resultate', true);

      // Kein loadDataBtn — Tabelle lädt per AJAX nach Dropdown-Change
      // (Button existiert auf bestlistathlete.xhtml nicht)

      const debugTag = doDebug ? `${year}_${discShort.replace(' ','')}_${season}` : null;
      const rows = await parseTable(page, disc, year, debugTag);
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
