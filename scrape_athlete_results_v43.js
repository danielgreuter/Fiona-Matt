// scrape_athlete_results_v43.js
// Basis: v42 (unverändert) + NEU: laportal Top5-Anreicherung pro Resultat
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

async function scrapeQuery(outer, inner, con, year, cat, disc, indoor) {
  const saUrl = buildSaUrl(con, year, cat, disc, indoor);

  await outer.goto(saUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await outer.waitForTimeout(4000);

  const iframeSrc = await outer.evaluate(() => {
    for (const f of document.querySelectorAll('iframe'))
      if (f.src?.includes('alabus') && f.src?.includes('satweb')) return f.src;
    return null;
  });
  if (!iframeSrc) { console.log(`    ⚠ Kein Iframe`); return []; }

  await inner.goto(iframeSrc, { waitUntil: 'networkidle', timeout: 30000 });
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

function parseGermanDate(s) { // "30. Mai 2026" -> "2026-05-30"
  const m = s.match(/(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\s*(\d{4})/);
  if (!m) return null;
  const mo = DE_MONTHS[m[2]];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2,'0')}-${String(parseInt(m[1])).padStart(2,'0')}`;
}
function laportalDiscToken(disc) {
  if (disc === 'Long Jump') return 'Weitsprung';
  return disc; // 60m / 80m / 100m / 200m
}
function dayDiff(isoA, isoB) {
  return Math.abs((new Date(isoA) - new Date(isoB)) / 86400000);
}
async function lapGet(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(600);
  return await page.content();
}

// Archiv-Index aufbauen, bis das älteste benötigte Datum erreicht ist
async function buildCompIndex(page, oldestISO) {
  const index = [];
  for (let pg = 1; pg <= 84; pg++) {
    const url = pg === 1 ? `${LAPORTAL_BASE}/Competitions/Past`
                         : `${LAPORTAL_BASE}/Competitions/Past?page=${pg}`;
    let html;
    try { html = await lapGet(page, url); } catch { break; }
    const rows = [...html.matchAll(
      /<tr>\s*<td>\s*<a class="display-block" href="\/Competitions\/Details\/(\d+)">\s*<time>(.*?)<\/time>[\s\S]*?<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g
    )];
    if (!rows.length) break;
    let pageMin = '9999-99-99';
    for (const r of rows) {
      const iso = parseGermanDate(r[2]);
      if (!iso) continue;
      if (iso < pageMin) pageMin = iso;
      const name = r[3].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      const ort  = r[4].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      index.push({ compId: r[1], iso, name, ort });
    }
    // 2 Tage Puffer für mehrtägige Meetings
    if (pageMin < oldestISO) break;
  }
  return index;
}

// Wettkampf zu einem Resultat finden (Datum ±1 Tag, dann Ort/Name als Tiebreaker)
function matchComp(result, index) {
  const cand = index.filter(c => dayDiff(c.iso, result.dateISO) <= 1);
  if (cand.length === 0) return null;
  if (cand.length === 1) return cand[0];
  const v = (result.venue || '').toLowerCase().split(/[ ,(]/)[0];
  const byOrt = cand.filter(c => v && c.ort.toLowerCase().includes(v));
  if (byOrt.length === 1) return byOrt[0];
  const pool = byOrt.length ? byOrt : cand;
  const cn = (result.competition || '').toLowerCase().split(/[ (]/)[0];
  const byName = pool.filter(c => cn && c.name.toLowerCase().includes(cn));
  if (byName.length) return byName[0];
  // exaktes Datum bevorzugen
  const exact = pool.find(c => c.iso === result.dateISO);
  return exact || pool[0];
}

// Disziplin-Events einer Detailseite holen (gecacht)
async function getEvents(page, compId, cache) {
  if (cache[compId]) return cache[compId];
  let html;
  try { html = await lapGet(page, `${LAPORTAL_BASE}/Competitions/Details/${compId}`); }
  catch { cache[compId] = []; return []; }
  const events = [...html.matchAll(
    /\/Competitions\/(CurrentList|ResultList)\/(\d+)\/(\d+)">\s*<div class="blockround"[\s\S]*?class="mainname">\s*([\s\S]*?)\s*<\/div>/g
  )].map(e => ({
    verb: e[1], eid: e[2], compId: e[3],
    name: e[4].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),
  }));
  cache[compId] = events;
  return events;
}

function candidatesFor(events, disc) {
  const tok = laportalDiscToken(disc);
  return events.filter(e => {
    if (!e.name.startsWith(tok)) return false;
    if (!/Frauen/i.test(e.name)) return false;
    if (/Hürden/i.test(e.name)) return false;
    return true;
  });
}

// Gesamtergebnis (erster Block) parsen — Läufe/Zeitläufe ignorieren
function parseGesamtergebnis(html) {
  const positions = [...html.matchAll(/blocktable/g)].map(m => m.index);
  const cutPos = positions.length > 1 ? positions[1] : html.length;
  const gesamt = html.slice(0, cutPos);
  const segs = gesamt.split('<div class="entryline"').slice(1);
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

function isFionaName(nm) { return /matt/i.test(nm) && /fiona/i.test(nm); }

async function fetchRanking(page, verb, eid, compId) {
  // primärer Verb, sonst Fallback auf den anderen
  for (const v of [verb, verb === 'ResultList' ? 'CurrentList' : 'ResultList']) {
    try {
      const html = await lapGet(page, `${LAPORTAL_BASE}/Competitions/${v}/${eid}/${compId}`);
      const entries = parseGesamtergebnis(html);
      if (entries.length) return entries;
    } catch { /* try next */ }
  }
  return [];
}

async function enrichWithTop5(page, results) {
  const dated = results.filter(r => r.dateISO);
  if (!dated.length) return;
  const oldestISO = dated.map(r => r.dateISO).sort()[0];
  console.log(`\n🔗 laportal Top5-Anreicherung (ab ${oldestISO}) …`);

  let index;
  try { index = await buildCompIndex(page, oldestISO); }
  catch (e) { console.log('   ⚠ Index fehlgeschlagen:', e.message); return; }
  console.log(`   Archiv indiziert: ${index.length} Wettkämpfe`);

  const eventCache = {};
  const listCache = {};
  let ok = 0;

  for (const r of results) {
    if (!r.dateISO) continue;
    try {
      const comp = matchComp(r, index);
      if (!comp) continue;
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
        console.log(`   ✅ ${r.discipline} ${r.date} (${comp.ort}): Rang ${r.fionaRank}/${entries.length}`);
        break;
      }
    } catch (e) { /* dieses Resultat überspringen, Rest läuft weiter */ }
  }
  console.log(`   Angereichert: ${ok}/${results.length} Resultate`);
}
// ▲ NEU ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 v43\n');
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
