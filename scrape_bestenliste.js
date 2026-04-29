// scrape_bestenliste_v2.js — direkte URL-Abfrage, kein Playwright nötig

const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID;

async function kvPut(key, value) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: typeof value === 'string' ? value : JSON.stringify(value) }
  );
  if (!res.ok) throw new Error(`KV PUT ${key}: ${res.status}`);
}

async function kvGet(key) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } }
  );
  if (res.status === 404) return null;
  return res.text();
}

// ─── IDs direkt von Swiss Athletics (stabil) ─────────────────────────────────
const CAT_U18_FRAUEN = '5c4o3k5m-d686mo-j986g2ie-1-j986g45y-bn';

const DISCIPLINES_2026 = [
  { label: '100m',      id: '5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv', season: 'Outdoor' },
  { label: '200m',      id: '5c4o3k5m-d686mo-j986g2ie-1-j986ghgt-6ks', season: 'Outdoor' },
  { label: 'Long Jump', id: '5c4o3k5m-d686mo-j986g2ie-1-j986ge5c-3mp', season: 'Outdoor' },
];

const DISCIPLINES_INDOOR_2026 = [
  { label: '60m',       id: '5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79',  season: 'Indoor'  },
];

const FIONA_DOB = '02.09.2009';

// ─── URL Scraper ─────────────────────────────────────────────────────────────
async function scrapeDiscipline(disc, year) {
  const url = `https://www.swiss-athletics.ch/bestenliste-pro-disziplin-und-kategorie/?&mobile=false&blyear=${year}&blcat=${CAT_U18_FRAUEN}&disci=${disc.id}&top=30`;
  console.log(`\n📋 ${disc.label} ${year}`);
  console.log(`   ${url}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FionaBot/1.0)' }
  });

  if (!res.ok) { console.warn(`  ✗ HTTP ${res.status}`); return null; }

  const html = await res.text();

  // Tabellen-Rows parsen
  const rows = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cols = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      // Strip HTML tags
      const text = tdMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      cols.push(text);
    }
    if (cols.length >= 4 && /^\d+$/.test(cols[0])) {
      rows.push(cols);
    }
  }

  console.log(`  → ${rows.length} Zeilen | [0]: ${JSON.stringify(rows[0]?.slice(0,6))}`);
  if (rows.length === 0) return { discipline: disc.label, year: String(year), scraped: new Date().toISOString(), fiona: null, top15: [] };

  const top15 = rows.slice(0, 15).map(cols => ({
    rank:    parseInt(cols[0]),
    result:  cols[1],
    wind:    cols[2]?.match(/^[+-]?\d+\.\d+$/) ? cols[2] : null,
    name:    cols[4] || cols[3],
    club:    cols[5] || cols[4],
    date:    cols[7] || '',
    isFiona: (cols[4]||'').includes('Matt') || (cols[7]||'') === FIONA_DOB,
  }));

  const fionaRow = rows.find(c => (c[4]||'').includes('Matt') || (c[7]||'') === FIONA_DOB);
  const fiona = fionaRow ? {
    rank: parseInt(fionaRow[0]),
    result: fionaRow[1],
    wind: fionaRow[2]?.match(/^[+-]?\d+\.\d+$/) ? fionaRow[2] : null,
    date: fionaRow[7] || '',
    gapToFirst: rows[0] ? (parseFloat(fionaRow[1]) - parseFloat(rows[0][1])).toFixed(2) : null,
  } : null;

  if (fiona) console.log(`  ⭐ Fiona: Rang ${fiona.rank} — ${fiona.result}`);
  else console.log(`  — Fiona nicht in Top ${rows.length}`);
  console.log(`  1.: ${top15[0]?.name} ${top15[0]?.result}`);

  return { discipline: disc.label, year: String(year), scraped: new Date().toISOString(), fiona, top15 };
}

// ─── Hauptprogramm ───────────────────────────────────────────────────────────
(async () => {
  // 2025 eingefroren?
  let skip2025 = false;
  if (UPLOAD) {
    const existing = await kvGet('bestenliste_2025:fiona').catch(() => null);
    if (existing) {
      try { if (JSON.parse(existing).frozen) { skip2025 = true; console.log('✅ 2025 eingefroren'); } }
      catch(e) {}
    }
  }

  // 2026
  console.log('\n══ SAISON 2026 ══');
  const disciplines2026 = {};
  for (const disc of [...DISCIPLINES_2026, ...DISCIPLINES_INDOOR_2026]) {
    const result = await scrapeDiscipline(disc, 2026);
    if (result) disciplines2026[disc.label] = result;
  }
  const json2026 = { updated: new Date().toISOString(), disciplines: disciplines2026 };
  fs.writeFileSync('bestenliste.json', JSON.stringify(json2026, null, 2));
  console.log('\n✅ bestenliste.json');
  if (UPLOAD) { await kvPut('bestenliste:fiona', json2026); console.log('✅ KV (2026)'); }

  // 2025
  if (!skip2025) {
    console.log('\n══ SAISON 2025 ══');
    const disciplines2025 = {};
    for (const disc of [...DISCIPLINES_2026, ...DISCIPLINES_INDOOR_2026]) {
      const result = await scrapeDiscipline(disc, 2025);
      if (result) disciplines2025[disc.label] = result;
    }
    const json2025 = { updated: new Date().toISOString(), frozen: true, disciplines: disciplines2025 };
    fs.writeFileSync('bestenliste_2025.json', JSON.stringify(json2025, null, 2));
    console.log('\n✅ bestenliste_2025.json');
    if (UPLOAD) { await kvPut('bestenliste_2025:fiona', json2025); console.log('✅ KV (2025)'); }
  }

  console.log('\n✅ Fertig');
})();
