#!/usr/bin/env node
/**
 * Swiss Athletics Athleten-Resultate Scraper v8
 * Direkte URL statt Suche — kein Playwright/Chrome nötig
 * Fix: openURLForBestlist nicht mehr vorhanden → URL hardcoded
 */

const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

// ✅ Direkte URL von Fionas Profil (kein Suchen mehr nötig)
const ATHLETE_URL = 'https://www.swiss-athletics.ch/wettkaempfe/resultate/bestenliste/bestenliste-pro-athlet/in-resultate/?&mobile=false&blyear=2026&con=a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf&top=30&srb=0';

const BASE = 'https://alabus.swiss-athletics.ch';

const SCRAPE_COMBOS = [
  { disc: '60 m',  season: 'true',  label: '60m Indoor',  key: '60m'       },
  { disc: '100 m', season: 'false', label: '100m',         key: '100m'      },
  { disc: '200 m', season: 'false', label: '200m',         key: '200m'      },
  { disc: '80 m',  season: 'false', label: '80m',          key: '80m'       },
  { disc: 'Weit',  season: 'false', label: 'Weitsprung',   key: 'Long Jump' },
];

const DISC_MAP = {
  '60 m': '60m', '80 m': '80m', '100 m': '100m', '200 m': '200m', 'Weit': 'Long Jump',
};

const F = {
  year:       'form_anonym:bestlistYear_input',
  season:     'form_anonym:bestlistSeason_input',
  category:   'form_anonym:bestlistCategory_input',
  discipline: 'form_anonym:bestlistDiscipline_input',
  type:       'form_anonym:bestlistType_input',
  tops:       'form_anonym:bestlistTops_input',
  btn:        'form_anonym:loadDataBtn',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0';

// ── Helpers ──────────────────────────────────────────────────

function extractVS(text) {
  return (text.match(/ViewState[^>]*value="([^"]{10,})"/) || [])[1] || null;
}
function extractGuid(html) {
  return (html.match(/aeswindowguid['":=\s]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i) || [])[1]
    || 'deadbeef-dead-4bed-8ead-deadbeefcafe';
}
function decodeHtml(xml) {
  let out = '';
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g; let m;
  while ((m = re.exec(xml)) !== null) out += m[1];
  return out || xml;
}
function getOptions(html, fieldId) {
  const escaped = fieldId.replace(/:/g, '\\:').replace(/\./g, '\\.');
  const sm = html.match(new RegExp(`id="${fieldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</select>`));
  if (!sm) return [];
  const opts = []; const re = /<option[^>]*value="([^"]*)"[^>]*>\s*([^<]*?)\s*<\/option>/g; let m;
  while ((m = re.exec(sm[1])) !== null) opts.push({ value: m[1], label: m[2].trim() });
  return opts;
}
function findOpt(opts, label) {
  return opts.find(o => o.label === label || o.label.startsWith(label));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// ── JSF POST ─────────────────────────────────────────────────

async function jsfPost(pageUrl, session, vs, guid, sourceId, fields) {
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
  const res = await fetch(pageUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/xml, text/xml, */*; q=0.01',
      'Cookie': 'JSESSIONID=' + session,
      'User-Agent': UA,
      'Origin': 'https://www.swiss-athletics.ch',
      'Referer': pageUrl,
    },
    body: body.toString(),
  });
  const xml = await res.text();
  const html = decodeHtml(xml);
  const newVs = extractVS(xml) || extractVS(html) || vs;
  return { xml, html, vs: newVs };
}

// ── Resolve alabus URL from swiss-athletics redirect ──────────

async function resolveAthleteUrl() {
  // Fetch the swiss-athletics page which embeds or redirects to alabus
  const res = await fetch(ATHLETE_URL, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'de-CH,de;q=0.9' },
    redirect: 'follow',
  });
  const html = await res.text();
  const finalUrl = res.url;

  // If already on alabus, use directly
  if (finalUrl.includes('alabus')) {
    const cookie = res.headers.get('set-cookie') || '';
    const session = (cookie.match(/JSESSIONID=([^;]+)/) || [])[1] || '';
    const guid = extractGuid(html);
    const vs = extractVS(html);
    return { url: finalUrl, html, session, guid, vs };
  }

  // Look for iframe or redirect to alabus
  const iframeMatch = html.match(/(?:src|href)="(https:\/\/alabus\.swiss-athletics\.ch[^"]+)"/i);
  if (iframeMatch) {
    const alabusUrl = iframeMatch[1];
    const r2 = await fetch(alabusUrl, { headers: { 'User-Agent': UA } });
    const html2 = await r2.text();
    const cookie = r2.headers.get('set-cookie') || '';
    const session = (cookie.match(/JSESSIONID=([^;]+)/) || [])[1] || '';
    return { url: alabusUrl, html: html2, session, guid: extractGuid(html2), vs: extractVS(html2) };
  }

  // Try to extract con parameter and build alabus URL directly
  const conMatch = ATHLETE_URL.match(/con=([^&]+)/);
  if (conMatch) {
    const alabusUrl = `${BASE}/satweb/faces/bestlistathlete.xhtml?con=${conMatch[1]}&lang=de`;
    const r3 = await fetch(alabusUrl, { headers: { 'User-Agent': UA } });
    const html3 = await r3.text();
    const cookie = r3.headers.get('set-cookie') || '';
    const session = (cookie.match(/JSESSIONID=([^;]+)/) || [])[1] || '';
    return { url: alabusUrl, html: html3, session, guid: extractGuid(html3), vs: extractVS(html3) };
  }

  throw new Error('alabus-URL konnte nicht ermittelt werden. HTML-Snippet: ' + html.substring(0, 500));
}

// ── Scrape one combo ──────────────────────────────────────────

async function scrapeCombo(athleteUrl, session, guid, combo) {
  const res = await fetch(athleteUrl, {
    headers: { 'User-Agent': UA, 'Cookie': 'JSESSIONID=' + session }
  });
  const html = await res.text();
  let vs = extractVS(html);
  if (!vs) throw new Error('Kein ViewState auf Athletenseite');

  const base = {
    [F.year]: '', [F.season]: '', [F.category]: '',
    [F.discipline]: '', [F.type]: '', [F.tops]: '',
  };

  // Jahr: ALL
  const yearOpts = getOptions(html, F.year);
  const yearOpt  = yearOpts.find(o => o.value === 'ALL' || o.label === 'Alle') || yearOpts[0];
  if (!yearOpt) throw new Error('Jahr-Optionen nicht gefunden');
  let r = await jsfPost(athleteUrl, session, vs, guid, F.year, { ...base, [F.year]: yearOpt.value });
  vs = r.vs; await wait(500);

  // Saison
  const seasonOpts = getOptions(r.html || html, F.season);
  const seasonOpt  = seasonOpts.find(o => o.value === combo.season)
    || seasonOpts.find(o => combo.season === 'true'
      ? o.label.toLowerCase().includes('halle') || o.label.toLowerCase().includes('indoor')
      : o.label.toLowerCase().includes('outdoor') || o.label.toLowerCase().includes('freiluft'))
    || seasonOpts[0];
  if (!seasonOpt) throw new Error('Saison nicht gefunden');
  r = await jsfPost(athleteUrl, session, vs, guid, F.season, { ...base, [F.year]: yearOpt.value, [F.season]: seasonOpt.value });
  vs = r.vs; await wait(500);

  // Kategorie
  const catOpts = getOptions(r.html || html, F.category);
  const catOpt  = catOpts.find(o => o.value === 'W' || o.label === 'W')
    || catOpts.find(o => o.label.toLowerCase().includes('frauen'))
    || catOpts.find(o => o.value !== '') || catOpts[1] || catOpts[0];
  r = await jsfPost(athleteUrl, session, vs, guid, F.category, {
    ...base, [F.year]: yearOpt.value, [F.season]: seasonOpt.value, [F.category]: catOpt?.value || 'W'
  });
  vs = r.vs; await wait(600);

  // Disziplin
  const discOpts = getOptions(r.html, F.discipline);
  const discOpt  = findOpt(discOpts, combo.disc);
  if (!discOpt) throw new Error(`Disziplin "${combo.disc}" nicht gefunden (${discOpts.map(o => o.label).join(', ')})`);
  r = await jsfPost(athleteUrl, session, vs, guid, F.discipline, {
    ...base, [F.year]: yearOpt.value, [F.season]: seasonOpt.value,
    [F.category]: catOpt?.value || 'W', [F.discipline]: discOpt.value
  });
  vs = r.vs; await wait(500);

  // Typ + Tops + Anzeigen
  const typeOpts = getOptions(r.html, F.type);
  const typeOpt  = typeOpts.find(o => o.value === '0') || typeOpts[0];
  const topsOpts = getOptions(r.html, F.tops);
  const topsOpt  = topsOpts.find(o => o.label.trim() === '100')
    || topsOpts.find(o => o.label.trim() === '200')
    || topsOpts[topsOpts.length - 1];

  r = await jsfPost(athleteUrl, session, vs, guid, F.btn, {
    [F.year]:       yearOpt.value,
    [F.season]:     seasonOpt.value,
    [F.category]:   catOpt?.value || 'W',
    [F.discipline]: discOpt.value,
    [F.type]:       typeOpt?.value || '0',
    [F.tops]:       topsOpt?.value || '',
    [F.btn]:        F.btn,
  });
  await wait(1000);

  return parseResults(r.html || r.xml, combo);
}

// ── Parse results table ───────────────────────────────────────

function parseResults(html, combo) {
  const results = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi; let rowM;

  while ((rowM = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi; let cm;
    while ((cm = cellRe.exec(rowM[1])) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim());
    }
    if (cells.length < 4) continue;

    function byPrefix(prefix) {
      for (const c of cells) { if (c.startsWith(prefix)) return c.substring(prefix.length).trim(); }
      return '';
    }

    const result  = byPrefix('Resultat');
    const wind    = byPrefix('Wind');
    const venue   = byPrefix('Ort');
    const comp    = byPrefix('Wettkampf');
    const dateStr = byPrefix('Datum');
    const place   = byPrefix('Rang');

    const resMatch = result.match(/^[\d:.]+/);
    const resClean = resMatch ? resMatch[0] : result;
    if (!resClean || !dateStr) continue;

    const dateParts = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const dateISO   = dateParts ? `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}` : '';
    const year      = dateParts ? parseInt(dateParts[3]) : 0;
    const windNum   = parseFloat(wind);
    const numResult = parseFloat(resClean.replace(',', '.').replace(':', '.')) || 0;

    const placeFormatted = (() => {
      const v = place.trim();
      const m = v.match(/^(\d+)([fFhHrRvVaAbBcC]?)(\d*)$/);
      if (!m) return v || '';
      const pos = m[1], typ = m[2].toLowerCase(), num = m[3];
      const typMap = { f: 'Final', h: 'Lauf', r: 'Runde', v: 'Vorlauf', a: 'A-Final', b: 'B-Final', c: 'C-Final' };
      const typStr = typMap[typ] || '';
      if (typStr && num) return `${pos}. ${typStr} ${num}`;
      if (typStr) return `${pos}. ${typStr}`;
      return `${pos}.`;
    })();

    results.push({
      discipline:      DISC_MAP[combo.disc] || combo.disc,
      disciplineLabel: combo.label,
      result:          resClean,
      numResult,
      wind:            wind.match(/^[+-]?\d+\.?\d*$/) ? wind : '',
      windAssisted:    !isNaN(windNum) && windNum > 2.0,
      indoor:          combo.season === 'true',
      venue, competition: comp, date: dateStr, dateISO, year,
      place: placeFormatted,
      source: 'swiss-athletics',
    });
  }
  return results;
}

// ── KV Upload ─────────────────────────────────────────────────

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/results:fiona:sa`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '   ✅ KV OK' : `   ❌ KV Fehler ${res.status}: ${await res.text()}`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Swiss Athletics Athleten-Resultate Scraper v8\n');

  console.log('🔗 Lade Fiona Matts Profil (direkte URL)...');
  const { url: athleteUrl, session, guid, vs } = await resolveAthleteUrl();
  if (!session) throw new Error('Keine Session erhalten — Swiss Athletics hat möglicherweise die URL geändert');
  console.log(`✅ Session: ${session.substring(0, 10)}... URL: ${athleteUrl}\n`);

  const allResults = [];

  for (const combo of SCRAPE_COMBOS) {
    console.log(`📋 ${combo.label}...`);
    try {
      const rows = await scrapeCombo(athleteUrl, session, guid, combo);
      allResults.push(...rows);
      console.log(`   ✅ ${rows.length} Resultate`);
    } catch(e) {
      console.log(`   ❌ ${e.message}`);
    }
    await wait(500);
  }

  // Deduplizieren + sortieren
  const seen = new Set();
  const unique = allResults.filter(r => {
    const key = `${r.discipline}|${r.date}|${r.result}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => b.dateISO.localeCompare(a.dateISO));

  // PBs
  const pbByDisc = {};
  unique.forEach(r => {
    if (r.windAssisted) return;
    const isJump = r.discipline === 'Long Jump';
    const ex = pbByDisc[r.discipline];
    const better = !ex || (isJump ? r.numResult > ex.numResult : r.numResult < ex.numResult);
    if (better) pbByDisc[r.discipline] = r;
  });

  console.log('\n   PBs (windlegal):');
  Object.entries(pbByDisc).forEach(([d, r]) =>
    console.log(`   ${d}: ${r.result} (${r.date}, ${r.competition})`)
  );

  const output = {
    athlete: 'Fiona Matt',
    scraped: new Date().toISOString(),
    source: 'swiss-athletics',
    count: unique.length,
    pbs: pbByDisc,
    results: unique,
  };

  fs.writeFileSync('athlete_results.json', JSON.stringify(output, null, 2));
  console.log(`\n💾 athlete_results.json gespeichert (${unique.length} Einträge)`);

  if (UPLOAD && CF_ACCOUNT_ID) {
    await uploadKV(output);
  }

  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
