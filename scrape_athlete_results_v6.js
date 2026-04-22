#!/usr/bin/env node
/**
 * Swiss Athletics Athleten-Resultate Scraper v6 — No Browser
 * Pure HTTP + JSF partial/ajax — kein Playwright/Chrome nötig
 */

const fs = require('fs');

const BASE       = 'https://alabus.swiss-athletics.ch';
const SEARCH_URL = BASE + '/satweb/faces/bestlistathletesearch.xhtml?lang=de';

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';

const SCRAPE_COMBOS = [
  { disc:'60 m',  season:'true',  label:'60m Indoor',  key:'60m'       },
  { disc:'100 m', season:'false', label:'100m',         key:'100m'      },
  { disc:'200 m', season:'false', label:'200m',         key:'200m'      },
  { disc:'80 m',  season:'false', label:'80m',          key:'80m'       },
  { disc:'Weit',  season:'false', label:'Weitsprung',   key:'Long Jump' },
];

const DISC_MAP = {
  '60 m':'60m', '80 m':'80m', '100 m':'100m', '200 m':'200m', 'Weit':'Long Jump',
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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0';

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
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g; let m;
  while ((m = re.exec(xml)) !== null) out += m[1];
  return out || xml;
}
function getOptions(html, fieldId) {
  const sm = html.match(new RegExp(`id="${fieldId.replace(/:/g,'\\:')}"[^>]*>([\\s\\S]*?)</select>`));
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
      'Origin': BASE,
      'Referer': pageUrl,
    },
    body: body.toString(),
  });
  const xml = await res.text();
  const html = decodeHtml(xml);
  const newVs = extractVS(xml) || extractVS(html) || vs;
  return { xml, html, vs: newVs };
}

// ── Step 1: Search for Fiona, get her profile URL ─────────────

async function findFionaUrl() {
  // GET search page
  const res = await fetch(SEARCH_URL, { headers: { 'User-Agent': UA, 'Accept-Language': 'de-CH' } });
  const html = await res.text();
  const cookie  = res.headers.get('set-cookie') || '';
  const session = (cookie.match(/JSESSIONID=([^;]+)/) || [])[1] || '';
  const guid    = extractGuid(html);
  let vs        = extractVS(html);
  if (!session || !vs) throw new Error('Search page: keine Session oder ViewState');

  // POST: Suche nach "Matt" "Fiona"
  const searchBtnMatch = html.match(/id="(form_anonym:[^"]*(?:search|suche|idt)[^"]*)"[^>]*(?:type="submit"|onclick)/i);
  const searchBtn = searchBtnMatch ? searchBtnMatch[1] : 'form_anonym:j_idt_search';

  const r = await jsfPost(SEARCH_URL, session, vs, guid, searchBtn, {
    'form_anonym:bestlistAthleteSearchBeanLastName':  'Matt',
    'form_anonym:bestlistAthleteSearchBeanFirstName': 'Fiona',
    [searchBtn]: searchBtn,
  });
  vs = r.vs;

  // Finde Fionas URL aus onClick="openURLForBestlist('...')"
  const urlMatch = r.html.match(/openURLForBestlist\('([^']*Fiona[^']*|[^']*Matt[^']*)'\)/i)
    || r.html.match(/Fiona Matt[\s\S]*?openURLForBestlist\('([^']+)'\)/)
    || r.html.match(/openURLForBestlist\('([^']+)'\)/);

  if (!urlMatch) {
    // Fallback: suche nach Links in Tabelle, wo Fiona Matt steht
    const rowMatch = r.html.match(/Fiona\s+Matt[\s\S]{0,500}?openURLForBestlist\('([^']+)'\)/);
    if (rowMatch) return { url: rowMatch[1], session, guid };

    // Debug output
    console.log('   HTML-Snippet:', r.html.substring(0, 1000));
    throw new Error('Fiona URL nicht gefunden in Suchergebnissen');
  }

  let url = urlMatch[1];
  if (!url.startsWith('http')) url = BASE + url;
  return { url, session, guid };
}

// ── Step 2: Scrape one combo from athlete page ────────────────

async function scrapeCombo(athleteUrl, session, guid, combo) {
  // GET athlete page (fresh for each combo)
  const res = await fetch(athleteUrl, { headers: { 'User-Agent': UA, 'Cookie': 'JSESSIONID=' + session } });
  const html = await res.text();
  let vs = extractVS(html);
  if (!vs) throw new Error('Athlete page: kein ViewState');

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

  // Saison: Indoor/Outdoor (true/false)
  const seasonOpts = getOptions(r.html || html, F.season);
  const seasonOpt  = seasonOpts.find(o => o.value === combo.season)
    || seasonOpts.find(o => combo.season === 'true' ? o.label.toLowerCase().includes('halle') || o.label.toLowerCase().includes('indoor') : o.label.toLowerCase().includes('outdoor') || o.label.toLowerCase().includes('freiluft'))
    || seasonOpts[0];
  if (!seasonOpt) throw new Error('Saison nicht gefunden');
  r = await jsfPost(athleteUrl, session, vs, guid, F.season, { ...base, [F.year]: yearOpt.value, [F.season]: seasonOpt.value });
  vs = r.vs; await wait(500);

  // Kategorie: W (Frauen)
  const catOpts = getOptions(r.html || html, F.category);
  const catOpt  = catOpts.find(o => o.value === 'W' || o.label === 'W' || o.label.toLowerCase().includes('frauen'))
    || catOpts.find(o => o.value !== '') || catOpts[1] || catOpts[0];
  r = await jsfPost(athleteUrl, session, vs, guid, F.category, { ...base, [F.year]: yearOpt.value, [F.season]: seasonOpt.value, [F.category]: catOpt?.value || 'W' });
  vs = r.vs; await wait(600);

  // Disziplin
  const discOpts = getOptions(r.html, F.discipline);
  const discOpt  = findOpt(discOpts, combo.disc);
  if (!discOpt) throw new Error(`Disziplin "${combo.disc}" nicht gefunden (${discOpts.map(o=>o.label).join(', ')})`);
  r = await jsfPost(athleteUrl, session, vs, guid, F.discipline, { ...base, [F.year]: yearOpt.value, [F.season]: seasonOpt.value, [F.category]: catOpt?.value || 'W', [F.discipline]: discOpt.value });
  vs = r.vs; await wait(500);

  // Typ: alle Resultate (0)
  const typeOpts = getOptions(r.html, F.type);
  const typeOpt  = typeOpts.find(o => o.value === '0') || typeOpts[0];

  // Tops: 100
  const topsOpts = getOptions(r.html, F.tops);
  const topsOpt  = topsOpts.find(o => o.label.trim() === '100') || topsOpts.find(o => o.label.trim() === '200') || topsOpts[topsOpts.length - 1];

  // Anzeigen
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
      cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim());
    }
    if (cells.length < 4) continue;

    // Extract by label prefix (matches original v5 logic)
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
    const numResult = parseFloat(resClean.replace(',','.').replace(':','.')) || 0;

    // Rang-Parser: "5h2" → "5. Lauf 2", "3f" → "3. Final", "1r1" → "1. Runde 1"
    const placeFormatted = (() => {
      const v = place.trim();
      const m = v.match(/^(\d+)([fFhHrRvVaAbBcC]?)(\d*)$/);
      if (!m) return v || '';
      const pos = m[1], typ = m[2].toLowerCase(), num = m[3];
      const typMap = { f:'Final', h:'Lauf', r:'Runde', v:'Vorlauf', a:'A-Final', b:'B-Final', c:'C-Final' };
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
      venue,
      competition:     comp,
      date:            dateStr,
      dateISO,
      year,
      place:           placeFormatted,
      source:          'swiss-athletics',
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
  console.log(res.ok ? '   ✅ KV OK' : `   ❌ KV Fehler ${res.status}`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Swiss Athletics Athleten-Resultate Scraper v6 (No Browser)\n');

  // Schritt 1: Fiona's Profil-URL finden
  console.log('🔍 Suche Fiona Matt auf Swiss Athletics...');
  const { url: athleteUrl, session, guid } = await findFionaUrl();
  console.log(`✅ Gefunden: ${athleteUrl}\n`);

  const allResults = [];

  // Schritt 2: Jede Disziplin scrapen
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

  // Deduplizieren
  const seen = new Set();
  const unique = allResults.filter(r => {
    const key = `${r.discipline}|${r.date}|${r.result}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  // Sortieren: neueste zuerst
  unique.sort((a, b) => b.dateISO.localeCompare(a.dateISO));

  // PBs berechnen (windlegale Resultate)
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

  if (process.argv.includes('--upload') && CF_ACCOUNT_ID) {
    await uploadKV(output);
  }

  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
