// scrape_athlete_results_v35.js
// Lizenznummer 251392 → frischer con-Token + vollständige Resultate

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

const LICENSE = '251392';
const BASE    = 'https://alabus.swiss-athletics.ch/satweb/faces';

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

// Frischen con via Lizenznummer holen
async function getFreshCon(page) {
  console.log(`🔑 Suche Athlet via Lizenz ${LICENSE}...`);

  // Variante 1: alabus direkt mit lid=
  const candidates = [
    `${BASE}/bestlistathlete.xhtml?lid=${LICENSE}&lang=de`,
    `${BASE}/bestlistathlete.xhtml?license=${LICENSE}&lang=de`,
    `https://www.swiss-athletics.ch/de/athleten/athletensuche?searchword=${LICENSE}`,
    `https://www.swiss-athletics.ch/wettkaempfe/resultate/bestenliste/bestenliste-pro-athlet/?searchword=${LICENSE}`,
  ];

  for (const url of candidates) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(2000);

      // con aus Seite extrahieren
      const con = await page.evaluate(() => {
        // Aus iframe
        for (const f of document.querySelectorAll('iframe')) {
          const m = f.src && f.src.match(/[?&]con=([a-z0-9\-]+)/i);
          if (m) return m[1];
        }
        // Aus Links
        for (const a of document.querySelectorAll('a[href*="con="]')) {
          const m = a.href.match(/[?&]con=([a-z0-9\-]+)/i);
          if (m) return m[1];
        }
        // Aus HTML-Source
        const m = document.documentElement.innerHTML.match(/[?&]con=([a-z0-9\-]+)/i);
        return m ? m[1] : null;
      });

      // URL-Parameter "con" aus aktuellem URL
      const urlCon = new URL(page.url()).searchParams.get('con');

      const found = con || urlCon;
      if (found) {
        console.log(`  ✓ con: ${found} (via ${url.substring(0,60)}...)`);
        return found;
      }

      // Fiona-Link auf der Seite?
      const fionaLink = await page.evaluate(() => {
        const a = [...document.querySelectorAll('a')].find(l =>
          l.textContent.includes('Fiona') || l.href.includes('con='));
        return a ? { text: a.textContent.trim(), href: a.href } : null;
      });
      if (fionaLink) {
        console.log(`  📎 Fiona-Link: ${fionaLink.href}`);
        const m = fionaLink.href.match(/[?&]con=([a-z0-9\-]+)/i);
        if (m) { console.log(`  ✓ con: ${m[1]}`); return m[1]; }
        // Link aufrufen
        await page.goto(fionaLink.href, { waitUntil: 'networkidle', timeout: 20000 });
        const con2 = new URL(page.url()).searchParams.get('con');
        if (con2) { console.log(`  ✓ con: ${con2}`); return con2; }
      }

      console.log(`  — ${url.substring(0,60)}: kein con`);
    } catch(e) {
      console.log(`  ⚠ ${url.substring(0,50)}: ${e.message.split('\n')[0]}`);
    }
  }

  // Fallback: bekannter con (evtl. noch gültig)
  const fallback = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
  console.log(`  ⚠ Fallback con: ${fallback}`);
  return fallback;
}

function buildUrl(con, year, cat, disc, indoor, bltype) {
  const p = new URLSearchParams({
    con, lang: 'de', mobile: 'false',
    blyear: String(year), blcat: CAT_IDS[cat],
    disci: DISC_IDS[disc], bltype: String(bltype), top: '30',
  });
  if (indoor) p.set('indoor', 'true');
  return `${BASE}/bestlistathlete.xhtml?${p}`;
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

function extractDate(c)   { const m = c.match(/(\d{2}\.\d{2}\.\d{4})/); return m?.[1] ?? null; }
function extractResult(c) { const m = c.match(/(\d+)[,.](\d{2,3})(?!\d)/); return m?.[0] ?? null; }
function extractWind(c)   { const m = c.replace('Wind','').match(/([+\-]\d+\.\d)/); return m?.[1] ?? null; }
function isFiona(cells)   { return cells.some(c => c.includes('Fiona') && c.includes('Matt')); }

async function parseTableForFiona(page, disc, indoor, year) {
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('table tr');
    if (rows.length <= 1) return false;
    return !rows[1].textContent.includes('Bitte') && !rows[1].textContent.includes('wählen');
  }, { timeout: 12000 }).catch(() => {});

  const rawRows = await page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr, table tr')]
      .filter(tr => tr.querySelectorAll('td').length >= 4)
      .map(tr => ({ cells: [...tr.querySelectorAll('td')].map(td => td.textContent.trim()) }))
      .filter(r => /\d{2}\.\d{2}\.\d{4}/.test(r.cells.join('|')))
  );

  return rawRows
    .filter(({ cells }) => isFiona(cells))
    .map(({ cells }) => {
      const dateStr = cells.map(extractDate).find(Boolean); if (!dateStr) return null;
      const dp = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (parseInt(dp[3]) !== year) return null;
      const resultStr = (() => {
        for (const c of cells) { if (c.includes('Resultat')) return extractResult(c); }
        return cells.map(extractResult).find(Boolean);
      })(); if (!resultStr) return null;
      let venue='', competition='', windStr=null, place=null;
      for (const c of cells) {
        if (c.startsWith('Ort'))        venue       = c.slice(3).trim();
        if (c.startsWith('Wettkampf')) competition = c.slice(9).trim();
        if (c.startsWith('Wind'))      windStr     = extractWind(c);
        if (c.startsWith('Rang')) { const m = c.slice(4).match(/^\d+/); if (m) place = m[0]; }
      }
      const windNum = windStr ? parseFloat(windStr) : NaN;
      return {
        discipline: disc, indoor, result: resultStr,
        numResult: parseFloat(resultStr.replace(',','.')),
        wind: windStr||null, windAssisted: !isNaN(windNum)&&windNum>2.0,
        venue, competition,
        date: dateStr, dateISO: `${dp[3]}-${dp[2]}-${dp[1]}`,
        year: parseInt(dp[3]), place, source:'swiss-athletics',
      };
    }).filter(Boolean);
}

async function main() {
  console.log('🚀 v35\n');
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  })).newPage();

  const con = await getFreshCon(page);
  const allResults = [];

  for (const year of YEARS) {
    const cat = categoryForYear(year);
    console.log(`\n📅 ${year} (${cat})`);
    for (const { disc, indoor } of COMBOS) {
      console.log(`  📋 ${disc} ${indoor?'Indoor':'Outdoor'}`);
      let found = 0;
      for (const bltype of [0, 1]) {
        await page.goto(buildUrl(con, year, cat, disc, indoor, bltype), { waitUntil:'networkidle', timeout:30000 });
        await page.waitForTimeout(1200);
        const rows = await parseTableForFiona(page, disc, indoor, year);
        if (rows.length) console.log(`    bltype=${bltype}: ${rows.length}`);
        allResults.push(...rows); found += rows.length;
      }
      if (!found) console.log(`    — keine`);
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
    const isJump = r.discipline==='Long Jump';
    const ex = pbByDisc[r.discipline];
    const better = !ex||(isJump?r.numResult>ex.numResult:r.numResult<ex.numResult);
    if (better) pbByDisc[r.discipline]=r;
  });

  console.log('\n📊 PBs:');
  Object.entries(pbByDisc).forEach(([d,r])=>console.log(`  ${d}: ${r.result} (${r.date})`));
  console.log(`📊 Total: ${unique.length}`);
  unique.forEach(r=>console.log(`  ${r.year} ${r.discipline} ${r.result} | ${r.date} | ${r.venue}`));

  const output = { athlete:'Fiona Matt', scraped:new Date().toISOString(),
    source:'swiss-athletics', count:unique.length, pbs:pbByDisc, results:unique };
  fs.writeFileSync('athlete_results.json', JSON.stringify(output,null,2));
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(output);
  console.log('\n✅ Fertig!');
}

main().catch(e=>{console.error('❌',e.message);process.exit(1);});
