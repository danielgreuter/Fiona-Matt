// scrape_athlete_results_v36.js
// Direkt swiss-athletics.ch /in-resultate/ mit con= aufrufen
// Wartet explizit auf Tabellen-Render via ajax-content

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

// con holen: zuerst von swiss-athletics.ch Profil, sonst Fallback
const FALLBACK_CON  = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
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
  { disc: '60m',       indoor: true,  season: 'Indoor'  },
  { disc: '100m',      indoor: false, season: 'Outdoor' },
  { disc: '200m',      indoor: false, season: 'Outdoor' },
  { disc: 'Long Jump', indoor: false, season: 'Outdoor' },
];
const YEARS = [2026, 2025, 2024];

function buildUrl(con, year, cat, disc, indoor) {
  const p = new URLSearchParams({
    mobile: 'false',
    blyear: String(year),
    con,
    blcat: CAT_IDS[cat],
    disci: DISC_IDS[disc],
    top: '30',
    srb: '0',
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

async function getCon(page) {
  // Versuche frischen con vom Athletenprofil
  try {
    await page.goto('https://www.swiss-athletics.ch/de/athleten/athletensuche', {
      waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    // Fiona Link suchen
    const href = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a')].find(l =>
        l.textContent.includes('Fiona') && l.textContent.includes('Matt'));
      return a?.href || null;
    });
    if (href) {
      await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);
      const con = await page.evaluate(() => {
        const m = document.documentElement.innerHTML.match(/[?&]con=([a-z0-9\-]+)/i);
        return m ? m[1] : null;
      });
      if (con) { console.log(`🔑 Frischer con: ${con}`); return con; }
    }
  } catch(e) { /* ignore */ }
  console.log(`🔑 Fallback con: ${FALLBACK_CON}`);
  return FALLBACK_CON;
}

async function scrapeResultsPage(page, url, disc, indoor, year) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Warten auf gerenderte Tabelle — swiss-athletics.ch lädt via ajax-content
  // Strategie: alle 500ms prüfen ob table mit Datum-Zelle erscheint (max 25s)
  const rendered = await page.waitForFunction(() => {
    const tables = document.querySelectorAll('table');
    for (const t of tables) {
      const rows = t.querySelectorAll('tr');
      if (rows.length > 2) {
        const txt = t.textContent;
        if (/\d{2}\.\d{2}\.\d{4}/.test(txt)) return true;
      }
    }
    // Auch iframe-Content prüfen
    const frames = document.querySelectorAll('iframe');
    for (const f of frames) {
      try {
        const doc = f.contentDocument;
        if (doc && /\d{2}\.\d{2}\.\d{4}/.test(doc.body?.textContent)) return true;
      } catch(e) {}
    }
    return false;
  }, { timeout: 25000, polling: 500 }).catch(() => null);

  if (!rendered) {
    // Debug: was ist auf der Seite?
    const debug = await page.evaluate(() => ({
      bodyLen: document.body?.innerHTML?.length ?? 0,
      iframes: [...document.querySelectorAll('iframe')].map(f => f.src?.substring(0,100)),
      tables: document.querySelectorAll('table').length,
      snippet: document.body?.textContent?.replace(/\s+/g,' ')?.substring(0,300),
    }));
    console.log(`    ⚠ Kein Render (bodyLen=${debug.bodyLen}, tables=${debug.tables})`);
    if (debug.iframes.length) console.log(`    iframes: ${JSON.stringify(debug.iframes)}`);
    console.log(`    body: ${debug.snippet}`);

    // Fallback: alabus iframe direkt lesen
    const iframeSrc = await page.evaluate(() => {
      const f = [...document.querySelectorAll('iframe')].find(f =>
        f.src?.includes('alabus') || f.src?.includes('satweb'));
      return f?.src || null;
    });
    if (iframeSrc) {
      console.log(`    → Iframe: ${iframeSrc.substring(0,100)}`);
      await page.goto(iframeSrc, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(2000);
    } else {
      return [];
    }
  }

  // Tabelle parsen
  const rows = await page.evaluate(() => {
    const results = [];
    for (const table of document.querySelectorAll('table')) {
      const trs = [...table.querySelectorAll('tbody tr, tr')]
        .filter(tr => tr.querySelectorAll('td').length >= 4);
      for (const tr of trs) {
        const cols = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
        const txt = cols.join('|');
        if (/\d{2}\.\d{2}\.\d{4}/.test(txt)) results.push(cols);
      }
    }
    return results;
  });

  return rows.map(cols => {
    // Flexibles Parsen: Spalten können variieren
    const dateCell = cols.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) ||
                     cols.find(c => /\d{2}\.\d{2}\.\d{4}/.test(c));
    if (!dateCell) return null;
    const dp = dateCell.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dp || parseInt(dp[3]) !== year) return null;

    // Resultat: erste Zelle die wie eine Zeit/Weite aussieht
    const resultCell = cols.find(c => /^\d+[,.]\d{2,3}$/.test(c));
    if (!resultCell) return null;

    // Wind: +/-X.X
    const windCell = cols.find(c => /^[+\-]?\d+\.\d$/.test(c));
    const windNum  = windCell ? parseFloat(windCell) : NaN;

    // Ort und Wettkampf: letzte Textspalten vor Datum
    const dateIdx = cols.findIndex(c => /\d{2}\.\d{2}\.\d{4}/.test(c));
    const venue       = dateIdx >= 1 ? cols[dateIdx - 1] : '';
    const competition = dateIdx >= 2 ? cols[dateIdx - 2] : '';

    // Rang
    const rankCell = cols.find(c => /^\d+[fFhHrRqQvV]/.test(c));
    const place    = rankCell ? rankCell.match(/^\d+/)?.[0] : null;

    return {
      discipline: disc, indoor,
      result: resultCell,
      numResult: parseFloat(resultCell.replace(',', '.')),
      wind: windCell || null,
      windAssisted: !isNaN(windNum) && windNum > 2.0,
      venue, competition,
      date: dateCell.match(/\d{2}\.\d{2}\.\d{4}/)[0],
      dateISO: `${dp[3]}-${dp[2]}-${dp[1]}`,
      year: parseInt(dp[3]), place,
      source: 'swiss-athletics',
    };
  }).filter(Boolean);
}

async function uploadKVData(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/results:fiona:sa`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '✅ KV OK' : `❌ KV ${res.status}`);
}

async function main() {
  console.log('🚀 v36\n');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  const con  = await getCon(page);
  const allResults = [];

  for (const year of YEARS) {
    const cat = categoryForYear(year);
    console.log(`\n📅 ${year} (${cat})`);

    for (const { disc, indoor } of COMBOS) {
      console.log(`  📋 ${disc} ${indoor ? 'Indoor' : 'Outdoor'}...`);
      const url = buildUrl(con, year, cat, disc, indoor);
      const rows = await scrapeResultsPage(page, url, disc, indoor, year);
      console.log(`    ✓ ${rows.length} Resultate`);
      if (rows.length) rows.forEach(r => console.log(`      ${r.result} | ${r.date} | ${r.venue}`));
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
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKVData(output);
  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
