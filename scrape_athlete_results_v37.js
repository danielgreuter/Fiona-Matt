// scrape_athlete_results_v37.js
// Fix: vollständige Iframe-URL lesen (nicht auf 100 Zeichen kürzen)
// swiss-athletics.ch /in-resultate/?con=... → Iframe-URL mit con= → alabus direkt

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

function parseRows(rows, disc, indoor, year) {
  return rows.map(cols => {
    const dateCell = cols.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) ||
                     cols.find(c => /\d{2}\.\d{2}\.\d{4}/.test(c));
    if (!dateCell) return null;
    const dp = dateCell.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dp || parseInt(dp[3]) !== year) return null;
    const resultCell = cols.find(c => /^\d+[,.]\d{2,3}$/.test(c));
    if (!resultCell) return null;
    const windCell = cols.find(c => /^[+\-]?\d+\.\d$/.test(c));
    const windNum  = windCell ? parseFloat(windCell) : NaN;
    const dateIdx  = cols.findIndex(c => /\d{2}\.\d{2}\.\d{4}/.test(c));
    return {
      discipline: disc, indoor,
      result: resultCell,
      numResult: parseFloat(resultCell.replace(',', '.')),
      wind: windCell || null,
      windAssisted: !isNaN(windNum) && windNum > 2.0,
      venue:       dateIdx >= 1 ? cols[dateIdx - 1] : '',
      competition: dateIdx >= 2 ? cols[dateIdx - 2] : '',
      date: dp[0], dateISO: `${dp[3]}-${dp[2]}-${dp[1]}`,
      year: parseInt(dp[3]),
      place: (cols.find(c => /^\d+[fFhHrRqQvV]/.test(c)) || '').match(/^\d+/)?.[0] || null,
      source: 'swiss-athletics',
    };
  }).filter(Boolean);
}

async function scrapeDisc(outerPage, innerPage, con, year, cat, disc, indoor) {
  const saUrl = buildSaUrl(con, year, cat, disc, indoor);

  // Swiss-athletics.ch laden (ohne auf full render zu warten — nur DOM)
  await outerPage.goto(saUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await outerPage.waitForTimeout(4000); // ajax-content Zeit geben

  // Vollständige Iframe-URL holen
  const iframeSrc = await outerPage.evaluate(() => {
    for (const f of document.querySelectorAll('iframe')) {
      if (f.src && f.src.includes('alabus') && f.src.includes('satweb')) {
        return f.src; // VOLLE URL, kein Kürzen
      }
    }
    return null;
  });

  if (!iframeSrc) {
    console.log(`    ⚠ Kein alabus-Iframe gefunden`);
    return [];
  }

  console.log(`    🔗 Iframe: ${iframeSrc}`);
  const hasCon = iframeSrc.includes('con=');
  console.log(`    ${hasCon ? '✓' : '✗'} con im Iframe: ${hasCon}`);

  // alabus-Iframe direkt laden
  await innerPage.goto(iframeSrc, { waitUntil: 'networkidle', timeout: 30000 });
  await innerPage.waitForTimeout(1500);

  const info = await innerPage.evaluate(() => {
    const trs = [...document.querySelectorAll('table tr')];
    return {
      count: trs.length,
      sample: trs.slice(0, 4).map(r => r.textContent.trim().replace(/\s+/g,' ').slice(0, 120)),
      hasFiona: document.body.textContent.includes('Fiona'),
    };
  });

  console.log(`    → ${info.count} Zeilen, Fiona=${info.hasFiona}`);
  if (info.count > 2) info.sample.slice(1,3).forEach((r,i) => r && console.log(`    [${i+1}]: ${r}`));

  if (info.count <= 2 || !info.hasFiona) return [];

  const rawRows = await innerPage.evaluate(() =>
    [...document.querySelectorAll('table tbody tr, table tr')]
      .filter(tr => tr.querySelectorAll('td').length >= 4)
      .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
      .filter(cols => cols.some(c => /\d{2}\.\d{2}\.\d{4}/.test(c)))
  );

  // Nur Fiona-Zeilen (falls gemischt)
  const fionaRows = rawRows.filter(cols => cols.some(c => c.includes('Fiona') || c.includes('Matt')));
  const useRows   = fionaRows.length > 0 ? fionaRows : rawRows;

  return parseRows(useRows, disc, indoor, year);
}

async function main() {
  console.log('🚀 v37\n');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const outer = await ctx.newPage(); // swiss-athletics.ch
  const inner = await ctx.newPage(); // alabus iframe

  console.log(`🔑 con: ${FALLBACK_CON}\n`);
  const con = FALLBACK_CON;
  const allResults = [];

  for (const year of YEARS) {
    const cat = categoryForYear(year);
    console.log(`📅 ${year} (${cat})`);
    for (const { disc, indoor } of COMBOS) {
      console.log(`  📋 ${disc} ${indoor ? 'Indoor' : 'Outdoor'}`);
      const rows = await scrapeDisc(outer, inner, con, year, cat, disc, indoor);
      console.log(`    ✓ ${rows.length} Resultate`);
      rows.forEach(r => console.log(`      ${r.result} | ${r.date} | ${r.venue}`));
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
