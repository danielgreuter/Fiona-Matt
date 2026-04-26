#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v28
 * Fix: PrimeFaces Partial-Response XML → CDATA extrahieren → HTML parsen
 *      + Fallback: vollständiger Form-POST (button submit)
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

function extractViewState(text) {
  const m = text.match(/javax\.faces\.ViewState[^>]*value="([^"]+)"/s)
         || text.match(/<update id="javax\.faces\.ViewState"><!\[CDATA\[([^\]]+)\]\]>/);
  return m ? m[1] : null;
}

function extractWindowGuid(html) {
  const m = html.match(/name="aeswindowguid"[^>]*value="([^"]+)"/)
         || html.match(/aeswindowguid.*?value="([^"]+)"/);
  return m ? m[1] : '';
}

function extractOptionValue(html, selectId, labelText) {
  const re = new RegExp(`<option[^>]*value="([^"]*)"[^>]*>\\s*${escRe(labelText)}\\s*</option>`);
  const m = html.match(re);
  return m ? m[1] : null;
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── CDATA aus PrimeFaces Partial-Response extrahieren ─────────────────────────

function extractCdata(xml) {
  // <update id="..."><![CDATA[...HTML...]]></update>
  const parts = [];
  const re = /<update[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/update>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    parts.push(m[1]);
  }
  return parts.join('\n');
}

// ── Session initialisieren ────────────────────────────────────────────────────

async function initSession() {
  const res = await fetch(`${BASE_URL}?lang=de`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-CH,de;q=0.9',
    },
  });
  const html = await res.text();
  const setCookie = res.headers.get('set-cookie') || '';
  const sessionCookie = (setCookie.match(/JSESSIONID=[^;]+/) || [])[0]
    || (setCookie.match(/[A-Z_]+=\S+?(?=;|$)/) || [])[0] || '';
  const viewState = extractViewState(html);
  const windowGuid = extractWindowGuid(html);

  console.log(`  Session: ${sessionCookie?'✓':'✗'}  VS: ${viewState?'✓':'✗'}  GUID: ${windowGuid?'✓':'✗'}`);
  return { html, viewState, windowGuid, sessionCookie };
}

// ── PrimeFaces AJAX POST ──────────────────────────────────────────────────────

async function pfAjax(session, sourceId, value, renderIds) {
  const body = new URLSearchParams({
    'javax.faces.partial.ajax': 'true',
    'javax.faces.source': sourceId,
    'javax.faces.partial.execute': sourceId,
    'javax.faces.partial.render': renderIds,
    [sourceId]: value,
    'javax.faces.ViewState': session.viewState,
    'aeswindowguid': session.windowGuid,
    'form_anonym': 'form_anonym',
  });

  const res = await fetch(`${BASE_URL}?lang=de`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': session.sessionCookie,
      'Referer': `${BASE_URL}?lang=de`,
      'Origin': 'https://alabus.swiss-athletics.ch',
    },
    body: body.toString(),
  });

  const xml = await res.text();
  const newVs = extractViewState(xml);
  if (newVs) session.viewState = newVs;
  const newCookie = res.headers.get('set-cookie');
  if (newCookie) { const j = newCookie.match(/JSESSIONID=[^;]+/); if (j) session.sessionCookie = j[0]; }

  return xml;
}

// ── Vollständiger Form-POST (Button-Submit Simulation) ────────────────────────

async function fullFormPost(session, year, season, categoryValue, discValue, typeValue) {
  // Suche Button-ID im HTML
  const btnMatch = session.html.match(/id="(form_anonym:[^"]*(?:search|anzeig|show|spot)[^"]*)"/i)
                || session.html.match(/id="(form_anonym:j_idt\d+)"[^>]*type="submit"/i);
  const btnId = btnMatch ? btnMatch[1] : null;

  const params = {
    'form_anonym': 'form_anonym',
    'form_anonym:bestlistYear': year,
    'form_anonym:bestlistSeason': season,
    'form_anonym:bestlistCategory': categoryValue,
    'form_anonym:bestlistDiscipline': discValue,
    'form_anonym:bestlistType': typeValue || '1',
    'form_anonym:bestlistTops': '30',
    'javax.faces.ViewState': session.viewState,
    'aeswindowguid': session.windowGuid,
  };
  if (btnId) params[btnId] = btnId;

  const body = new URLSearchParams(params);

  const res = await fetch(`${BASE_URL}?lang=de`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': session.sessionCookie,
      'Referer': `${BASE_URL}?lang=de`,
    },
    body: body.toString(),
  });

  return await res.text();
}

// ── Resultate aus HTML parsen ─────────────────────────────────────────────────

function parseResults(html) {
  // Strategie 1: data-ri rows (PrimeFaces DataTable)
  let rows = [];
  const rowRe = /data-ri=["'](\d+)["'][^>]*>([\s\S]*?)(?=data-ri=["']\d+["']|<\/tbody>)/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cm;
    while ((cm = cellRe.exec(m[2])) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#[^;]+;/g,'').replace(/&nbsp;/g,' ').trim());
    }
    if (cells.length >= 4) rows.push(cells);
  }

  // Strategie 2: <tr> mit ui-widget-content
  if (rows.length === 0) {
    const trRe = /<tr[^>]*(?:ui-widget-content|odd|even)[^>]*>([\s\S]*?)<\/tr>/g;
    while ((m = trRe.exec(html)) !== null) {
      const cells = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let cm;
      while ((cm = cellRe.exec(m[1])) !== null) {
        cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim());
      }
      if (cells.length >= 4 && /^\d+$/.test((cells[0]||'').trim())) rows.push(cells);
    }
  }

  // Strategie 3: alle <tr><td>
  if (rows.length === 0) {
    const trRe2 = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    while ((m = trRe2.exec(html)) !== null) {
      const cells = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let cm;
      while ((cm = cellRe.exec(m[1])) !== null) {
        cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim());
      }
      if (cells.length >= 5 && /^\d+$/.test((cells[0]||'').trim())) rows.push(cells);
    }
  }

  return rows;
}

function mapRows(rawRows) {
  return rawRows.map(cells => {
    const rank = parseInt(cells[0]);
    if (isNaN(rank) || rank < 1 || rank > 500) return null;
    const result = (cells[1]||'').trim();
    let wind = null, nameIdx = 4;
    if ((cells[2]||'').match(/^[+-]?\d+\.\d$/)) { wind = cells[2]; }
    else { nameIdx = 3; }
    const name = (cells[nameIdx]||'').trim();
    const club = (cells[nameIdx+1]||'').trim();
    const date = cells.find(c => /^\d{2}\.\d{2}\.\d{4}$/.test((c||'').trim())) || '';
    return { rank, result, wind, name, club, date };
  }).filter(r => r && r.result && r.name);
}

// ── Upload KV ────────────────────────────────────────────────────────────────

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
  console.log(`\n📋 ${key}  (${season==='true'?'Indoor':'Outdoor'} ${year} — "${label}")`);

  const session = await initSession();
  if (!session.viewState) return { discipline:key, year, error:'no_viewstate', top15:[], fiona:null };

  const catVal  = extractOptionValue(session.html, 'form_anonym:bestlistCategory_input', 'U18 Frauen');
  const discVal = extractOptionValue(session.html, 'form_anonym:bestlistDiscipline_input', label);
  const typeVal = extractOptionValue(session.html, 'form_anonym:bestlistType_input', 'Ein Resultat pro Athlet');

  console.log(`  catVal=${catVal?.slice(0,12)}… discVal=${discVal?.slice(0,12)}… typeVal=${typeVal}`);

  if (!catVal)  return { discipline:key, year, error:'no_cat_val',  top15:[], fiona:null };
  if (!discVal) return { discipline:key, year, error:'no_disc_val', top15:[], fiona:null };

  // AJAX-Sequenz: Saison → Kat → Jahr → Disc → Typ → Tops
  let xml;
  xml = await pfAjax(session, 'form_anonym:bestlistSeason',    season,   'form_anonym:bestlistSearches globalMsgs');
  const discValAfterSeason = extractOptionValue(extractCdata(xml), 'form_anonym:bestlistDiscipline_input', label) || discVal;

  xml = await pfAjax(session, 'form_anonym:bestlistCategory',  catVal,   'form_anonym:bestlistSearches globalMsgs form_anonym:categoryExclusive');
  const discValAfterCat = extractOptionValue(extractCdata(xml), 'form_anonym:bestlistDiscipline_input', label) || discValAfterSeason;
  console.log(`  discVal nach Kategorie-AJAX: ${discValAfterCat?.slice(0,16)}…`);

  xml = await pfAjax(session, 'form_anonym:bestlistYear',      year,     'form_anonym:bestlistSearches globalMsgs');
  xml = await pfAjax(session, 'form_anonym:bestlistDiscipline', discValAfterCat, 'form_anonym:bestlistSearches globalMsgs');

  // CDATA aus letzter AJAX-Antwort
  let html = extractCdata(xml);
  let rawRows = parseResults(html);
  console.log(`  Nach Disziplin-AJAX: ${rawRows.length} Zeilen (${xml.length} Zeichen)`);

  if (rawRows.length === 0) {
    // Typ + Tops
    xml = await pfAjax(session, 'form_anonym:bestlistType', typeVal||'1', 'form_anonym:bestlistSearches globalMsgs');
    xml = await pfAjax(session, 'form_anonym:bestlistTops', '30',         'form_anonym:bestlistSearches globalMsgs');
    html = extractCdata(xml);
    rawRows = parseResults(html);
    console.log(`  Nach Tops-AJAX: ${rawRows.length} Zeilen`);
  }

  if (rawRows.length === 0) {
    // Fallback: vollständiger Form-POST
    console.log('  → Fallback: Full Form POST…');
    const fullHtml = await fullFormPost(session, year, season, catVal, discValAfterCat, typeVal);
    const fullCdata = extractCdata(fullHtml);
    rawRows = parseResults(fullCdata.length > 1000 ? fullCdata : fullHtml);
    console.log(`  Nach Full POST: ${rawRows.length} Zeilen (${fullHtml.length} Zeichen)`);
    if (rawRows.length === 0) {
      // Dump 500 Zeichen der CDATA für Diagnose
      console.log(`  CDATA snippet: ${(fullCdata||fullHtml).substring(0,500).replace(/\n/g,' ')}`);
    }
  }

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
  else console.log(`  Fiona nicht in Top-${TOP_N}. Erstes: ${rows[0]?.name} ${rows[0]?.result}`);
  return { discipline:key, year, scraped: new Date().toISOString(), fiona, top15 };
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const results = {};
  for (const disc of DISCIPLINES) {
    results[disc.key] = await scrapeDiscipline(disc);
  }
  const output = { updated: new Date().toISOString(), disciplines: results };
  fs.writeFileSync('bestenliste.json', JSON.stringify(output, null, 2));
  console.log('\n✅ bestenliste.json geschrieben');
  if (UPLOAD) {
    console.log('⬆ KV…');
    await uploadToKV('bestenliste', output);
    console.log('✅ fertig');
  }
})();
