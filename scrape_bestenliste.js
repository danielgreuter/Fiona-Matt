#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v20
 * - DOM-Diagnostik via page.evaluate() → alles im Log sichtbar
 * - Kein blockierendes waitForSelector mehr
 * - HTML-Snippet + Body-Text direkt im Log
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';
const UPLOAD = process.argv.includes('--upload');

const BASE_URL = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de';

const DISCIPLINES = [
  { key:'100m',           year:'2026', season:'Outdoor', label:'100 m', isJump:false },
  { key:'100m_2025',      year:'2025', season:'Outdoor', label:'100 m', isJump:false },
  { key:'60m',            year:'2026', season:'Indoor',  label:'60 m',  isJump:false },
  { key:'60m_2025',       year:'2025', season:'Indoor',  label:'60 m',  isJump:false },
  { key:'200m',           year:'2026', season:'Outdoor', label:'200 m', isJump:false },
  { key:'200m_2025',      year:'2025', season:'Outdoor', label:'200 m', isJump:false },
  { key:'Long Jump',      year:'2026', season:'Outdoor', label:'Weit',  isJump:true  },
  { key:'Long Jump_2025', year:'2025', season:'Outdoor', label:'Weit',  isJump:true  },
];

const wait = ms => new Promise(r => setTimeout(r, ms));

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

async function getAllOptionTexts(page, selectId) {
  const esc = selectId.replace(/:/g, '\\:');
  const texts = [];
  for (const opt of await page.locator(`#${esc} option`).all())
    texts.push((await opt.textContent()).trim());
  return texts;
}

// ── DOM-Diagnose ──────────────────────────────────────────────

async function diagnosePage(page) {
  const info = await page.evaluate(() => {
    const allTr     = document.querySelectorAll('tr').length;
    const tbodyTr   = document.querySelectorAll('tbody tr').length;
    const allTd     = document.querySelectorAll('td').length;
    const tables    = document.querySelectorAll('table').length;
    const pfRows    = document.querySelectorAll('[id*="_data"] tr,[id*="result"] tr,[id*="Result"] tr').length;
    const divRows   = document.querySelectorAll('[class*="row"],[class*="Row"],[class*="item"],[class*="entry"]').length;
    const uiWidget  = document.querySelectorAll('.ui-datatable,.ui-widget-content').length;

    const relevantIds = [...document.querySelectorAll('[id]')]
      .map(el => el.id).filter(id => /best|result|liste|table|data/i.test(id)).slice(0, 15);

    // Ersten Resultat-Container finden
    const rc = document.querySelector('.ui-datatable,[id*="bestlist"],[id*="result"],table');
    const htmlSnippet = rc ? rc.outerHTML.slice(0, 1000) : 'KEIN CONTAINER';

    // Body-Text (zeigt ob Resultate sichtbar sind)
    const bodyText = document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 500);

    return { allTr, tbodyTr, allTd, tables, pfRows, divRows, uiWidget,
             relevantIds, htmlSnippet, bodyText, url: location.href };
  });

  console.log(`   🔍 DOM: url=${info.url}`);
  console.log(`      tables=${info.tables} | tr=${info.allTr} | tbody-tr=${info.tbodyTr} | td=${info.allTd}`);
  console.log(`      pfRows=${info.pfRows} | divRows=${info.divRows} | uiWidget=${info.uiWidget}`);
  console.log(`      IDs: ${info.relevantIds.join(', ')}`);
  console.log(`      BodyText: ${info.bodyText.slice(0, 250)}`);
  console.log(`      HTML-Snippet: ${info.htmlSnippet.slice(0, 500)}`);
  return info;
}

// ── Zeilen parsen ─────────────────────────────────────────────

async function parseRows(page, isJump) {
  const selectors = [
    'table tbody tr',
    '.ui-datatable tbody tr',
    '[id*="_data"] tr',
    '[id*="bestlist"] tr',
    'tbody tr',
    'table tr',
  ];

  let rowEls = [];
  for (const sel of selectors) {
    const count = await page.locator(sel).count();
    if (count > 2) {
      console.log(`   ✅ Rows via "${sel}": ${count}`);
      rowEls = await page.locator(sel).all();
      break;
    }
  }

  if (!rowEls.length) { console.log(`   ❌ Keine Zeilen gefunden`); return []; }

  const rows = [];
  for (const row of rowEls) {
    const cells = (await row.locator('td').allTextContents())
      .map(c => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const rank = parseInt(cells[0]);
    if (isNaN(rank) || rank < 1 || rank > 2000) continue;

    let result = '', name = '', wind = '', date = '', club = '';
    for (const c of cells.slice(1)) {
      if (!result) {
        if (isJump  && /^\d+[.,]\d{2}$/.test(c))             { result = c.replace(',','.'); continue; }
        if (!isJump && /^\d{1,2}[:.]\d{2}(\.\d+)?$/.test(c)) { result = c; continue; }
      }
      if (result && !wind && /^[+-]?\d+[.,]\d$/.test(c))     { wind = c; continue; }
      if (!name && /^[A-ZÄÖÜ][a-zäöüéàèêâ]+([ \-][A-ZÄÖÜ][a-zäöüéàèêâ]+)+$/.test(c)) { name = c; continue; }
      if (!date && /^\d{2}\.\d{2}\.\d{4}$/.test(c))          { date = c; continue; }
      if (name && result && !club && c.length > 2 && !/^\d/.test(c)) club = c;
    }
    if (!result || !name) continue;
    rows.push({ rank, name, result, wind:wind||null, club:club||null, date:date||null,
                isFiona: name.toLowerCase().includes('matt') });
  }
  return rows;
}

// ── Disziplin scrapen ─────────────────────────────────────────

async function scrapeDiscipline(page, disc, isFirst) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await wait(1000);

  const yearSel   = 'form_anonym:bestlistYear_input';
  const seasonSel = 'form_anonym:bestlistSeason_input';
  const catSel    = 'form_anonym:bestlistCategory_input';
  const discSel   = 'form_anonym:bestlistDiscipline_input';

  // Jahr
  const yearVal = await findOptionValue(page, yearSel, disc.year);
  if (!yearVal) throw new Error(`Jahr ${disc.year} nicht gefunden`);
  await selectAndTrigger(page, yearSel, yearVal);

  // Saison
  const isIndoor = disc.season === 'Indoor';
  let seasonVal = null;
  for (const opt of await page.locator(`#${seasonSel.replace(/:/g,'\\:')} option`).all()) {
    const t = (await opt.textContent()).trim().toLowerCase();
    const v = await opt.getAttribute('value');
    if (!v) continue;
    if (isIndoor && t === 'indoor')   { seasonVal = v; break; }
    if (!isIndoor && t === 'outdoor') { seasonVal = v; break; }
  }
  if (!seasonVal) throw new Error(`Saison ${disc.season} nicht gefunden`);
  await selectAndTrigger(page, seasonSel, seasonVal);

  // Kategorie U18 Frauen
  let catVal = null;
  for (const opt of await page.locator(`#${catSel.replace(/:/g,'\\:')} option`).all()) {
    if ((await opt.textContent()).trim() === 'U18 Frauen') { catVal = await opt.getAttribute('value'); break; }
  }
  if (!catVal) throw new Error(`U18 Frauen nicht gefunden`);
  await selectAndTrigger(page, catSel, catVal);

  // Disziplin
  const discTexts = await getAllOptionTexts(page, discSel);
  console.log(`   Disc (${discTexts.length}): ${discTexts.join(' | ')}`);
  let discVal = null;
  for (const opt of await page.locator(`#${discSel.replace(/:/g,'\\:')} option`).all()) {
    const t = (await opt.textContent()).trim();
    if (t === disc.label || t.startsWith(disc.label)) { discVal = await opt.getAttribute('value'); break; }
  }
  if (!discVal) throw new Error(`"${disc.label}" nicht in: ${discTexts.join(', ')}`);
  await selectAndTrigger(page, discSel, discVal);

  // Anzeigen klicken
  for (const sel of ['button:has-text("Anzeigen")','button:has-text("Laden")','input[type="submit"]','.ui-button']) {
    if (await page.locator(sel).count() > 0) {
      console.log(`   Btn: ${sel}`);
      await page.locator(sel).first().click();
      break;
    }
  }

  try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch(_) {}
  await wait(3000); // Extra-Puffer für langsame AJAX

  // Debug-Dateien nur für erste Disziplin
  if (isFirst) {
    await page.screenshot({ path: 'debug_result.png', fullPage: true });
    fs.writeFileSync('debug_result.html', await page.content());
    console.log(`   📸 debug_result.png + debug_result.html`);
  }

  // DOM-Diagnose
  await diagnosePage(page);

  return await parseRows(page, disc.isJump);
}

// ── Helpers ───────────────────────────────────────────────────

function toSec(t) {
  if (!t) return null;
  const p = t.split(':');
  return p.length === 2 ? parseFloat(p[0])*60 + parseFloat(p[1]) : parseFloat(t)||null;
}
function calcGap(a, b) {
  const d = toSec(a) - toSec(b);
  return (d >= 0 ? '+' : '') + Math.abs(d).toFixed(2);
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
  console.log('🚀 Bestenliste Scraper v20 (DOM-Diagnose)\n');

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
    console.log(`📋 ${disc.key} (${disc.season} ${disc.year})`);
    try {
      const rows  = await scrapeDiscipline(page, disc, i === 0);
      const fiona = rows.find(r => r.isFiona);
      const top1  = rows[0];
      result.disciplines[disc.key] = {
        discipline:disc.key, year:disc.year, scraped:new Date().toISOString(),
        fiona: fiona ? { rank:fiona.rank, result:fiona.result, wind:fiona.wind||null,
          date:fiona.date, gapToFirst: top1&&top1.name!==fiona.name ? calcGap(fiona.result,top1.result):null } : null,
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
