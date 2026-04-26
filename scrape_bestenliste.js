#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v15 — JSF Navigation
 * Navigiert durch die Dropdowns per JSF partial/ajax
 * Stabil gegenüber URL-Änderungen
 */

const fs = require('fs');

const BASE  = 'https://alabus.swiss-athletics.ch';
const URL   = BASE + '/satweb/faces/bestlist.xhtml?lang=de';

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';

const DISCIPLINES = [
  { key:'100m',           year:'2026', season:'Outdoor', label:'100 m' },
  { key:'100m_2025',      year:'2025', season:'Outdoor', label:'100 m' },
  { key:'60m',            year:'2026', season:'Indoor',  label:'60 m'  },
  { key:'60m_2025',       year:'2025', season:'Indoor',  label:'60 m'  },
  { key:'200m',           year:'2026', season:'Outdoor', label:'200 m' },
  { key:'200m_2025',      year:'2025', season:'Outdoor', label:'200 m' },
  { key:'Long Jump',      year:'2026', season:'Outdoor', label:'Weit'  },
  { key:'Long Jump_2025', year:'2025', season:'Outdoor', label:'Weit'  },
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

function getOptions(html, fieldId) {
  const escaped = fieldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// ── Scrape one discipline via JSF navigation ──────────────────

async function scrapeDiscipline(disc, session, guid) {
  const pageRes = await fetch(URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0',
      'Cookie': 'JSESSIONID=' + session,
      'Accept-Language': 'de-CH,de;q=0.9',
    }
  });
  let html = await pageRes.text();
  let vs = extractVS(html);
  if (!vs) throw new Error('ViewState nicht gefunden');

  const base = {
    [F.year]: '', [F.season]: '', [F.category]: '',
    [F.discipline]: '', [F.type]: '', [F.tops]: '',
    'form_anonym:selectOneMenuSearchField_focus': '',
    'form_anonym:selectOneMenuSearchField_input': 'Name',
    'form_anonym:inputTxtSearchValue': '',
  };

  // 1. Jahr
  const yearOpts = getOptions(html, F.year);
  const yearOpt  = yearOpts.find(o => o.label === disc.year) || yearOpts.find(o => o.value === 'ALL') || yearOpts[0];
  if (!yearOpt) throw new Error(`Jahr ${disc.year} nicht gefunden`);
  let r = await jsfPost(session, vs, guid, F.year, { ...base, [F.year]: yearOpt.value });
  vs = r.vs; html = r.html; await wait(600);

  // 2. Saison
  const seasonOpts = getOptions(html, F.season);
  const isIndoor = disc.season === 'Indoor';
  const seasonOpt = seasonOpts.find(o =>
    isIndoor ? (o.label.toLowerCase().includes('halle') || o.label.toLowerCase().includes('indoor'))
             : (o.label.toLowerCase().includes('outdoor') || o.label.toLowerCase().includes('freiluft'))
  ) || seasonOpts.find(o => o.value !== '') || seasonOpts[1];
  if (!seasonOpt) throw new Error(`Saison ${disc.season} nicht gefunden`);
  r = await jsfPost(session, vs, guid, F.season, { ...base, [F.year]: yearOpt.value, [F.season]: seasonOpt.value });
  vs = r.vs; html = r.html; await wait(600);

  // 3. Kategorie U18 Frauen
  const catOpts = getOptions(html, F.category);
  const catOpt  = catOpts.find(o => o.label.includes('U18') && o.label.toLowerCase().includes('frauen'))
                || catOpts.find(o => o.label.includes('U18'))
                || catOpts.find(o => o.value !== '') || catOpts[1];
  if (!catOpt) throw new Error(`U18 Frauen nicht gefunden`);
  r = await jsfPost(session, vs, guid, F.category, {
    ...base, [F.year]: yearOpt.value, [F.season]: seasonOpt.value, [F.category]: catOpt.value
  });
  vs = r.vs; html = r.html; await wait(800);

  // 4. Disziplin
  const discOpts = getOptions(html, F.discipline);
  const discOpt  = findOpt(discOpts, disc.label);
  if (!discOpt) throw new Error(`Disziplin "${disc.label}" nicht gefunden (${discOpts.map(o=>o.label).join(', ')})`);
  r = await jsfPost(session, vs, guid, F.discipline, {
    ...base, [F.year]: yearOpt.value, [F.season]: seasonOpt.value,
    [F.category]: catOpt.value, [F.discipline]: discOpt.value
  });
  vs = r.vs; html = r.html; await wait(600);

  // 5. Typ: Ein Resultat pro Athlet
  const typeOpts = getOptions(html, F.type);
  const typeOpt  = typeOpts.find(o => o.label.toLowerCase().includes('ein resultat')) || typeOpts[1] || typeOpts[0];

  // 6. Tops: 500 oder letzter verfügbarer Wert
  const topsOpts = getOptions(html, F.tops);
  const topsOpt  = topsOpts.find(o => o.label.trim() === '500') || topsOpts[topsOpts.length - 1];

  // 7. Anzeigen Button finden
  const btnMatch = html.match(/id="(form_anonym:[^"]*(?:j_idt|anzeig|loadData|Btn)[^"]*)"[^>]*>[^<]*[Aa]nzeig/);
  const btnId    = btnMatch ? btnMatch[1] : 'form_anonym:j_idt70';

  r = await jsfPost(session, vs, guid, btnId, {
    [F.year]: yearOpt.value, [F.season]: seasonOpt.value,
    [F.category]: catOpt.value, [F.discipline]: discOpt.value,
    [F.type]: typeOpt?.value || '', [F.tops]: topsOpt?.value || '',
    [btnId]: btnId,
  });
  await wait(1000);

  const isJump = disc.key.startsWith('Long Jump');
  const rows = parseTable(r.html || r.xml, isJump);
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
  console.log('🚀 Swiss Athletics Bestenliste Scraper v15 (JSF Navigation)\n');

  const initRes = await fetch(URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0',
      'Accept-Language': 'de-CH,de;q=0.9',
    }
  });
  const initHtml = await initRes.text();
  const cookie   = initRes.headers.get('set-cookie') || '';
  const session  = (cookie.match(/JSESSIONID=([^;]+)/) || [])[1] || '';
  const guid     = extractGuid(initHtml);

  if (!session) { console.error('❌ Keine Session'); process.exit(1); }
  console.log(`✓ Session OK · GUID: ${guid.substring(0, 8)}...\n`);

  const result = { updated: new Date().toISOString().split('T')[0], disciplines: {} };

  for (const disc of DISCIPLINES) {
    console.log(`📋 ${disc.key} (${disc.season} ${disc.year})`);
    try {
      const rows   = await scrapeDiscipline(disc, session, guid);
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
    await wait(500);
  }

  fs.writeFileSync('bestenliste.json', JSON.stringify(result, null, 2));
  console.log('💾 bestenliste.json gespeichert');

  if (process.argv.includes('--upload') && CF_ACCOUNT_ID) {
    await uploadKV(result);
  }

  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
