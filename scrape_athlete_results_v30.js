// scrape_athlete_results_v30.js
// Fix: bltype=0 ("Alle Resultate") — nur Fionas persönliche Läufe, keine anderen Athleten

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
const CAT_IDS = {
  'U18 Frauen': '5c4o3k5m-d686mo-j986g2ie-1-j986g45y-bn',
  'U16 Frauen': '5c4o3k5m-d686mo-j986g2ie-1-j986g45u-bl',
};
const ATHLETE_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
const BASE = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlistathlete.xhtml';

function categoryForYear(year) {
  return (year - 2009) >= 16 ? 'U18 Frauen' : 'U16 Frauen';
}

const COMBOS = [
  { disc: '60m',       indoor: true  },
  { disc: '100m',      indoor: false },
  { disc: '200m',      indoor: false },
  { disc: 'Long Jump', indoor: false },
];

const YEARS = [2026, 2025, 2024];

function buildUrl(year, cat, disc, indoor) {
  const p = new URLSearchParams({
    con: ATHLETE_CON, lang: 'de', mobile: 'false',
    blyear: String(year),
    blcat: CAT_IDS[cat],
    disci: DISC_IDS[disc],
    bltype: '0',   // ← "Alle Resultate"
    top: '200',
  });
  if (indoor) p.set('indoor', 'true');
  return `${BASE}?${p}`;
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

function extractDate(cell)   { const m = cell.match(/(\d{2}\.\d{2}\.\d{4})/); return m ? m[1] : null; }
function extractResult(cell) { const m = cell.match(/(\d+)[,.](\d{2,3})(?!\d)/); return m ? m[0] : null; }
function extractWind(cell)   { const m = cell.replace('Wind','').match(/([+\-]\d+\.\d)/); return m ? m[1] : null; }

async function parseTable(page, disc, indoor, year) {
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('table tr');
    if (rows.length <= 1) return false;
    const txt = rows[1] ? rows[1].textContent : '';
    return !txt.includes('Bitte') && !txt.includes('wählen');
  }, { timeout: 12000 }).catch(() => {});

  const info = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('table tr')];
    return {
      count: trs.length,
      cells: trs[1] ? [...trs[1].querySelectorAll('td')].map(td => td.textContent.trim()) : [],
      sample: trs.slice(1,4).map(r => r.textContent.trim().replace(/\s+/g,' ').slice(0,120)),
    };
  });

  const noData = info.cells.some(c => c.includes('keine Daten') || c.includes('Es sind keine'));
  console.log(`    → ${info.count} Zeilen${noData ? ' (keine Daten)' : ''}`);
  if (info.count > 1 && !noData) {
    info.sample.forEach((r,i) => { if(r) console.log(`    [${i+1}]: ${r}`); });
  }
  if (info.count <= 2 || noData) return [];

  const rawRows = await page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr, table tr')]
      .filter(tr => tr.querySelectorAll('td').length >= 4)
      .map(tr => ({ cells: [...tr.querySelectorAll('td')].map(td => td.textContent.trim()) }))
      .filter(r => /\d{2}\.\d{2}\.\d{4}/.test(r.cells.join('|')))
  );

  return rawRows.map(({ cells }) => {
    const dateStr = cells.map(extractDate).find(Boolean);
    if (!dateStr) return null;
    const dp = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const rowYear = parseInt(dp[3]);

    const resultStr = (() => {
      for (const c of cells) { if (c.includes('Resultat')) return extractResult(c); }
      return cells.map(extractResult).find(Boolean);
    })();
    if (!resultStr) return null;

    let venue = '', competition = '', windStr = null, place = null;
    for (const c of cells) {
      if (c.startsWith('Ort'))        venue       = c.slice(3).trim();
      if (c.startsWith('Wettkampf')) competition = c.slice(9).trim();
      if (c.startsWith('Wind'))      windStr     = extractWind(c);
      if (c.startsWith('Rang')) { const m = c.slice(4).match(/^\d+/); if (m) place = m[0]; }
    }

    const windNum = windStr ? parseFloat(windStr) : NaN;
    return {
      discipline: disc, indoor,
      result: resultStr,
      numResult: parseFloat(resultStr.replace(',', '.')),
      wind: windStr || null,
      windAssisted: !isNaN(windNum) && windNum > 2.0,
      venue, competition,
      date: dateStr,
      dateISO: `${dp[3]}-${dp[2]}-${dp[1]}`,
      year: rowYear, place,
      source: 'swiss-athletics',
    };
  }).filter(Boolean);
}

async function main() {
  console.log('🚀 v30\n');
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const allResults = [];

  for (const year of YEARS) {
    const cat = categoryForYear(year);
    console.log(`\n📅 ${year} (${cat})`);

    for (const { disc, indoor } of COMBOS) {
      console.log(`\n  📋 ${disc} ${indoor ? 'Indoor' : 'Outdoor'}...`);
      const url = buildUrl(year, cat, disc, indoor);
      console.log(`    🌐 ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);
      const rows = await parseTable(page, disc, indoor, year);
      console.log(`    ✓ ${rows.length} Resultate`);
      allResults.push(...rows);
    }
  }

  await browser.close();

  // Deduplizieren
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
  console.log(`\n📊 Alle Resultate (${unique.length}):`);
  unique.forEach(r => console.log(`  ${r.year} ${r.discipline} ${r.result} | ${r.date} | ${r.venue}`));

  const output = {
    athlete: 'Fiona Matt', scraped: new Date().toISOString(),
    source: 'swiss-athletics', count: unique.length, pbs: pbByDisc, results: unique,
  };
  fs.writeFileSync('athlete_results.json', JSON.stringify(output, null, 2));
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(output);
  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
