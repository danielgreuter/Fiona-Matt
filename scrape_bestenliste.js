#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v15 — No Browser
 * Pure HTTP + JSF partial/ajax — kein Playwright, kein Chrome nötig
 * Laufzeit: ~1 Min statt 10 Min
 */

const fs = require('fs');

const BASE  = 'https://alabus.swiss-athletics.ch';
const URL   = BASE + '/satweb/faces/bestlist.xhtml?lang=de';

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';

// Direkte alabus URLs — kein JSF-Navigation mehr nötig
// blcat = Kategorie (U18W), disci = Disziplin, blyear = Jahr
const BASE_BESTLIST = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de&mobile=false&top=30';
const CAT_U18W = '5c4o3k5m-d686mo-j986g2ie-1-j986g45y-bn';

const DISCIPLINES = [
  { key:'100m',         year:'2026', url: `${BASE_BESTLIST}&blyear=2026&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv` },
  { key:'100m_2025',    year:'2025', url: `${BASE_BESTLIST}&blyear=2025&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv` },
  { key:'60m',          year:'2026', url: `${BASE_BESTLIST}&blyear=2026&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gfre-4zz` },
  { key:'60m_2025',     year:'2025', url: `${BASE_BESTLIST}&blyear=2025&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gfre-4zz` },
  { key:'200m',         year:'2026', url: `${BASE_BESTLIST}&blyear=2026&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gfpj-4zw` },
  { key:'200m_2025',    year:'2025', url: `${BASE_BESTLIST}&blyear=2025&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gfpj-4zw` },
  { key:'Long Jump',    year:'2026', url: `${BASE_BESTLIST}&blyear=2026&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gg7f-500` },
  { key:'Long Jump_2025', year:'2025', url: `${BASE_BESTLIST}&blyear=2025&blcat=${CAT_U18W}&disci=5c4o3k5m-d686mo-j986g2ie-1-j986gg7f-500` },
];

const F = {
  year:       'form_anonym:bestlistYear_input',
  season:     'form_anonym:bestlistSeason_input',
  category:   'form_anonym:bestlistCategory_input',
  discipline: 'form_anonym:bestlistDiscipline_input',
  type:       'form_anonym:bestlistType_input',
  tops:       'form_anonym:bestlistTops_input',
};

// ── Helpers ──────────────────────────────────────────────────

function extractVS(text) {
  return (text.match(/ViewState[^>]*value="([^"]{10,})"/) || [])[1] || null;
}

function extractGuid(html) {
  return (html.match(/aeswindowguid['":\s=]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i) || [])[1]
    || 'deadbeef-dead-4bed-8ead-deadbeefcafe';
}

function decodeHtml(xml) {
  let out = '';
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out += m[1];
  return out || xml;
}

// Parse all <option> elements from a <select> by field ID
function getOptions(html, fieldId) {
  const escaped = fieldId.replace(/:/g, '\\:');
  const sm = html.match(new RegExp(`id="${escaped}"[^>]*>([\\s\\S]*?)</select>`));
  if (!sm) return [];
  const opts = [];
  const re = /<option[^>]*value="([^"]*)"[^>]*>\s*([^<]*?)\s*<\/option>/g;
  let m;
  while ((m = re.exec(sm[1])) !== null) opts.push({ value: m[1], label: m[2].trim() });
  return opts;
}

function findOpt(opts, label) {
  return opts.find(o => o.label === label || o.label.startsWith(label));
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// ── JSF partial/ajax POST ─────────────────────────────────────

async function jsfPost(session, vs, guid, sourceId, fields) {
  const body = new URLSearchParams({
    'javax.faces.partial.ajax': 'true',
    'javax.faces.source': sourceId,
    'javax.faces.partial.execute': '@all',
    'javax.faces.partial.render': 'form_anonym',
    [sourceId]: sourceId,
    'aeswindowguid': guid,
    'form_anonym': 'form_anonym',
    ...fields,
    'javax.faces.ViewState': vs,
  });

  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/xml, text/xml, */*; q=0.01',
      'Cookie': 'JSESSIONID=' + session,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0',
      'Origin': BASE,
      'Referer': URL,
    },
    body: body.toString(),
  });

  const xml = await res.text();
  const html = decodeHtml(xml);
  const newVs = extractVS(xml) || extractVS(html) || vs;
  return { xml, html, vs: newVs };
}

// ── Scrape one discipline — direkte GET-URL ───────────────────

async function scrapeDiscipline(disc) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0';
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
