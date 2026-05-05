// scrape_athlete_results_v38.js
// Fix: Label+Wert-Parser aus v28 kombiniert mit Iframe-Ansatz aus v37

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

const FALLBACK_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
const SA_BASE = 'https://www.swiss-athletics.ch/wettkaempfe/resultate/bestenliste/bestenliste-pro-athlet/in-resultate/';

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

function buildSaUrl(con, year, cat, disc, indoor) {
  const p = new URLSearchParams({
    mobile: 'false', blyear: String(year), con,
    blcat: CAT_IDS[cat], disci: DISC_IDS[disc], top: '30', srb: '0',
  });
  if (indoor) p.set('indoor', 'true');
  return `${SA_BASE}?&${p}`;
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

// Label+Wert-Parser (wie v28) — Zellen enthalten "Datum21.02.2026", "Resultat7.60" etc.
function extractDate(c)   { const m = c.match(/(\d{2}\.\d{2}\.\d{4})/); return m?.[1] ?? null; }
function extractResult(c) { const m = c.match(/(\d+)[,.](\d{2,3})(?!\d)/); return m?.[0] ?? null; }
function extractWind(c)   { const m = c.replace('Wind','').match(/([+\-]\d+\.\d)/); return m?.[1] ?? null; }

function parseRowCells(cells, disc, indoor, year) {
  // Datum
  const dateStr = cells.map(extractDate).find(Boolean);
  if (!dateStr) return null;
  const dp = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!dp || parseInt(dp[3]) !== year) return null;

  // Resultat — zuerst Zelle mit "Resultat"-Label, dann generisch
  const resultStr = (() => {
    for (const c of cells) { if (c.startsWith('Resultat') || c.includes('Resultat')) { const r = extractResult(c); if (r) return r; } }
    return cells.map(extractResult).find(Boolean);
  })();
  if (!resultStr) return null;

  let venue = '', competition = '', windStr = null, place = null;
  for (const c of cells) {
    if (c.startsWith('Ort'))        venue       = c.slice(3).trim();
    if (c.startsWith('Wettkampf')) competition = c.slice(9).trim();
    if (c.startsWith('Wind'))      windStr     = extractWind(c);
    if (c.startsWith('Rang'))      { const m = c.slice(4).match(/^\d+/); if (m) place = m[0]; }
  }

  const windNum = windStr ? parseFloat(windStr) : NaN;
  return {
    discipline: disc, indoor,
    result: resultStr,
    numResult: parseFloat(resultStr.replace(',', '.')),
    wind: windStr || null,
    windAssisted: !isNaN(windNum) && windNum > 2.0,
    venue, competition,
    date: dateStr, dateISO: `${dp[3]}-${dp[2]}-${dp[1]}`,
    year: parseInt(dp[3]), place,
    source: 'swiss-athletics',
  };
}

async function scrapeDisc(outerPage, innerPage, con, year, cat, disc, indoor) {
  // swiss-athletics.ch laden → Iframe-URL extrahieren
  const saUrl = buildSaUrl(con, year, cat, disc, indoor);
  await outerPage.goto(saUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await outerPage.waitForTimeout(4000);

  const iframeSrc = await outerPage.evaluate(() => {
    for (const f of document.querySelectorAll('iframe')) {
      if (f.src && f.src.includes('alabus') && f.src.includes('satweb')) return f.src;
    }
    return null;
  });

  if (!iframeSrc) { console.log(`    ⚠ Kein Iframe`); return []; }

  // alabus-Iframe laden
  await innerPage.goto(iframeSrc, { waitUntil: 'networkidle', timeout: 30000 });
  await innerPage.waitForTimeout(1500);

  const info = await innerPage.evaluate(() => {
    const trs = [...document.querySelectorAll('table tr')];
    return {
      count: trs.length,
      hasFiona: document.body.textContent.includes('Fiona'),
      // Erste Datenzeile: alle Zellen einzeln ausgeben
      cells: trs[1] ? [...trs[1].querySelectorAll('td')].map(td => td.textContent.trim()) : [],
    };
  });

  console.log(`    → ${info.count} Zeilen, Fiona=${info.hasFiona}`);
  if (info.cells.length) console.log(`    Zellen: ${JSON.stringify(info.cells.slice(0,6))}`);

  if (info.count <= 2 || !info.hasFiona) return [];

  // Alle Zeilen mit Datum holen
  const rawRows = await innerPage.evaluate(() =>
    [...document.querySelectorAll('table tbody tr, table tr')]
      .filter(tr => tr.querySelectorAll('td').length >= 4)
      .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
      .filter(cols => /\d{2}\.\d{2}\.\d{4}/.test(cols.join('|')))
  );

  const results = rawRows.map(cols => parseRowCells(cols, disc, indoor, year)).filter(Boolean);
  results.forEach(r => console.log(`    ✅ ${r.result} | ${r.date} | ${r.competition} | ${r.venue}`));
  return results;
}

async function main() {
  console.log('🚀 v38\n');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const outer = await ctx.newPage();
  const inner = await ctx.newPage();
  const con   = FALLBACK_CON;
  console.log(`🔑 con: ${con}\n`);

  const allResults = [];
  for (const year of YEARS) {
    const cat = categoryForYear(year);
    console.log(`📅 ${year} (${cat})`);
    for (const { disc, indoor } of COMBOS) {
      console.log(`  📋 ${disc} ${indoor ? 'Indoor' : 'Outdoor'}`);
      const rows = await scrapeDisc(outer, inner, con, year, cat, disc, indoor);
      console.log(`    → ${rows.length} Resultate`);
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
