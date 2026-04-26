#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v21
 *
 * ERKENNTNIS: swiss-athletics.ch bettet die Resultate in einem <iframe> ein.
 * Die Iframe-URL ist eine direkte alabus-URL mit GET-Parametern.
 * → Wir navigieren direkt zu alabus mit den Parametern, ohne JSF-Formular.
 *
 * Stabile IDs (aus iframe-src extrahiert):
 *   blcat U18 Frauen : 5c4o3k5m-d686mo-j986g2ie-1-j986g45y-bn
 *   disci 100m       : 5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv
 *   disci 60m        : 5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79
 *   disci 200m       : 5c4o3k5m-d686mo-j986g2ie-1-j986ghgt-6ks
 *   disci Weit       : 5c4o3k5m-d686mo-j986g2ie-1-j986ge5c-3mp
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
  { key:'100m',           year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv', indoor:false, isJump:false },
  { key:'100m_2025',      year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv', indoor:false, isJump:false },
  { key:'60m',            year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79',  indoor:true,  isJump:false },
  { key:'60m_2025',       year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79',  indoor:true,  isJump:false },
  { key:'200m',           year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ghgt-6ks', indoor:false, isJump:false },
  { key:'200m_2025',      year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ghgt-6ks', indoor:false, isJump:false },
  { key:'Long Jump',      year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ge5c-3mp', indoor:false, isJump:true  },
  { key:'Long Jump_2025', year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ge5c-3mp', indoor:false, isJump:true  },
];

const wait = ms => new Promise(r => setTimeout(r, ms));

function buildUrl(disc) {
  const p = new URLSearchParams({
    lang:   'de',
    mobile: 'false',
    blyear: disc.year,
    blcat:  CAT_U18F,
    disci:  disc.discId,
    top:    '30',
  });
  if (disc.indoor) p.set('indoor', 'true');
  return `${ALABUS_BASE}?${p}`;
}

// ── Resultate parsen (Playwright-Locator) ─────────────────────

async function parseRows(page, isJump) {
  // Warten bis Tabelle erscheint (JSF rendert nach JS-Aufruf)
  try {
    await page.waitForSelector('table tbody tr', { timeout: 15000 });
  } catch(e) {
    // Debug: was ist auf der Seite?
    const info = await page.evaluate(() => ({
      tables:   document.querySelectorAll('table').length,
      allTr:    document.querySelectorAll('tr').length,
      tbodyTr:  document.querySelectorAll('tbody tr').length,
      bodySnip: document.body.innerText.replace(/\s+/g,' ').slice(0,300),
    }));
    console.log(`   ⚠️  Timeout: tables=${info.tables} tr=${info.allTr} tbody-tr=${info.tbodyTr}`);
    console.log(`   Body: ${info.bodySnip}`);
    return [];
  }

  const rowEls = await page.locator('table tbody tr').all();
  console.log(`   Rohe TR-Zeilen: ${rowEls.length}`);

  const rows = [];
  for (const row of rowEls) {
    const cells = (await row.locator('td').allTextContents())
      .map(c => c.replace(/\s+/g,' ').trim()).filter(Boolean);

    if (cells.length < 3) continue;
    const rank = parseInt(cells[0]);
    if (isNaN(rank) || rank < 1 || rank > 2000) continue;

    let result='', name='', wind='', date='', club='';
    for (const c of cells.slice(1)) {
      if (!result) {
        if (isJump  && /^\d+[.,]\d{2}$/.test(c))              { result = c.replace(',','.'); continue; }
        if (!isJump && /^\d{1,2}[:.]\d{2}(\.\d+)?$/.test(c)) { result = c; continue; }
      }
      if (result && !wind && /^[+-]?\d+[.,]\d$/.test(c))      { wind = c; continue; }
      if (!name && /^[A-ZÄÖÜ][a-zäöüéàèêâß]+([ \-][A-ZÄÖÜ][a-zäöüéàèêâß]+)+$/.test(c)) { name = c; continue; }
      if (!date && /^\d{2}\.\d{2}\.\d{4}$/.test(c))           { date = c; continue; }
      if (name && result && !club && c.length > 2 && !/^\d/.test(c)) club = c;
    }

    if (!result || !name) continue;
    rows.push({ rank, name, result, wind:wind||null, club:club||null, date:date||null,
                isFiona: name.toLowerCase().includes('matt') });
  }
  return rows;
}

// ── Eine Disziplin scrapen ────────────────────────────────────

async function scrapeDiscipline(page, disc, isFirst) {
  const url = buildUrl(disc);
  console.log(`   URL: ${url}`);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await wait(2000);

  // Debug nur für erste Disziplin
  if (isFirst) {
    await page.screenshot({ path: 'debug_result.png', fullPage: true });
    fs.writeFileSync('debug_result.html', await page.content());
    console.log(`   📸 debug_result.png + debug_result.html gespeichert`);
  }

  return await parseRows(page, disc.isJump);
}

// ── Gap ──────────────────────────────────────────────────────

function toSec(t) {
  if (!t) return null;
  const p = t.split(':');
  return p.length === 2 ? parseFloat(p[0])*60+parseFloat(p[1]) : parseFloat(t)||null;
}
function calcGap(a, b) {
  const d = toSec(a) - toSec(b);
  return (d >= 0?'+':'')+Math.abs(d).toFixed(2);
}

// ── KV Upload ─────────────────────────────────────────────────

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/bestenliste:fiona`;
  const res = await fetch(url, {
    method:'PUT',
    headers:{ 'Authorization':`Bearer ${CF_API_TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '✅ KV Upload OK' : `❌ KV Fehler ${res.status}: ${await res.text()}`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Bestenliste Scraper v21 (Direkte alabus-URL, kein JSF-Formular)\n');

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

  for (let i = 0; i < DISCIPLINES.length; i++) {
    const disc = DISCIPLINES[i];
    console.log(`📋 ${disc.key} (${disc.indoor?'Indoor':'Outdoor'} ${disc.year})`);
    try {
      const rows  = await scrapeDiscipline(page, disc, i === 0);
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
      else                  console.log(`   ❌ 0 Einträge`);
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
