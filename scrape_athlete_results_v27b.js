// scrape_athlete_results_v27b.js
// Ohne blyear → alle Jahre in einer Abfrage pro Disziplin

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

const DISC_IDS = {
  '60m':       '5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79',
  '100m':      '5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv',
  '200m':      '5c4o3k5m-d686mo-j986g2ie-1-j986ghgt-6ks',
  'Long Jump': '5c4o3k5m-d686mo-j986g2ie-1-j986ge5c-3mp',
};
// Alle relevanten Kategorien — ohne blyear liefert alabus alle Jahre
// Wir fragen U18 + U16 separat ab (verschiedene blcat)
const CATEGORIES = [
  { label: 'U18 Frauen', id: '5c4o3k5m-d686mo-j986g2ie-1-j986g45y-bn' },
  { label: 'U16 Frauen', id: '5c4o3k5m-d686mo-j986g2ie-1-j986g45u-bl' },
];
const ATHLETE_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';

const COMBOS = [
  { disc: '60m',       indoor: true  },
  { disc: '100m',      indoor: false },
  { disc: '200m',      indoor: false },
  { disc: 'Long Jump', indoor: false },
];

function buildUrl(catId, disc, indoor) {
  const base = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlistathlete.xhtml';
  const params = new URLSearchParams({
    con: ATHLETE_CON,
    lang: 'de',
    mobile: 'false',
    blcat: catId,
    disci: DISC_IDS[disc],
    top: '500',
  });
  if (indoor) params.set('indoor', 'true');
  return `${base}?${params.toString()}`;
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

async function parseTable(page, disc, indoor, catLabel) {
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('table tr');
    if (rows.length <= 2) return false;
    const second = rows[1] ? rows[1].textContent : '';
    return !second.includes('Bitte') && !second.includes('wählen') && !second.includes('keine');
  }, { timeout: 15000 }).catch(() => {});

  const info = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('table tr')];
    return {
      count: trs.length,
      rows: trs.slice(0, 5).map(r => r.textContent.trim().replace(/\s+/g, ' ').slice(0, 130)),
    };
  });

  console.log(`    → ${info.count} Zeilen`);
  info.rows.slice(1, 4).forEach((r, i) => { if (r) console.log(`    [${i+1}]: ${r}`); });

  if (info.count <= 2) return [];
  const second = info.rows[1] || '';
  if (second.includes('Bitte') || second.includes('wählen') || second.includes('keine')) return [];

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
    const rowYear  = parseInt(dateParts[3]);
    const dateISO  = `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`;
    const resultCol = cols.find(c => /^\d+[.,]\d{2,3}$/.test(c)) || '';
    if (!resultCol) return null;
    const windCol  = cols.find(c => /^[+\-]?\d+\.\d$/.test(c)) || '';
    const dateIdx  = cols.findIndex(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c));
    const windNum  = parseFloat(windCol);
    return {
      discipline:   disc,
      result:       resultCol,
      numResult:    parseFloat(resultCol.replace(',', '.')),
      wind:         windCol || null,
      windAssisted: !isNaN(windNum) && windNum > 2.0,
      indoor,
      category:     catLabel,
      venue:        dateIdx >= 1 ? cols[dateIdx - 1] : '',
      competition:  dateIdx >= 2 ? cols[dateIdx - 2] : '',
      date: dateCol, dateISO, year: rowYear,
      place: cols.find(c => /^\d+$/.test(c) && parseInt(c) < 200) || null,
      source: 'swiss-athletics',
    };
  }).filter(Boolean);
}

async function main() {
  console.log('🚀 v27b\n');
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const allResults = [];

  // Pro Kategorie × Disziplin — kein Jahr-Loop mehr
  for (const { label: catLabel, id: catId } of CATEGORIES) {
    console.log(`\n📂 ${catLabel}`);
    for (const { disc, indoor } of COMBOS) {
      console.log(`\n  📋 ${disc} ${indoor ? 'Indoor' : 'Outdoor'}...`);
      const url = buildUrl(catId, disc, indoor);
      console.log(`    🌐 ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);
      const rows = await parseTable(page, disc, indoor, catLabel);
      console.log(`    ✓ ${rows.length} Resultate`);
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
  console.log(`📊 Total: ${unique.length}`);

  const output = {
    athlete: 'Fiona Matt', scraped: new Date().toISOString(),
    source: 'swiss-athletics', count: unique.length, pbs: pbByDisc, results: unique,
  };
  fs.writeFileSync('athlete_results.json', JSON.stringify(output, null, 2));
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(output);
  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
