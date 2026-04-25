#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v16 — Direkte URLs
 * Keine JSF-Navigation nötig, direkte GET-Anfragen
 * disci-Parameter aus echten alabus-URLs extrahiert
 */

const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';

const BASE_BESTLIST = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de&mobile=false&top=30';
const CAT_U18W = '5c4o3k5m-d686mo-j986g2ie-1-j986g45y-bn';

const DISCIPLINES = [
  { key:'100m',           year:'2026', url:`${BASE_BESTLIST}&blyear=2026&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv` },
  { key:'100m_2025',      year:'2025', url:`${BASE_BESTLIST}&blyear=2025&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv` },
  { key:'60m',            year:'2026', url:`${BASE_BESTLIST}&blyear=2026&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gfre-4zz` },
  { key:'60m_2025',       year:'2025', url:`${BASE_BESTLIST}&blyear=2025&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gfre-4zz` },
  { key:'200m',           year:'2026', url:`${BASE_BESTLIST}&blyear=2026&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986ghgt-6ks` },
  { key:'200m_2025',      year:'2025', url:`${BASE_BESTLIST}&blyear=2025&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986ghgt-6ks` },
  { key:'Long Jump',      year:'2026', url:`${BASE_BESTLIST}&blyear=2026&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986ge5c-3mp` },
  { key:'Long Jump_2025', year:'2025', url:`${BASE_BESTLIST}&blyear=2025&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986ge5c-3mp` },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0';

// ── Scrape one discipline via direkte GET-URL ─────────────────

async function scrapeDiscipline(disc) {
  const res = await fetch(disc.url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'de-CH,de;q=0.9' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const isJump = disc.key.startsWith('Long Jump');
  const rows = parseTable(html, isJump);
  console.log(`   ${rows.length} Einträge geparst`);
  return rows;
}

// ── Table parser ──────────────────────────────────────────────

function parseTable(html, isJump) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowM;

  while ((rowM = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cellRe.exec(rowM[1])) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim());
    }
    if (cells.length < 4) continue;

    // Rang: "Nr1", "1", etc.
    const rank = parseInt((cells[0] || '').replace(/Nr\.?\s*/i, '').trim());
    if (isNaN(rank) || rank < 1 || rank > 1000) continue;

    let result = '', name = '', club = '', date = '', wind = '';
    for (const c of cells.slice(1)) {
      if (!result && (isJump ? /^\d+\.\d{2}$/ : /^\d+[:.]\d{2}$/).test(c)) { result = c; continue; }
      if (result && !wind && /^[+-]?\d+\.\d$/.test(c)) { wind = c; continue; }
      if (!name && /^[A-ZÄÖÜ][a-zäöüß]+([ -][A-ZÄÖÜ][a-zäöüß]+)+$/.test(c)) { name = c; continue; }
      if (!date && /^\d{2}\.\d{2}\.\d{4}$/.test(c)) { date = c; continue; }
      if (name && result && !club && c.length > 2 && !/^\d/.test(c)) club = c;
    }

    if (!name || !result) continue;
    rows.push({ rank, name, result, wind, club, date, isFiona: name.includes('Matt') });
  }
  return rows;
}

// ── Gap calculation ───────────────────────────────────────────

function toSec(t) {
  if (!t) return null;
  const p = t.split(':');
  return p.length === 2 ? parseFloat(p[0]) * 60 + parseFloat(p[1]) : parseFloat(t) || null;
}

function calcGap(a, b, isJump) {
  const as = toSec(a), bs = toSec(b);
  if (as == null || bs == null) return null;
  const d = isJump ? (as - bs) : (as - bs);
  return (d >= 0 ? '+' : '') + d.toFixed(2);
}

// ── KV Upload ─────────────────────────────────────────────────

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/bestenliste:fiona`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '✅ KV Upload OK' : `❌ KV Fehler ${res.status}`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Swiss Athletics Bestenliste Scraper v16 (Direkte URLs)\n');

  const result = { updated: new Date().toISOString().split('T')[0], disciplines: {} };

  for (const disc of DISCIPLINES) {
    console.log(`📋 ${disc.key} (${disc.year})`);
    try {
      const rows   = await scrapeDiscipline(disc);
      const isJump = disc.key.startsWith('Long Jump');
      const fiona  = rows.find(r => r.isFiona);
      const top1   = rows[0];

      result.disciplines[disc.key] = {
        discipline: disc.key,
        year: disc.year,
        scraped: new Date().toISOString(),
        fiona: fiona ? {
          rank: fiona.rank,
          result: fiona.result,
          wind: fiona.wind || null,
          date: fiona.date,
          gapToFirst: top1 ? calcGap(fiona.result, top1.result, isJump) : null,
        } : null,
        top15: rows.slice(0, 15),
        total: rows.length,
      };

      if (fiona) console.log(`   ✅ Fiona: Rang ${fiona.rank} · ${fiona.result} · Δ${result.disciplines[disc.key].fiona.gapToFirst || '—'} zu Rang 1`);
      else       console.log(`   ⚠️  Fiona nicht in Top ${rows.length}`);
    } catch(e) {
      console.log(`   ❌ ${e.message}`);
      result.disciplines[disc.key] = { error: e.message, fiona: null, top15: [], total: 0 };
    }
    console.log('');
  }

  fs.writeFileSync('bestenliste.json', JSON.stringify(result, null, 2));
  console.log('💾 bestenliste.json gespeichert');

  if (process.argv.includes('--upload') && CF_ACCOUNT_ID) {
    await uploadKV(result);
  }

  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
