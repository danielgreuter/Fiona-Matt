#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v26
 *
 * Fazit nach Debugging: alabus hat keinen URL-basierten Outdoor-Filter.
 * Discipline-IDs sind saisonunabhängig — sie zeigen Indoor + Outdoor gemischt.
 * Lösung: top=200 abrufen, dann nach Datum filtern (Monat >= 4 = Outdoor).
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';
const UPLOAD = process.argv.includes('--upload');

const ALABUS_BASE = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml';
const CAT_U18F    = '5c4o3k5m-d686mo-j986g2ie-1-j986g45y-bn';

const DISCIPLINES = [
  { key:'100m',           year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv', indoor:false, isJump:false, outdoorOnly:false },
  { key:'100m_2025',      year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv', indoor:false, isJump:false, outdoorOnly:false },
  { key:'60m',            year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79',  indoor:true,  isJump:false, outdoorOnly:false },
  { key:'60m_2025',       year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79',  indoor:true,  isJump:false, outdoorOnly:false },
  { key:'200m',           year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ghgt-6ks', indoor:false, isJump:false, outdoorOnly:true  },
  { key:'200m_2025',      year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ghgt-6ks', indoor:false, isJump:false, outdoorOnly:true  },
  { key:'Long Jump',      year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ge5c-3mp', indoor:false, isJump:true,  outdoorOnly:true  },
  { key:'Long Jump_2025', year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ge5c-3mp', indoor:false, isJump:true,  outdoorOnly:true  },
];

const wait = ms => new Promise(r => setTimeout(r, ms));

function buildUrl(disc) {
  // Outdoor-Disziplinen: top=200 damit outdoor-Resultate sicher enthalten sind
  const top = disc.outdoorOnly ? '200' : '30';
  const p = new URLSearchParams({ lang:'de', mobile:'false', blyear:disc.year, blcat:CAT_U18F, disci:disc.discId, top });
  if (disc.indoor) p.set('indoor', 'true');
  return `${ALABUS_BASE}?${p}`;
}

function isOutdoor(dateStr) {
  if (!dateStr) return false;
  const m = parseInt((dateStr.split('.')[1]) || '0');
  return m >= 4; // April–Dezember = Outdoor
}

const NAME_RE = /^[A-ZÄÖÜ][a-zäöüéàèêâßë]+([ \-][A-ZÄÖÜ][a-zäöüéàèêâßë]+)+$/;
const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;
const WIND_RE = /^[+-]?\d+[.,]\d$/;

async function parseRows(page, disc) {
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
  console.log(`   Rohe Zeilen: ${rowEls.length}`);

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
    const validResult = disc.isJump
      ? /^\d+[.,]\d{2}$/.test(result)
      : /^\d{1,2}[:.]\d{2}(\.\d+)?$/.test(result);
    if (!validResult) continue;

    // Name dynamisch suchen (Indoor hat keine Wind-Spalte)
    let name = '', wind = '', club = '', date = '';
    let nameIdx = -1;
    for (let ci = 2; ci < cells.length; ci++) {
      if (NAME_RE.test(cells[ci])) { name = cells[ci]; nameIdx = ci; break; }
    }
    if (nameIdx > 2 && WIND_RE.test(cells[nameIdx - 1])) wind = cells[nameIdx - 1];
    if (nameIdx >= 0 && nameIdx + 1 < cells.length) club = cells[nameIdx + 1];
    // Letztes Datum = Wettkampfdatum (nicht Geburtsdatum)
    for (let ci = cells.length - 1; ci >= 0; ci--) {
      if (DATE_RE.test(cells[ci])) { date = cells[ci]; break; }
    }
    if (!name) continue;

    // Outdoor-Filter
    if (disc.outdoorOnly && !isOutdoor(date)) continue;

    const isFiona = name.toLowerCase().includes('matt') ||
                    club.toLowerCase().includes('eschen-mauren');

    rows.push({ rank, name, result: result.replace(',','.'),
                wind: wind||null, club: club||null, date: date||null, isFiona });
  }

  // Rang neu vergeben nach Filterung
  if (disc.outdoorOnly) rows.forEach((r, i) => { r.rank = i + 1; });

  console.log(`   Nach Outdoor-Filter: ${rows.length} Einträge`);
  return rows;
}

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

async function main() {
  console.log('🚀 Bestenliste Scraper v26 (top=200 + Outdoor-Datumfilter)\n');

  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  });
  const page = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0',
    locale: 'de-CH',
  }).then(ctx => ctx.newPage());

  const result = { updated: new Date().toISOString().split('T')[0], disciplines:{} };

  for (const disc of DISCIPLINES) {
    const tag = disc.indoor ? 'Indoor' : disc.outdoorOnly ? 'Outdoor' : 'Outdoor';
    console.log(`📋 ${disc.key} (${tag} ${disc.year})`);
    const url = buildUrl(disc);
    console.log(`   URL: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await wait(1500);
      const rows  = await parseRows(page, disc);
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
      else                  console.log(`   ⚪ Noch keine Outdoor-Resultate`);
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
