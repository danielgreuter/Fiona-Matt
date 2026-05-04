// scrape_athlete_results_v24.js
// Kompletter Ansatzwechsel: URL aus onclick extrahieren, direkt navigieren

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

const ATHLETE_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
const ALABUS_URL = `https://alabus.swiss-athletics.ch/satweb/faces/bestlistathlete.xhtml?con=${ATHLETE_CON}&lang=de`;

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

async function getResultsUrl(page) {
  // URL aus dem onclick-Attribut des "Anzeigen"-Buttons extrahieren
  const url = await page.evaluate(() => {
    const btn = document.querySelector('[id="form_anonym:loadDataBtn"]');
    if (!btn) return null;
    const onclick = btn.getAttribute('onclick') || '';
    const match = onclick.match(/openURLForBestlist\('([^']+)'\)/);
    return match ? match[1] : null;
  });
  return url;
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

async function scrapeResultsPage(page, targetUrl, discLabel, year) {
  // top=30 → top=200 für vollständige Resultate
  const fullUrl = targetUrl.replace('top=30', 'top=200');
  console.log(`    🌐 ${fullUrl}`);

  await page.goto(fullUrl, { waitUntil:'networkidle', timeout:30000 });
  await page.waitForTimeout(1500);

  // Screenshot für Debugging
  await page.screenshot({ path: `debug_results_${year}_${DISC_MAP[discLabel]}.png` }).catch(()=>{});

  // Tabellen-Struktur analysieren
  const tableInfo = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    return tables.map((t, i) => ({
      i, id: t.id, cls: t.className.substring(0,60),
      rows: t.querySelectorAll('tr').length,
      sample: [...t.querySelectorAll('tr')].slice(0,3)
        .map(r => r.textContent.trim().replace(/\s+/g,' ').substring(0,120)),
    }));
  });

  if (tableInfo.length === 0) {
    // Kein table-Tag — evtl. andere Struktur (div-basiert)
    const altInfo = await page.evaluate(() => {
      const body = document.body ? document.body.textContent.replace(/\s+/g,' ').substring(0,500) : '';
      return { body, hasResults: document.querySelectorAll('[class*="result"],[class*="row"],[class*="entry"]').length };
    });
    console.log(`    ⚠ Keine Tabelle. Body: ${altInfo.body}`);
    return [];
  }

  console.log(`    📋 ${tableInfo.length} Tabelle(n) gefunden`);
  tableInfo.forEach(t => {
    console.log(`      [${t.i}] rows=${t.rows} id="${t.id}"`);
    t.sample.forEach((r,i) => { if(r) console.log(`        row${i}: ${r}`); });
  });

  // Tabelle mit Datum-Spalte finden
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr, table tr')]
      .filter(tr => tr.querySelectorAll('td').length >= 3)
      .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
      .filter(cols => cols.some(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)))
  );

  console.log(`    → ${rows.length} Datenzeilen`);

  return rows.map(cols => {
    const dateCol   = cols.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) || '';
    const dateParts = dateCol.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dateParts) return null;
    const rowYear   = parseInt(dateParts[3]);
    const dateISO   = `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`;
    const resultCol = cols.find(c => /^\d+[.,]\d{2,3}$/.test(c)) || '';
    if (!resultCol) return null;
    const windCol   = cols.find(c => /^[+\-]?\d+\.\d$/.test(c)) || '';
    const dateIdx   = cols.findIndex(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c));
    const windNum   = parseFloat(windCol);
    const isIndoor  = targetUrl.includes('indoor=true');
    return {
      discipline:   DISC_MAP[discLabel] || discLabel,
      result:       resultCol,
      numResult:    parseFloat(resultCol.replace(',','.')),
      wind:         windCol || null,
      windAssisted: !isNaN(windNum) && windNum > 2.0,
      indoor:       isIndoor,
      venue:        dateIdx >= 1 ? cols[dateIdx-1] : '',
      competition:  dateIdx >= 2 ? cols[dateIdx-2] : '',
      date: dateCol, dateISO, year: rowYear,
      place: cols.find(c => /^\d+[fFhHrRvV]?\d*$/.test(c) && parseInt(c) < 200) || null,
      source: 'swiss-athletics',
    };
  }).filter(Boolean);
}

async function main() {
  console.log('🚀 v24\n');
  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext();
  const alabus  = await ctx.newPage();   // für alabus Dropdown-Navigation
  const results = await ctx.newPage();   // für Results-Seiten
  const allResults = [];

  for (const year of YEARS) {
    const cat = categoryForYear(year);
    console.log(`\n📅 ${year} (${cat})`);

    for (const { season, disc } of COMBOS) {
      console.log(`\n  📋 ${DISC_MAP[disc]} ${season}...`);

      // Alabus: Dropdowns setzen um URL zu generieren
      await alabus.goto(ALABUS_URL, { waitUntil:'networkidle', timeout:30000 });
      await alabus.waitForTimeout(1200);

      await selectPF(alabus, 'form_anonym:bestlistYear', String(year), true);

      if (!await selectPF(alabus, 'form_anonym:bestlistSeason', season)) continue;
      console.log(`    ✓ Saison: ${season}`);

      const catOk = await selectPF(alabus, 'form_anonym:bestlistCategory', cat, true);
      console.log(`    ${catOk ? '✓' : '✗'} Kategorie: ${cat}`);

      if (!await selectPF(alabus, 'form_anonym:bestlistDiscipline', disc)) continue;
      console.log(`    ✓ Disziplin: ${disc}`);

      // URL aus Button-onclick lesen (kein Click nötig!)
      const targetUrl = await getResultsUrl(alabus);
      if (!targetUrl) {
        console.log('    ⚠ Keine URL im onclick gefunden');
        continue;
      }
      console.log(`    ✓ URL extrahiert`);

      // Results-Seite direkt aufrufen
      const rows = await scrapeResultsPage(results, targetUrl, disc, year);
      // Nur Zeilen des gewünschten Jahres behalten
      const filtered = rows.filter(r => r.year === year);
      console.log(`    ✓ ${filtered.length} Resultate (${year})`);
      allResults.push(...filtered);
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
