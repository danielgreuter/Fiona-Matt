#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v27
 * Strategie: Direkte HTTP-Requests statt Playwright-Browser
 * PrimeFaces AJAX POST → viel schneller, kein Cookie-Banner-Problem
 */

const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';
const UPLOAD = process.argv.includes('--upload');

const BASE_URL = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml';

const DISCIPLINES = [
  { key:'100m',           year:'2026', season:'false', label:'100 m' },
  { key:'100m_2025',      year:'2025', season:'false', label:'100 m' },
  { key:'60m',            year:'2026', season:'true',  label:'60 m'  },
  { key:'60m_2025',       year:'2025', season:'true',  label:'60 m'  },
  { key:'200m',           year:'2026', season:'false', label:'200 m' },
  { key:'200m_2025',      year:'2025', season:'false', label:'200 m' },
  { key:'Long Jump',      year:'2026', season:'false', label:'Weit'  },
  { key:'Long Jump_2025', year:'2025', season:'false', label:'Weit'  },
];

const FIONA = 'Fiona Matt';
const TOP_N = 15;

// ── HTML-Hilfsfunktionen ──────────────────────────────────────────────────────

function extractViewState(html) {
  const m = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/);
  return m ? m[1] : null;
}

function extractOptionValue(html, selectId, labelText) {
  // Suche <select id="..."> ... <option value="X">labelText</option>
  const selRe = new RegExp(`id="${selectId.replace(/:/g,'\\:')}"[\\s\\S]*?</select>`);
  const selMatch = html.match(selRe);
  if (!selMatch) {
    // Fallback: suche global nach der Option
    const optRe = new RegExp(`<option[^>]*value="([^"]*)"[^>]*>\\s*${escapeRe(labelText)}\\s*</option>`);
    const m = html.match(optRe);
    return m ? m[1] : null;
  }
  const optRe = new RegExp(`<option[^>]*value="([^"]*)"[^>]*>\\s*${escapeRe(labelText)}\\s*</option>`);
  const m = selMatch[0].match(optRe);
  return m ? m[1] : null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractWindowGuid(html) {
  const m = html.match(/aeswindowguid.*?value="([^"]+)"/);
  return m ? m[1] : '';
}

// ── Session + ViewState holen ─────────────────────────────────────────────────

async function initSession() {
  const res = await fetch(`${BASE_URL}?lang=de`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'de-CH,de;q=0.9',
    },
    redirect: 'follow',
  });

  const html = await res.text();
  const cookies = res.headers.get('set-cookie') || '';
  const viewState = extractViewState(html);
  const windowGuid = extractWindowGuid(html);

  // Session-Cookie extrahieren (JSESSIONID)
  const sessionCookie = (cookies.match(/JSESSIONID=[^;]+/) || [])[0] || '';

  console.log(`  Session: ${sessionCookie ? '✓' : '✗'}  ViewState: ${viewState ? '✓' : '✗'}  GUID: ${windowGuid ? '✓' : '✗'}`);

  return { html, viewState, windowGuid, sessionCookie };
}

// ── PrimeFaces AJAX POST ──────────────────────────────────────────────────────

async function pfAjax(session, sourceId, value, renderIds) {
  const { sessionCookie, windowGuid } = session;
  let vs = session.viewState;

  const body = new URLSearchParams({
    'javax.faces.partial.ajax': 'true',
    'javax.faces.source': sourceId,
    'javax.faces.partial.execute': sourceId,
    'javax.faces.partial.render': renderIds,
    [sourceId]: value,
    'javax.faces.ViewState': vs,
    'aeswindowguid': windowGuid,
    'form_anonym': 'form_anonym',
  });

  const res = await fetch(`${BASE_URL}?lang=de`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': sessionCookie,
      'Referer': `${BASE_URL}?lang=de`,
      'Origin': 'https://alabus.swiss-athletics.ch',
    },
    body: body.toString(),
  });

  const xml = await res.text();

  // Neuen ViewState extrahieren falls vorhanden
  const newVs = extractViewState(xml) || vs;
  session.viewState = newVs;

  // Set-Cookie updaten
  const newCookie = res.headers.get('set-cookie');
  if (newCookie) {
    const jsid = newCookie.match(/JSESSIONID=[^;]+/);
    if (jsid) session.sessionCookie = jsid[0];
  }

  return xml;
}

// ── Resultate aus HTML/XML parsen ─────────────────────────────────────────────

function parseResults(html) {
  // Suche nach Zeilen mit data-ri Attribut (PrimeFaces DataTable)
  const rows = [];
  const rowRe = /data-ri="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cm;
    while ((cm = cellRe.exec(m[2])) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim());
    }
    if (cells.length >= 4 && /^\d+$/.test(cells[0])) rows.push(cells);
  }

  // Fallback: Zeilen ohne data-ri aber mit typischem Muster (Nr | Zeit | Wind | ...)
  if (rows.length === 0) {
    const trRe = /<tr[^>]*class="[^"]*ui-widget-content[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
    while ((m = trRe.exec(html)) !== null) {
      const cells = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let cm;
      while ((cm = cellRe.exec(m[1])) !== null) {
        cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim());
      }
      if (cells.length >= 4 && /^\d+$/.test(cells[0])) rows.push(cells);
    }
  }

  return rows;
}

function mapRows(rawRows) {
  return rawRows.map(cells => {
    const rank = parseInt(cells[0]);
    if (isNaN(rank)) return null;
    const result = cells[1] || '';
    let wind = null, nameIdx = 4;
    if (cells[2] && /^[+-]?\d+\.\d$/.test(cells[2])) { wind = cells[2]; }
    else { nameIdx = 3; }
    const name = cells[nameIdx] || '';
    const club = cells[nameIdx+1] || '';
    const date = cells.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test(c)) || '';
    return { rank, result, wind, name, club, date };
  }).filter(r => r && r.result && r.name);
}

// ── Upload to Cloudflare KV ───────────────────────────────────────────────────

async function uploadToKV(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const j = await res.json();
  if (!j.success) throw new Error(`KV failed: ${JSON.stringify(j.errors)}`);
}

// ── Scrape one discipline ─────────────────────────────────────────────────────

async function scrapeDiscipline(disc) {
  const { key, year, season, label } = disc;
  console.log(`\n📋 ${key}  (${season === 'true' ? 'Indoor' : 'Outdoor'} ${year} — "${label}")`);

  // Frische Session pro Disziplin (ViewState ist session-gebunden)
  const session = await initSession();
  if (!session.viewState) {
    console.error('  ✗ ViewState nicht gefunden');
    return { discipline: key, year, error: 'no_viewstate', top15: [], fiona: null };
  }

  // Option-Values aus initiellem HTML extrahieren
  const categoryValue = extractOptionValue(session.html, 'form_anonym:bestlistCategory_input', 'U18 Frauen');
  const disciplineValue = extractOptionValue(session.html, 'form_anonym:bestlistDiscipline_input', label)
                       || extractOptionValue(session.html, 'form_anonym:bestlistDiscipline_input', label.split(' ')[0], true);
  const typeValue = extractOptionValue(session.html, 'form_anonym:bestlistType_input', 'Ein Resultat pro Athlet');

  console.log(`  Werte → Saison:${season} Kat:${categoryValue?.substring(0,8)}… Disc:${disciplineValue} Typ:${typeValue}`);

  // 1. Saison setzen
  let xml = await pfAjax(session,
    'form_anonym:bestlistSeason',
    season,
    'form_anonym:bestlistSearches globalMsgs'
  );
  console.log(`  Saison AJAX: ${xml.length} Zeichen`);

  // Neue Disc-Options aus AJAX-Response
  const discValueFromAjax = extractOptionValue(xml, 'form_anonym:bestlistDiscipline_input', label);

  // 2. Kategorie setzen
  if (!categoryValue) { console.error('  ✗ Kategorie-Value nicht gefunden'); return { discipline:key, year, error:'no_category_value', top15:[], fiona:null }; }
  xml = await pfAjax(session,
    'form_anonym:bestlistCategory',
    categoryValue,
    'form_anonym:bestlistSearches globalMsgs form_anonym:categoryExclusive'
  );
  console.log(`  Kategorie AJAX: ${xml.length} Zeichen`);

  // Disc-Options nochmals aus Kategorie-Response
  const discVal = extractOptionValue(xml, 'form_anonym:bestlistDiscipline_input', label)
               || discValueFromAjax || disciplineValue;

  // 3. Jahr setzen
  xml = await pfAjax(session,
    'form_anonym:bestlistYear',
    year,
    'form_anonym:bestlistSearches globalMsgs'
  );
  console.log(`  Jahr AJAX: ${xml.length} Zeichen`);

  // 4. Disziplin setzen
  if (!discVal) { console.error(`  ✗ Disziplin-Value für "${label}" nicht gefunden`); return { discipline:key, year, error:'no_disc_value', top15:[], fiona:null }; }
  xml = await pfAjax(session,
    'form_anonym:bestlistDiscipline',
    discVal,
    'form_anonym:bestlistSearches globalMsgs'
  );
  console.log(`  Disziplin AJAX: ${xml.length} Zeichen`);

  // 5. Typ: Ein Resultat pro Athlet
  if (typeValue) {
    xml = await pfAjax(session,
      'form_anonym:bestlistType',
      typeValue,
      'form_anonym:bestlistSearches globalMsgs'
    );
    console.log(`  Typ AJAX: ${xml.length} Zeichen`);
  }

  // 6. Anzahl: 30
  xml = await pfAjax(session,
    'form_anonym:bestlistTops',
    '30',
    'form_anonym:bestlistSearches globalMsgs'
  );
  console.log(`  Tops AJAX: ${xml.length} Zeichen`);

  // Resultate parsen
  const rawRows = parseResults(xml);
  console.log(`  → ${rawRows.length} Zeilen | Roh[0]: ${JSON.stringify(rawRows[0]?.slice(0,5))}`);

  const rows  = mapRows(rawRows);
  const top15 = rows.slice(0, TOP_N).map(r => ({
    rank: r.rank, name: r.name, result: r.result,
    wind: r.wind, club: r.club, date: r.date,
    isFiona: r.name.includes(FIONA),
  }));

  const fEntry = rows.find(r => r.name.includes(FIONA));
  const fiona  = fEntry ? {
    rank: fEntry.rank, result: fEntry.result, wind: fEntry.wind, date: fEntry.date,
    gapToFirst: rows[0] ? `+${(parseFloat(fEntry.result)-parseFloat(rows[0].result)).toFixed(2)}` : null,
  } : null;

  if (fiona) console.log(`  ⭐ Fiona: Rang ${fiona.rank} — ${fiona.result}`);
  return { discipline: key, year, scraped: new Date().toISOString(), fiona, top15 };
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const results = {};
  for (const disc of DISCIPLINES) {
    results[disc.key] = await scrapeDiscipline(disc);
  }

  const output = { updated: new Date().toISOString(), disciplines: results };
  fs.writeFileSync('bestenliste.json', JSON.stringify(output, null, 2));
  console.log('\n✅ bestenliste.json geschrieben');

  if (UPLOAD) {
    console.log('⬆ KV Upload…');
    await uploadToKV('bestenliste', output);
    console.log('✅ fertig');
  }
})();
