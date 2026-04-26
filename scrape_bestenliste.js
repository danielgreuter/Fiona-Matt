#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v25
 *
 * Korrekte Lösung für Indoor/Outdoor:
 * Die Disziplin-Dropdowns in der Form haben UNTERSCHIEDLICHE Option-Values
 * für Indoor vs Outdoor. v25 liest die Outdoor-Discipline-IDs direkt aus
 * dem Formular (Year + Outdoor + U18 Frauen → Disziplin-Optionen).
 * Danach direkte URL-Navigation zu alabus mit den korrekten IDs.
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';
const UPLOAD = process.argv.includes('--upload');

const ALABUS_BASE = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml';
const CAT_U18F    = '5c4o3k5m-d686mo-j986g2ie-1-j986g45y-bn';

// Feste IDs (Indoor) — bleiben unverändert
const FIXED_IDS = {
  '100m':  '5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv',
  '60m':   '5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79',
};

const DISCIPLINES = [
  { key:'100m',           year:'2026', label:'100 m', indoor:false, isJump:false, discover:false },
  { key:'100m_2025',      year:'2025', label:'100 m', indoor:false, isJump:false, discover:false },
  { key:'60m',            year:'2026', label:'60 m',  indoor:true,  isJump:false, discover:false },
  { key:'60m_2025',       year:'2025', label:'60 m',  indoor:true,  isJump:false, discover:false },
  { key:'200m',           year:'2026', label:'200 m', indoor:false, isJump:false, discover:true  },
  { key:'200m_2025',      year:'2025', label:'200 m', indoor:false, isJump:false, discover:true  },
  { key:'Long Jump',      year:'2026', label:'Weit',  indoor:false, isJump:true,  discover:true  },
  { key:'Long Jump_2025', year:'2025', label:'Weit',  indoor:false, isJump:true,  discover:true  },
];

const wait = ms => new Promise(r => setTimeout(r, ms));

const yearSel   = 'form_anonym:bestlistYear_input';
const seasonSel = 'form_anonym:bestlistSeason_input';
const catSel    = 'form_anonym:bestlistCategory_input';
const discSel   = 'form_anonym:bestlistDiscipline_input';

async function selectAndTrigger(page, selectId, value) {
  const esc = selectId.replace(/:/g, '\\:');
  const loc = page.locator(`#${esc}`);
  await loc.waitFor({ timeout: 10000 });
  await loc.selectOption({ value });
  await loc.dispatchEvent('change');
  try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch(_) {}
  await wait(600);
}

async function findOptionValue(page, selectId, labelMatch) {
  const esc = selectId.replace(/:/g, '\\:');
  for (const opt of await page.locator(`#${esc} option`).all()) {
    const t = (await opt.textContent()).trim();
    if (t === labelMatch || t.startsWith(labelMatch)) return await opt.getAttribute('value');
  }
  return null;
}

// ── Outdoor Discipline-IDs aus Form lesen ──────────────────────

async function discoverOutdoorIds(page, year) {
  console.log(`  🔍 Entdecke Outdoor-IDs für ${year}...`);
  await page.goto(`${ALABUS_BASE}?lang=de`, { waitUntil: 'networkidle', timeout: 30000 });
  await wait(800);

  // Jahr
  const yearVal = await findOptionValue(page, yearSel, year);
  if (!yearVal) { console.log(`  ⚠️  Jahr ${year} nicht gefunden`); return {}; }
  await selectAndTrigger(page, yearSel, yearVal);

  // Saison Outdoor
  let outdoorVal = null;
  for (const opt of await page.locator(`#${seasonSel.replace(/:/g,'\\:')} option`).all()) {
    const t = (await opt.textContent()).trim().toLowerCase();
    if (t === 'outdoor') { outdoorVal = await opt.getAttribute('value'); break; }
  }
  if (!outdoorVal) { console.log(`  ⚠️  Outdoor-Option nicht gefunden`); return {}; }
  await selectAndTrigger(page, seasonSel, outdoorVal);

  // Kategorie U18 Frauen
  let catVal = null;
  for (const opt of await page.locator(`#${catSel.replace(/:/g,'\\:')} option`).all()) {
    if ((await opt.textContent()).trim() === 'U18 Frauen') { catVal = await opt.getAttribute('value'); break; }
  }
  if (!catVal) { console.log(`  ⚠️  U18 Frauen nicht gefunden`); return {}; }
  await selectAndTrigger(page, catSel, catVal);

  // Alle Disziplin-Optionen lesen
  const ids = {};
  for (const opt of await page.locator(`#${discSel.replace(/:/g,'\\:')} option`).all()) {
    const t = (await opt.textContent()).trim();
    const v = await opt.getAttribute('value');
    if (v && v !== '') ids[t] = v;
  }
  console.log(`  → Gefundene Outdoor-Disziplinen: ${Object.keys(ids).join(', ')}`);
  return ids;
}

// ── URL bauen ─────────────────────────────────────────────────

function buildUrl(discId, year, indoor) {
  const top = '30';
  const p = new URLSearchParams({ lang:'de', mobile:'false', blyear:year, blcat:CAT_U18F, disci:discId, top });
  if (indoor) p.set('indoor', 'true');
  return `${ALABUS_BASE}?${p}`;
}

// ── Zeilen parsen ─────────────────────────────────────────────

const NAME_RE = /^[A-ZÄÖÜ][a-zäöüéàèêâßë]+([ \-][A-ZÄÖÜ][a-zäöüéàèêâßë]+)+$/;
const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;
const WIND_RE = /^[+-]?\d+[.,]\d$/;

async function parseRows(page, isJump) {
  let found = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { await page.waitForSelector('table tbody tr', { timeout: 15000 }); found = true; break; }
    catch(_) {
      if (attempt === 1) {
        console.log(`   ⚠️  Timeout — Retry...`);
        await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
        await wait(2000);
      }
    }
  }
  if (!found) { console.log(`   ❌ Keine Zeilen`); return []; }

  const rowEls = await page.locator('table tbody tr').all();
  console.log(`   Zeilen: ${rowEls.length}`);

  const rows = [];
  for (const row of rowEls) {
    const cells = await row.locator('td').evaluateAll(tds =>
      tds.map(td => {
        const clone = td.cloneNode(true);
        clone.querySelectorAll('.ui-column-title').forEach(s => s.remove());
        return clone.innerText.replace(/\s+/g, ' ').trim();
      })
    );
    if (cells.length < 3) continue;

    const rank = parseInt(cells[0]);
    if (isNaN(rank) || rank < 1 || rank > 2000) continue;

    const result = cells[1] || '';
    const validResult = isJump
      ? /^\d+[.,]\d{2}$/.test(result)
      : /^\d{1,2}[:.]\d{2}(\.\d+)?$/.test(result);
    if (!validResult) continue;

    let name = '', wind = '', club = '', date = '';
    let nameIdx = -1;
    for (let ci = 2; ci < cells.length; ci++) {
      if (NAME_RE.test(cells[ci])) { name = cells[ci]; nameIdx = ci; break; }
    }
    if (nameIdx > 2 && WIND_RE.test(cells[nameIdx - 1])) wind = cells[nameIdx - 1];
    if (nameIdx >= 0 && nameIdx + 1 < cells.length) club = cells[nameIdx + 1];
    for (let ci = cells.length - 1; ci >= 0; ci--) {
      if (DATE_RE.test(cells[ci])) { date = cells[ci]; break; }
    }
    if (!name) continue;

    const isFiona = name.toLowerCase().includes('matt') ||
                    club.toLowerCase().includes('eschen-mauren');

    rows.push({ rank, name, result: result.replace(',','.'),
                wind: wind||null, club: club||null, date: date||null, isFiona });
  }
  return rows;
}

// ── Helpers ───────────────────────────────────────────────────

function toSec(t) {
  if (!t) return null;
  const p = t.split(':');
  return p.length === 2 ? parseFloat(p[0])*60+parseFloat(p[1]) : parseFloat(t)||null;
}
function calcGap(a, b) {
  const d = toSec(a) - toSec(b);
  return (d >= 0?'+':'')+Math.abs(d).toFixed(2);
}

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/bestenliste:fiona`;
  const res = await fetch(url, {
    method:'PUT',
    headers:{ 'Authorization':`Bearer ${CF_API_TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '✅ KV Upload OK' : `❌ KV Fehler ${res.status}`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Bestenliste Scraper v25 (Outdoor-IDs aus Form)\n');

  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  });
  const page = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0',
    locale: 'de-CH',
  }).then(ctx => ctx.newPage());

  // Outdoor-IDs einmalig für 2026 und 2025 entdecken
  const outdoorIds = {
    '2026': await discoverOutdoorIds(page, '2026'),
    '2025': await discoverOutdoorIds(page, '2025'),
  };
  console.log('');

  // Feste IDs für 100m und 60m (Indoor)
  const fixedDiscIds = {
    '100m':  FIXED_IDS['100m'],
    '60m':   FIXED_IDS['60m'],
  };

  const result = { updated: new Date().toISOString().split('T')[0], disciplines:{} };

  for (const disc of DISCIPLINES) {
    console.log(`📋 ${disc.key} (${disc.indoor?'Indoor':'Outdoor'} ${disc.year})`);

    // Discipline-ID bestimmen
    let discId;
    if (disc.discover) {
      discId = outdoorIds[disc.year][disc.label];
      if (!discId) {
        // Fallback: startsWith-Suche
        const match = Object.entries(outdoorIds[disc.year]).find(([k]) => k.startsWith(disc.label));
        discId = match ? match[1] : null;
      }
      if (!discId) {
        console.log(`   ❌ Kein Outdoor-ID für "${disc.label}" ${disc.year} gefunden`);
        result.disciplines[disc.key] = { error:'Outdoor-ID nicht gefunden', fiona:null, top15:[], total:0 };
        console.log(''); continue;
      }
      console.log(`   ID: ${discId}`);
    } else {
      discId = disc.indoor ? FIXED_IDS['60m'] : FIXED_IDS['100m'];
    }

    const url = buildUrl(discId, disc.year, disc.indoor);
    console.log(`   URL: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await wait(1500);
      const rows  = await parseRows(page, disc.isJump);
      const fiona = rows.find(r => r.isFiona);
      const top1  = rows[0];
      result.disciplines[disc.key] = {
        discipline:disc.key, year:disc.year, scraped:new Date().toISOString(),
        fiona: fiona ? {
          rank:fiona.rank, result:fiona.result, wind:fiona.wind||null, date:fiona.date,
          gapToFirst: top1&&top1.name!==fiona.name ? calcGap(fiona.result,top1.result) : null,
        } : null,
        top15: rows.slice(0,15), total: rows.length,
      };
      if (fiona)            console.log(`   ✅ Fiona: Rang ${fiona.rank} · ${fiona.result}`);
      else if (rows.length) console.log(`   ⚠️  Fiona nicht in Top ${rows.length}`);
      else                  console.log(`   ⚪ Keine Resultate`);
    } catch(e) {
      console.log(`   ❌ ${e.message}`);
      result.disciplines[disc.key] = { error:e.message, fiona:null, top15:[], total:0 };
    }
    console.log('');
  }

  await browser.close();
  fs.writeFileSync('bestenliste.json', JSON.stringify(result, null, 2));
  console.log('💾 bestenliste.json gespeichert');
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(result);
  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
