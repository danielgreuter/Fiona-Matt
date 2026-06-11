// scrape_athlete_results_v46.js
// Basis: v51 + v52: Disziplin-Token irgendwo im Event-Namen (mehrsprachig: lungo/longueur), Huerden/Staffel-Filter IT/FR, Ausland-Skip, Event-Namen-Diagnose
// Alles aus v42 bleibt 1:1. Neu sind nur die mit  // ▼ NEU  markierten Blöcke.

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';

const FALLBACK_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
const SA_BASE = 'https://www.swiss-athletics.ch/wettkaempfe/resultate/bestenliste/bestenliste-pro-athlet/in-resultate/';

const DISC_IDS = {
  '80m':       '5c4o3k5m-d686mo-j986g2ie-1-j986gefj-3vd',
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

const QUERIES = [
  { disc: '80m',       indoor: false  },
  { disc: '60m',       indoor: true   },
  { disc: '60m',       indoor: false  },
  { disc: '100m',      indoor: false  },
  { disc: '200m',      indoor: true   },
  { disc: '200m',      indoor: false  },
  { disc: 'Long Jump', indoor: true   },
  { disc: 'Long Jump', indoor: false  },
];
const YEARS = [2026, 2025, 2024];

function buildSaUrl(con, year, cat, disc, indoor) {
  const p = new URLSearchParams({
    mobile: 'false', blyear: String(year), con,
    blcat: CAT_IDS[cat], disci: DISC_IDS[disc], top: '30', srb: '0',
  });
  p.set('indoor', indoor ? 'true' : 'false');
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

function extractDate(c)   { const m = c.match(/(\d{2}\.\d{2}\.\d{4})/); return m?.[1] ?? null; }
function extractResult(c) { const m = c.match(/(\d+)[,.](\d{2,3})(?!\d)/); return m?.[0] ?? null; }
function extractWind(c)   { const m = c.replace('Wind','').match(/([+\-]?\d+\.\d)/); return m ? parseFloat(m[1]) : null; }

function parseRowCells(cells, disc, indoor, year) {
  const dateStr = cells.map(extractDate).find(Boolean);
  if (!dateStr) return null;
  const dp = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!dp || parseInt(dp[3]) !== year) return null;
  const resultStr = (() => {
    for (const c of cells) { if (c.startsWith('Resultat') || c.includes('Resultat')) { const r = extractResult(c); if (r) return r; } }
    return cells.map(extractResult).find(Boolean);
  })();
  if (!resultStr) return null;
  let venue = '', competition = '', windStr = null, place = null;
  for (const c of cells) {
    if (c.startsWith('Ort'))        venue       = c.slice(3).trim();
    if (c.startsWith('Wettkampf')) competition = c.slice(9).trim();
    if (c.startsWith('Wind'))      windStr     = extractWind(c);
    if (c.startsWith('Rang')) { const full = c.slice(4).trim(); place = full || null; }
  }
  const windNum = windStr ? parseFloat(windStr) : NaN;
  return {
    discipline: disc, indoor,
    result: resultStr, numResult: parseFloat(resultStr.replace(',', '.')),
    wind: windStr || null, windAssisted: !isNaN(windNum) && windNum > 2.0,
    venue, competition,
    date: dateStr, dateISO: `${dp[3]}-${dp[2]}-${dp[1]}`,
    year: parseInt(dp[3]), place, source: 'swiss-athletics',
  };
}

// Robust goto: Retry bei transienten Netzwerkfehlern (ERR_CONNECTION_REFUSED etc.)
async function gotoRetry(page, url, opts, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await page.goto(url, opts);
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e);
      const transient = /net::ERR_|ERR_CONNECTION|ERR_TIMED_OUT|ERR_EMPTY_RESPONSE|ERR_NETWORK_CHANGED|Timeout/i.test(msg);
      if (!transient || i === tries - 1) throw e;
      const wait = 3000 * (i + 1) * (i + 1);   // 3s, 12s, 27s
      console.log(`    \u23f3 goto fehlgeschlagen (${msg.split('\n')[0]}), Retry ${i + 1}/${tries - 1} in ${wait / 1000}s`);
      await page.waitForTimeout(wait);
    }
  }
  throw lastErr;
}

async function scrapeQuery(outer, inner, con, year, cat, disc, indoor) {
  const saUrl = buildSaUrl(con, year, cat, disc, indoor);

  await gotoRetry(outer, saUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await outer.waitForTimeout(4000);

  const iframeSrc = await outer.evaluate(() => {
    for (const f of document.querySelectorAll('iframe'))
      if (f.src?.includes('alabus') && f.src?.includes('satweb')) return f.src;
    return null;
  });
  if (!iframeSrc) { console.log(`    ⚠ Kein Iframe`); return []; }

  await gotoRetry(inner, iframeSrc, { waitUntil: 'networkidle', timeout: 30000 });
  await inner.waitForTimeout(1500);

  const info = await inner.evaluate(() => {
    const trs = [...document.querySelectorAll('table tr')];
    const dropdowns = {};
    ['bestlistYear','bestlistSeason','bestlistCategory','bestlistDiscipline'].forEach(id => {
      const el = document.querySelector(`[id$="${id}_label"]`);
      if (el) dropdowns[id.replace('bestlist','')] = el.textContent.trim();
    });
    return {
      count: trs.length,
      hasFiona: document.body.textContent.includes('Fiona'),
      noData: trs[1]?.textContent?.includes('keine Daten') || trs[1]?.textContent?.includes('keine Resultate'),
      dropdowns,
      cells: trs[1] ? [...trs[1].querySelectorAll('td')].map(td => td.textContent.trim()).slice(0,4) : [],
    };
  });

  const season = indoor ? 'Indoor' : 'Outdoor';
  console.log(`  ${disc} ${season}: rows=${info.count} fiona=${info.hasFiona} noData=${info.noData} | Saison="${info.dropdowns.Season}" Disziplin="${info.dropdowns.Discipline}"`);

  if (info.count < 2 || !info.hasFiona || info.noData) return [];

  const rawRows = await inner.evaluate(() =>
    [...document.querySelectorAll('table tbody tr, table tr')]
      .filter(tr => tr.querySelectorAll('td').length >= 4)
      .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
      .filter(cols => /\d{2}\.\d{2}\.\d{4}/.test(cols.join('|')))
  );

  return rawRows.map(cols => parseRowCells(cols, disc, indoor, year)).filter(Boolean);
}

// ▼ NEU ─────────────────────────────────────────────────────────────────────
// laportal Top5-Anreicherung
const LAPORTAL_BASE = 'https://slv.laportal.net';
const DE_MONTHS = { 'Januar':1,'Februar':2,'März':3,'April':4,'Mai':5,'Juni':6,
  'Juli':7,'August':8,'September':9,'Oktober':10,'November':11,'Dezember':12 };
// Portal kuerzt Monate ab ("06. - 07. Jun 2026") -> Aufloesung ueber 3-Buchstaben-Prefix,
// inkl. engl. Varianten (Mar/May/Oct/Dec), franz. Eigenheiten egal (Prefix passt meist).
const MONTH_PREFIX = { jan:1, feb:2, mar:3, 'mär':3, mrz:3, apr:4, mai:5, may:5, jun:6,
  jul:7, aug:8, sep:9, okt:10, oct:10, nov:11, dez:12, dec:12 };
function resolveMonth(tok) {
  if (!tok) return null;
  const t = String(tok).replace(/\./g, '').trim();
  if (DE_MONTHS[t]) return DE_MONTHS[t];
  const p = t.toLowerCase().slice(0, 3);
  return MONTH_PREFIX[p] || null;
}

function parseAnyDate(s) {
  // 1) "30. Mai 2026", "06. - 07. Jun 2026", "13. Sep. 2025": erster Tag + Monat (ggf. abgekuerzt) + Jahr
  let m = String(s).match(/(\d{1,2})\.\s*(?:-\s*\d{1,2}\.\s*)?([A-Za-zäöüÄÖÜ]+)\.?\s*(\d{4})/);
  if (m) {
    const mo = resolveMonth(m[2]);
    if (mo) return `${m[3]}-${String(mo).padStart(2,'0')}-${String(parseInt(m[1])).padStart(2,'0')}`;
  }
  // 2) numerisch: erstes "dd.mm." nehmen, Jahr ist die erste 4-stellige Zahl danach
  //    deckt ab: "07.06.2026", "05.06.2026 - 07.06.2026", "05.06. - 07.06.2026"
  m = String(s).match(/(\d{1,2})\.(\d{1,2})\.[\s\S]*?(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}
const parseGermanDate = parseAnyDate; // Rueckwaertskompatibel
function laportalDiscTokens(disc) {
  if (disc === 'Long Jump') return ['weitsprung', 'saltoinlungo', 'lungo', 'longueur', 'longjump', 'weit'];
  return [String(disc).toLowerCase().replace(/\s+/g, '')]; // 60m / 80m / 100m / 200m
}
function dayDiff(isoA, isoB) {
  return Math.abs((new Date(isoA) - new Date(isoB)) / 86400000);
}
let LAP_BUDGET = 900;            // harte Obergrenze an laportal-Seitenabrufen
async function lapGet(page, url) {
  LAP_BUDGET--;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(500);
  return await page.content();
}
// Robust: Past-Seite laden, auf Wettkampf-Links warten, 1x Retry
async function lapGetPast(page, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      LAP_BUDGET--;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('a[href*="/Competitions/Details/"]', { timeout: 8000 }).catch(() => {});
      const html = await page.content();
      // Tolerant: jede <tr>, die einen Details-Link enthaelt
      const rows = [];
      for (const chunk of html.split(/<tr[\s>]/).slice(1)) {
        const idM = chunk.match(/\/Competitions\/Details\/(\d+)/);
        if (!idM) continue;
        const cells = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
          .map(c => c[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
        if (cells.length < 2) continue;
        const dateCell = cells.find(c => /\d{1,2}\.\s*([A-Za-zäöü]+\s*\d{4}|\d{1,2}\.)/.test(c)) || cells[0];
        const rest = cells.filter(c => c !== dateCell && c.length > 1);
        rows.push([null, idM[1], dateCell, rest[0] || '', rest[1] || '']);
      }
      if (rows.length) return rows;
      // Diagnose: warum keine Zeilen?
      const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
      console.log(`   \u26a0 Past-Seite ohne Wettkampf-Zeilen (Versuch ${attempt + 1}). <title>: ${title.trim()}`);
      console.log(`   \u26a0 Seitentext-Anfang: ${text}`);
    } catch { /* retry */ }
    await page.waitForTimeout(500);
  }
  return [];
}

// Archiv-Index aufbauen: Current-Liste (Live-Resultate) + Past vollstaendig.
// Wichtig: die Past-Liste ist NICHT streng nach Datum sortiert -> kein Early-Break.
async function buildCompIndex(page, oldestISO) {
  const index = [];
  const seenIds = new Set();
  const addRows = (rows) => {
    let added = 0;
    for (const r of rows) {
      const iso = parseGermanDate(r[2]);
      if (!iso) continue;
      if (seenIds.has(r[1])) continue;
      seenIds.add(r[1]);
      const name = r[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const ort  = r[4].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      index.push({ compId: r[1], iso, name, ort });
      added++;
    }
    return added;
  };

  // 1) Current (aktuelle/kuerzliche Wettkaempfe mit Live-Resultaten) - wenige Seiten
  for (let pg = 1; pg <= 5; pg++) {
    const url = pg === 1 ? `${LAPORTAL_BASE}/Competitions/Current`
                         : `${LAPORTAL_BASE}/Competitions/Current?page=${pg}`;
    const rows = await lapGetPast(page, url);
    console.log(`   Current Seite ${pg}: ${rows.length} Zeilen`);
    if (!rows.length) break;
    addRows(rows);
  }

  // 2) Past vollstaendig blaettern (Ende = 3 leere Seiten in Folge oder MAX_PAGES)
  const MAX_PAGES = 120;
  let emptyStreak = 0;
  for (let pg = 1; pg <= MAX_PAGES; pg++) {
    if (LAP_BUDGET <= 150) { console.log(`   \u26a0 Past-Blaettern bei Seite ${pg} gestoppt (Budget-Reserve)`); break; }
    const url = pg === 1 ? `${LAPORTAL_BASE}/Competitions/Past`
                         : `${LAPORTAL_BASE}/Competitions/Past?page=${pg}`;
    const rows = await lapGetPast(page, url);
    if (pg <= 3 || pg % 20 === 0) console.log(`   Past Seite ${pg}: ${rows.length} Zeilen`);
    if (!rows.length) {
      if (++emptyStreak >= 3) break;   // echtes Ende nach 3 leeren Seiten in Folge
      continue;                        // einzelne wackelige Seite überspringen
    }
    emptyStreak = 0;
    addRows(rows);
  }

  if (index.length) {
    console.log(`   Index-Beispiele: ${index.slice(0, 3).map(c => `${c.iso} ${c.name} (${c.ort})`).join(' | ')}`);
  }
  return index;
}

// Ortsnamen normalisieren (für Reihenfolge-Optimierung, nicht für Korrektheit)
function normVenue(s) {
  return (s || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')        // (AUT) etc. raus
    .replace(/[\/].*/, ' ')           // "Magglingen /Macolin" -> "Magglingen"
    .replace(/[^a-zäöü ]/g, ' ')
    .trim().split(/\s+/)[0] || '';
}
// ALLE passenden Wettkämpfe eines Datums (±1 Tag), sortiert: bester Ort-Match zuerst
function matchComps(result, index) {
  const cand = index.filter(c => dayDiff(c.iso, result.dateISO) <= 2);
  if (!cand.length) return [];
  const v = normVenue(result.venue);
  const cn = (result.competition || '').toLowerCase().split(/[ (]/)[0];
  const score = (c) => {
    let s = 0;
    if (c.iso === result.dateISO) s += 1;
    const o = normVenue(c.ort);
    if (v && o && (o === v || o.includes(v) || v.includes(o))) s += 4;
    if (cn && c.name.toLowerCase().includes(cn)) s += 2;
    return s;
  };
  return cand.map(c => ({ c, s: score(c) }))
             .sort((a, b) => b.s - a.s)
             .map(x => x.c)
             .slice(0, 6); // pro Tag höchstens 6 Meetings probieren
}

// Disziplin-Events einer Detailseite holen (gecacht)
async function getEvents(page, compId, cache) {
  if (cache[compId]) return cache[compId];
  let html;
  try { html = await lapGet(page, `${LAPORTAL_BASE}/Competitions/Details/${compId}`); }
  catch { cache[compId] = []; return []; }
  let events = [...html.matchAll(
    /\/Competitions\/(CurrentList|ResultList)\/(\d+)\/(\d+)">\s*<div class="blockround"[\s\S]*?class="mainname">\s*([\s\S]*?)\s*<\/div>/g
  )].map(e => ({
    verb: e[1], eid: e[2], compId: e[3],
    name: e[4].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),
  }));
  if (!events.length) {
    // Fallback: Link + bis zu 160 Zeichen danach als Name (Markup-Varianten)
    events = [...html.matchAll(/\/Competitions\/(CurrentList|ResultList)\/(\d+)\/(\d+)"[^>]*>([\s\S]{0,160}?)<\/a>/g)]
      .map(e => ({
        verb: e[1], eid: e[2], compId: e[3],
        name: e[4].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),
      }))
      .filter(e => e.name);
  }
  cache[compId] = events;
  return events;
}

function candidatesFor(events, disc) {
  const toks = laportalDiscTokens(disc);
  const isTrack = /^\d+m$/.test(toks[0]);
  const cands = events.filter(e => {
    const name = e.name || '';
    // Huerden/Staffeln raus (DE/EN/IT/FR)
    if (/h\u00fcrden|huerden|hurdles|ostacoli|haies/i.test(name)) return false;
    if (/staffel|staffetta|relais|relay|\d\s*[x\u00d7]\s*\d/i.test(name)) return false;
    const flat = name.toLowerCase().replace(/\s+/g, '');
    if (isTrack) {
      // Token irgendwo, aber nicht Teil einer groesseren Zahl / Staffelangabe (1000m, 4x100m)
      const re = new RegExp('(^|[^0-9x\u00d7])' + toks[0] + '(?![0-9])');
      return re.test(flat);
    }
    return toks.some(t => flat.includes(t));
  });
  // Frauen-/Maedchen-Events zuerst (DE/IT/FR/EN), innerhalb davon Finale/Gesamt vor Vorlaeufen
  const wRe = /frauen|damen|m\u00e4dchen|maedchen|girls|wom|donne|ragazze|dames|femmes|filles|u\d+\s*w|w\s*u\d/i;
  const fRe = /finale?|gesamt|endlauf/i;
  const vRe = /vorlauf|vorl\u00e4ufe|vorlaeufe|serie|zeitlauf|heat|batterie/i;
  const sc = (e) => (wRe.test(e.name) ? 4 : 0) + (fRe.test(e.name) ? 2 : 0) - (vRe.test(e.name) ? 1 : 0);
  return cands.sort((a, b) => sc(b) - sc(a));
}

// Einen HTML-Abschnitt (Block) in Eintraege parsen
function parseEntryBlock(htmlPart) {
  const segs = htmlPart.split('<div class="entryline"').slice(1);
  const out = [];
  for (const e of segs) {
    const fl = [...e.matchAll(/<div class="firstline">\s*([\s\S]*?)\s*<\/div>/g)]
      .map(m => m[1].replace(/<[^>]+>/g,'').trim());
    const sl = [...e.matchAll(/<div class="secondline">\s*([\s\S]*?)\s*<\/div>/g)]
      .map(m => m[1].replace(/<[^>]+>/g,'').trim());
    const rank = parseInt(fl[0], 10);
    if (!Number.isInteger(rank)) continue;
    out.push({
      rank,
      name:   fl[1] || '',
      nat:    fl[2] || '',
      result: fl[3] || '',
      club:   sl[1] || '',
    });
  }
  return out;
}
// Gesamtergebnis (erster Block) parsen — Läufe/Zeitläufe ignorieren
function parseGesamtergebnis(html) {
  const positions = [...html.matchAll(/blocktable/g)].map(m => m.index);
  const cutPos = positions.length > 1 ? positions[1] : html.length;
  return parseEntryBlock(html.slice(0, cutPos));
}
// Fallback: alle Bloecke einzeln; liefert den Block, der Fiona enthaelt
function parseBlockWithFiona(html) {
  const positions = [...html.matchAll(/blocktable/g)].map(m => m.index);
  if (positions.length <= 1) return null;
  const bounds = [0, ...positions.slice(1), html.length];
  for (let i = 0; i < bounds.length - 1; i++) {
    const entries = parseEntryBlock(html.slice(bounds[i], bounds[i + 1]));
    if (entries.some(e => isFionaName(e.name))) return entries;
  }
  return null;
}

function isFionaName(nm) { return /matt/i.test(nm) && /fiona/i.test(nm); }

async function fetchRanking(page, verb, eid, compId) {
  // primärer Verb, sonst Fallback auf den anderen
  for (const v of [verb, verb === 'ResultList' ? 'CurrentList' : 'ResultList']) {
    try {
      const html = await lapGet(page, `${LAPORTAL_BASE}/Competitions/${v}/${eid}/${compId}`);
      const entries = parseGesamtergebnis(html);
      if (entries.length) {
        // Block 1 ohne Fiona? Dann pruefen, ob ein spaeterer Block (z.B. Vorlauf 2) sie enthaelt
        if (!entries.some(e => isFionaName(e.name))) {
          const fb = parseBlockWithFiona(html);
          if (fb) return fb;
        }
        return entries;
      }
      const fb = parseBlockWithFiona(html);
      if (fb) return fb;
    } catch { /* try next */ }
  }
  return [];
}

async function preloadExistingTop5(results) {
  try {
    const res = await fetch('https://fiona-proxy.daniel-greuter.workers.dev?action=sa-results');
    if (!res.ok) return 0;
    const old = await res.json();
    if (!old || !Array.isArray(old.results)) return 0;
    const map = new Map();
    old.results.forEach(r => {
      if (r.top5 && r.top5.length) map.set(`${r.discipline}|${r.date}|${r.result}`, r);
    });
    let n = 0;
    results.forEach(r => {
      const o = map.get(`${r.discipline}|${r.date}|${r.result}`);
      if (o) {
        r.top5 = o.top5;
        if (o.fionaRank != null) r.fionaRank = o.fionaRank;
        if (o.fieldSize != null) r.fieldSize = o.fieldSize;
        n++;
      }
    });
    return n;
  } catch { return 0; }
}

async function enrichWithTop5(page, results) {
  const kept = await preloadExistingTop5(results);
  if (kept) console.log(`\n\u267b Vorhandene Top5 \u00fcbernommen: ${kept}`);
  const dated = results.filter(r => r.dateISO && !(r.top5 && r.top5.length));
  if (!dated.length) { console.log('   Alle Resultate bereits angereichert.'); return; }
  const oldestISO = dated.map(r => r.dateISO).sort()[0];
  console.log(`\n🔗 laportal Top5-Anreicherung (${dated.length} fehlend, ab ${oldestISO}) …`);

  let index;
  try { index = await buildCompIndex(page, oldestISO); }
  catch (e) { console.log('   ⚠ Index fehlgeschlagen:', e.message); return; }
  console.log(`   Archiv indiziert: ${index.length} Wettkämpfe`);

  if (index.length) {
    const isos = index.map(c => c.iso).sort();
    console.log(`   Archiv-Zeitraum: ${isos[0]} … ${isos[isos.length-1]}`);
  }

  const eventCache = {};
  const listCache = {};
  let ok = 0, noComp = 0, noFiona = 0;

  const FOREIGN = /\((AUT|GER|DEU|ITA|FRA|MKD|BEL|NED|ESP|CZE|SVK|HUN|POL|SLO|CRO|GBR|USA|SEN)\)|\b(AUT|GER|MKD|BEL|NED|ESP|CZE|SVK|HUN|POL|SLO|CRO|GBR|USA|SEN)\s*$/;
  for (const r of results) {
    if (!r.dateISO) continue;
    if (r.top5 && r.top5.length) continue;
    if (FOREIGN.test(String(r.venue || '').trim())) {
      console.log(`   \u2013 ${r.discipline} ${r.date} (${r.venue}): Ausland, nicht im Schweizer Portal - \u00fcbersprungen`);
      continue;
    }
    try {
      const comps = matchComps(r, index);
      if (!comps.length) {
        noComp++;
        console.log(`   ✖ ${r.discipline} ${r.date} (${r.venue}): kein Wettkampf im Archiv an diesem Datum`);
        continue;
      }
      let found = false;
      for (const comp of comps) {
        if (LAP_BUDGET <= 0) break;
        const events = await getEvents(page, comp.compId, eventCache);
        const cands = candidatesFor(events, r.discipline);
        if (!cands.length) continue;
        for (const c of cands) {
          const cacheKey = `${c.verb}/${c.eid}/${c.compId}`;
          let entries = listCache[cacheKey];
          if (!entries) {
            entries = await fetchRanking(page, c.verb, c.eid, c.compId);
            listCache[cacheKey] = entries;
          }
          if (!entries.some(e => isFionaName(e.name))) continue;
          const top5 = entries.slice(0, 5).map(e => {
            const o = { rank: e.rank, name: e.name, club: e.club, result: e.result };
            if (isFionaName(e.name)) o.fiona = true;
            return o;
          });
          const fEntry = entries.find(e => isFionaName(e.name));
          r.top5 = top5;
          r.fionaRank = fEntry ? fEntry.rank : null;
          r.fieldSize = entries.length;
          ok++;
          found = true;
          console.log(`   ✅ ${r.discipline} ${r.date} (${comp.ort}): Rang ${r.fionaRank}/${entries.length}`);
          break;
        }
        if (found) break;
      }
      if (!found) {
        noFiona++;
        console.log(`   ✖ ${r.discipline} ${r.date} (${r.venue}): ${comps.length} Wettkampf/e geprüft, Fiona nicht in Rangliste gefunden`);
        for (const comp of comps.slice(0, 2)) {
          const evs = eventCache[comp.compId] || [];
          const cands2 = candidatesFor(evs, r.discipline);
          const detail = cands2.slice(0, 4).map(c => {
            const k = `${c.verb}/${c.eid}/${c.compId}`;
            const n = listCache[k] ? listCache[k].length : '?';
            return `"${c.name}"(${n})`;
          }).join(', ');
          console.log(`      \u21b3 ${comp.name} (${comp.ort}): ${evs.length} Events, Kandidaten: ${detail || 'keine'}`);
          if (!cands2.length && evs.length) {
            console.log(`         Events z.B.: ${evs.slice(0, 8).map(e => `"${e.name}"`).join(' | ')}`);
          }
        }
      }
    } catch (e) { console.log(`   ⚠ ${r.discipline} ${r.date}: ${e.message}`); }
  }
  console.log(`   Angereichert: ${ok}/${results.length}  (kein Wettkampf: ${noComp}, Fiona nicht gefunden: ${noFiona})`);
}
// ▲ NEU ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 v52\n');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const outer = await ctx.newPage();
  const inner = await ctx.newPage();
  console.log(`🔑 con: ${FALLBACK_CON}\n`);

  const allResults = [];
  for (const year of YEARS) {
    const cat = categoryForYear(year);
    console.log(`\n📅 ${year} (${cat})`);
    for (const { disc, indoor } of QUERIES) {
      const rows = await scrapeQuery(outer, inner, FALLBACK_CON, year, cat, disc, indoor);
      if (rows.length) {
        console.log(`    → ${rows.length} Resultate`);
        rows.forEach(r => console.log(`      ✅ ${r.result} | ${r.date} | ${r.competition}`));
      }
      allResults.push(...rows);
      await outer.waitForTimeout(1500);   // hoeflich: Rate-Limit vermeiden
    }
  }

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

  // ▼ NEU — Top5 pro Resultat anreichern (gleicher Browser-Context)
  try {
    const lapPage = await ctx.newPage();
    await enrichWithTop5(lapPage, unique);
    await lapPage.close();
  } catch (e) {
    console.log('⚠ Top5-Anreicherung übersprungen:', e.message);
  }
  // ▲ NEU

  await browser.close();

  console.log('\n📊 PBs:');
  Object.entries(pbByDisc).forEach(([d, r]) => console.log(`  ${d}: ${r.result} (${r.date})`));
  console.log(`📊 Total: ${unique.length}`);
  unique.forEach(r => console.log(`  ${r.year} ${r.discipline} ${r.indoor?'Indoor':'Outdoor'} ${r.result} | ${r.date} | ${r.venue}${r.fionaRank?` | Rang ${r.fionaRank}`:''}`));

  const output = {
    athlete: 'Fiona Matt', scraped: new Date().toISOString(),
    source: 'swiss-athletics', count: unique.length, pbs: pbByDisc, results: unique,
  };
  fs.writeFileSync('athlete_results.json', JSON.stringify(output, null, 2));
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(output);
  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
