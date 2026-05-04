// scrape_athlete_results_v28.js
// Fix: Regex ohne ^$-Anker — Zellen haben Label+Wert kombiniert (z.B. "Datum21.02.2026")

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

function categoryForYear(year) {
  const age = year - 2009;
  if (age >= 16) return 'U18 Frauen';
  if (age >= 14) return 'U16 Frauen';
  return 'U14 Frauen';
}

const COMBOS = [
  { disc: '60m',       indoor: true  },
  { disc: '100m',      indoor: false },
  { disc: '200m',      indoor: false },
  { disc: 'Long Jump', indoor: false },
];

const YEARS = [2026, 2025, 2024];

function buildUrl(year, cat, disc, indoor) {
  const base = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlistathlete.xhtml';
  const params = new URLSearchParams({
    con: ATHLETE_CON, lang: 'de', mobile: 'false',
    blyear: String(year), blcat: CAT_IDS[cat], disci: DISC_IDS[disc], top: '200',
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

// Extrahiert Wert aus "Label+Wert"-Zelle, z.B. "Resultat7.57" → "7.57"
function extractDate(cell) {
  const m = cell.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? m[0] : null;
}
function extractResult(cell) {
  const m = cell.match(/(\d+)[,.](\d{2,3})(?!\d)/);
  return m ? m[0] : null;
}
function extractWind(cell) {
  const m = cell.match(/([+\-]\d+\.\d|\d+\.\d)/);
  return m ? m[0] : null;
}
function extractName(cell) {
  // Zelle "NameFiona Matt" → "Fiona Matt"
  return cell.replace(/^Name/, '').trim();
}

async function parseTable(page, disc, year, indoor) {
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('table tr');
    if (rows.length <= 2) return false;
    const second = rows[1] ? rows[1].textContent : '';
    return !second.includes('Bitte') && !second.includes('wählen') && !second.includes('keine Daten');
  }, { timeout: 15000 }).catch(() => {});

  const info = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('table tr')];
    return {
      count: trs.length,
      rows: trs.slice(0, 4).map(r => r.textContent.trim().replace(/\s+/g, ' ').slice(0, 150)),
      // Erste Datenzeile: alle Zellen einzeln
      cells: trs[1] ? [...trs[1].querySelectorAll('td')].map(td => td.textContent.trim()) : [],
    };
  });

  console.log(`    → ${info.count} Zeilen`);
  if (info.cells.length > 0) console.log(`    Zellen[0]: ${JSON.stringify(info.cells)}`);

  if (info.count <= 2) return [];
  const second = info.rows[1] || '';
  if (second.includes('Bitte') || second.includes('keine Daten')) return [];

  // Alle Zeilen mit Datum parsen
  const rawRows = await page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr, table tr')]
      .filter(tr => tr.querySelectorAll('td').length >= 4)
      .map(tr => ({
        cells: [...tr.querySelectorAll('td')].map(td => td.textContent.trim()),
        fullText: tr.textContent.trim().replace(/\s+/g, ' '),
      }))
      .filter(r => /\d{2}\.\d{2}\.\d{4}/.test(r.fullText))
  );

  const results = [];
  for (const { cells, fullText } of rawRows) {
    // Datum aus beliebiger Zelle extrahieren
    let dateStr = null;
    let dateParts = null;
    for (const c of cells) {
      const d = extractDate(c);
      if (d) { dateStr = d; dateParts = d.match(/(\d{2})\.(\d{2})\.(\d{4})/); break; }
    }
    if (!dateParts) continue;

    const rowYear = parseInt(dateParts[3]);
    if (rowYear !== year) continue;
    const dateISO = `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`;

    // Resultat aus Zelle mit "Resultat"-Label oder erstem Zahlen-Match
    let resultStr = null;
    for (const c of cells) {
      if (c.includes('Resultat')) { resultStr = extractResult(c); break; }
    }
    if (!resultStr) {
      for (const c of cells) { resultStr = extractResult(c); if (resultStr) break; }
    }
    if (!resultStr) continue;

    // Wind (optional)
    let windStr = null;
    for (const c of cells) {
      if (c.includes('Wind')) { windStr = extractWind(c.replace('Wind', '')); break; }
    }

    // Ort
    let venue = '';
    for (const c of cells) {
      if (c.startsWith('Ort')) { venue = c.replace(/^Ort/, '').trim(); break; }
    }

    // Wettkampf
    let competition = '';
    for (const c of cells) {
      if (c.startsWith('Wettkampf')) { competition = c.replace(/^Wettkampf/, '').trim(); break; }
    }

    // Name (prüfen ob Fiona Matt)
    let name = '';
    for (const c of cells) {
      if (c.startsWith('Name')) { name = c.replace(/^Name/, '').trim(); break; }
    }

    // Rang/Platz
    let place = null;
    for (const c of cells) {
      if (c.startsWith('Rang')) {
        const m = c.replace(/^Rang/, '').match(/^\d+/);
        if (m) place = m[0];
        break;
      }
    }

    const windNum = windStr ? parseFloat(windStr) : NaN;
    results.push({
      discipline: disc,
      result: resultStr,
      numResult: parseFloat(resultStr.replace(',', '.')),
      wind: windStr || null,
      windAssisted: !isNaN(windNum) && windNum > 2.0,
      indoor,
      venue,
      competition,
      name,
      date: dateStr, dateISO, year: rowYear,
      place,
      source: 'swiss-athletics',
    });
  }

  // Nur Fiona Matt herausfiltern
  const fiona = results.filter(r => r.name.toLowerCase().includes('fiona') || r.name.toLowerCase().includes('matt'));
  console.log(`    → ${results.length} total, ${fiona.length} Fiona Matt`);
  if (fiona.length > 0) fiona.forEach(r => console.log(`    ✅ ${r.result} | ${r.date} | ${r.venue} | ${r.competition}`));
  return fiona;
}

async function main() {
  console.log('🚀 v28\n');
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const allResults = [];

  for (const year of YEARS) {
    const cat = categoryForYear(year);
    console.log(`\n📅 ${year} (${cat})`);
    for (const { disc, indoor } of COMBOS) {
      console.log(`\n  📋 ${disc} ${indoor ? 'Indoor' : 'Outdoor'}...`);
      const url = buildUrl(year, cat, disc, indoor);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);
      const rows = await parseTable(page, disc, year, indoor);
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
