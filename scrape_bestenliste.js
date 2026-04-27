#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v32
 * Fix: Nach Anzeigen-Click iframe-Content statt page-Content lesen
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';
const UPLOAD = process.argv.includes('--upload');

const FORM_URL = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de';
const FIONA = 'Fiona Matt';
const TOP_N = 15;
const wait = ms => new Promise(r => setTimeout(r, ms));
const esc  = s => s.replace(/:/g, '\\:');

const DISCIPLINES = [
  { key:'100m',           year:'2026', season:'Outdoor', label:'100 m' },
  { key:'100m_2025',      year:'2025', season:'Outdoor', label:'100 m' },
  { key:'60m',            year:'2026', season:'Indoor',  label:'60 m'  },
  { key:'60m_2025',       year:'2025', season:'Indoor',  label:'60 m'  },
  { key:'200m',           year:'2026', season:'Outdoor', label:'200 m' },
  { key:'200m_2025',      year:'2025', season:'Outdoor', label:'200 m' },
  { key:'Long Jump',      year:'2026', season:'Outdoor', label:'Weit'  },
  { key:'Long Jump_2025', year:'2025', season:'Outdoor', label:'Weit'  },
];

async function dismissCookie(page) {
  for (const txt of ['Nein','Ablehnen','Ja','Akzeptieren']) {
    try {
      const btn = page.locator(`button:has-text("${txt}")`).first();
      await btn.waitFor({ state:'visible', timeout:4000 });
      await btn.click();
      await wait(500);
      return;
    } catch(_) {}
  }
}

async function pfSelect(page, inputId, labelText, partial=false) {
  const compId = inputId.replace(/_input$/, '');
  const wrapper = page.locator(`#${esc(compId)}`);
  await wrapper.waitFor({ state:'visible', timeout:12000 });
  await wrapper.click();
  let panel = null;
  for (const suffix of ['_items','_panel']) {
    const p = page.locator(`#${esc(compId)}${suffix}`);
    try { await p.waitFor({ state:'visible', timeout:4000 }); panel = p; break; }
    catch(_) {}
  }
  if (!panel) { await page.keyboard.press('Escape'); return false; }
  const items = await panel.locator('li').all();
  for (const item of items) {
    const text = ((await item.textContent())||'').trim();
    const match = partial ? text.toLowerCase().includes(labelText.toLowerCase()) : text === labelText;
    if (match) {
      await item.click();
      try { await page.waitForLoadState('networkidle', { timeout:8000 }); } catch { await wait(2000); }
      console.log(`  ✓ "${text}"`);
      return true;
    }
  }
  console.warn(`  ⚠ "${labelText}" nicht gefunden`);
  await page.keyboard.press('Escape');
  return false;
}

async function discover(page) {
  return await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('select').forEach(s => { out[s.id] = Array.from(s.options).map(o=>o.text.trim()); });
    return out;
  });
}

function findId(comps, needle, partial=false) {
  for (const [id,opts] of Object.entries(comps))
    if (opts.some(o => partial ? o.toLowerCase().includes(needle.toLowerCase()) : o === needle)) return id;
  return null;
}

function parseHtml(html) {
  const rows = [];
  const rowRe = /data-ri="(\d+)"[^>]*>([\s\S]*?)(?=data-ri="\d+"|<\/tbody>|$)/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cm;
    while ((cm = cellRe.exec(m[2])) !== null) {
      // Entferne ui-column-title Span (Label), behalte nur den Wert
      const cellHtml = cm[1].replace(/<span[^>]*ui-column-title[^>]*>[^<]*<\/span>/g, '');
      cells.push(cellHtml.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim());
    }
    if (cells.length >= 4 && /^\d+$/.test(cells[0])) rows.push(cells);
  }
  return rows;
}

function mapRows(rawRows) {
  return rawRows.map(cells => {
    const rank = parseInt(cells[0]);
    if (isNaN(rank)||rank<1||rank>500) return null;
    const result = (cells[1]||'').trim();
    let wind=null, nameIdx=4;
    if ((cells[2]||'').match(/^[+-]?\d+\.\d$/)) wind = cells[2]; else nameIdx = 3;
    const name = (cells[nameIdx]||'').trim();
    const club = (cells[nameIdx+1]||'').trim();
    const date = cells.find(c=>/^\d{2}\.\d{2}\.\d{4}$/.test((c||'').trim()))||'';
    return { rank, result, wind, name, club, date };
  }).filter(r=>r&&r.result&&r.name&&r.name.length>2);
}

async function uploadToKV(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, { method:'PUT', headers:{'Authorization':`Bearer ${CF_API_TOKEN}`,'Content-Type':'application/json'}, body:JSON.stringify(value) });
  const j = await res.json();
  if (!j.success) throw new Error(`KV: ${JSON.stringify(j.errors)}`);
}

async function scrapeDiscipline(context, disc, isFirst) {
  const { key, year, season, label } = disc;
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  try {
    await page.goto(FORM_URL, { waitUntil:'domcontentloaded', timeout:40000 });
    await wait(2000);
    await dismissCookie(page);

    const comps   = await discover(page);
    const seasonId = findId(comps, season);
    const catId    = findId(comps, 'U18 Frauen') || findId(comps,'U18',true);
    const typeId   = findId(comps,'Ein Resultat pro Athlet');
    const topsId   = findId(comps,'30');

    if (!await pfSelect(page, seasonId, season)) return { discipline:key, year, error:'season', top15:[], fiona:null };
    if (!await pfSelect(page, catId, 'U18 Frauen')) return { discipline:key, year, error:'category', top15:[], fiona:null };

    await wait(300);
    const comps2  = await discover(page);
    const yearId2 = findId(comps2,year)||findId(comps,year);
    const discId2 = findId(comps2,label)||findId(comps2,label,true)||findId(comps,label)||findId(comps,label,true);

    if (!await pfSelect(page, yearId2, year)) return { discipline:key, year, error:'year', top15:[], fiona:null };
    if (typeId) await pfSelect(page, typeId, 'Ein Resultat pro Athlet');
    if (topsId) await pfSelect(page, topsId, '30');
    if (!await pfSelect(page, discId2, label)) return { discipline:key, year, error:'discipline', top15:[], fiona:null };

    // Anzeigen klicken → Seite wechselt zu swiss-athletics.ch mit iFrame
    const anzeigenBtn = page.locator('button:has-text("Anzeigen")').first();
    await anzeigenBtn.waitFor({ state:'visible', timeout:8000 });
    await anzeigenBtn.click();
    console.log('  ✓ "Anzeigen" geklickt');

    // Warte auf iFrame mit alabus-Content
    await page.waitForFunction(() => {
      const iframe = document.getElementById('alabusContentIframe');
      return iframe && iframe.src && iframe.src.includes('blyear');
    }, { timeout: 15000 }).catch(() => {});

    // iFrame-URL aus dem DOM holen und direkt navigieren
    const iframeUrl = await page.evaluate(() => {
      const iframe = document.getElementById('alabusContentIframe');
      return iframe ? iframe.src : null;
    });
    console.log(`  iFrame URL: ${iframeUrl ? iframeUrl.substring(0,100)+'…' : 'NICHT GEFUNDEN'}`);

    let html = '';
    if (iframeUrl) {
      // Direkt zur iFrame-URL navigieren
      await page.goto(iframeUrl, { waitUntil:'networkidle', timeout:20000 });
      html = await page.content();
    } else {
      // Fallback: versuche Frame-Content direkt
      const frames = page.frames();
      console.log(`  Frames: ${frames.map(f=>f.url().substring(0,60)).join(' | ')}`);
      const alabusFrame = frames.find(f => f.url().includes('alabus') && f.url().includes('blyear'));
      if (alabusFrame) html = await alabusFrame.content();
    }

    const hasDate = /\d{2}\.\d{2}\.\d{4}/.test(html);
    console.log(`  Datum: ${hasDate} | HTML: ${html.length}`);

    if (isFirst) {
      await page.screenshot({ path:'screenshot_results.png', fullPage:true });
      fs.writeFileSync('page_results.html', html);
      console.log('  📸 gespeichert');
    }

    const rawRows = parseHtml(html);
    console.log(`  → ${rawRows.length} Zeilen | [0]: ${JSON.stringify(rawRows[0]?.slice(0,5))}`);

    const rows  = mapRows(rawRows);
    const top15 = rows.slice(0,TOP_N).map(r=>({ rank:r.rank, name:r.name, result:r.result, wind:r.wind, club:r.club, date:r.date, isFiona:r.name.includes(FIONA) }));
    const fEntry = rows.find(r=>r.name.includes(FIONA));
    const fiona  = fEntry ? { rank:fEntry.rank, result:fEntry.result, wind:fEntry.wind, date:fEntry.date, gapToFirst: rows[0]?`+${(parseFloat(fEntry.result)-parseFloat(rows[0].result)).toFixed(2)}`:null } : null;

    if (fiona) console.log(`  ⭐ Fiona: Rang ${fiona.rank} — ${fiona.result}`);
    else if (rows[0]) console.log(`  1.: ${rows[0].name} ${rows[0].result}`);
    return { discipline:key, year, scraped:new Date().toISOString(), fiona, top15 };

  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
  const context = await browser.newContext({ userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' });

  const results = {};
  for (let i=0; i<DISCIPLINES.length; i++) {
    const disc = DISCIPLINES[i];
    console.log(`\n📋 ${disc.key}  (${disc.season} ${disc.year} — "${disc.label}")`);
    results[disc.key] = await scrapeDiscipline(context, disc, i===0);
  }

  await context.close();
  await browser.close();

  const output = { updated:new Date().toISOString(), disciplines:results };
  fs.writeFileSync('bestenliste.json', JSON.stringify(output,null,2));
  console.log('\n✅ bestenliste.json');

  if (UPLOAD) {
    await uploadToKV('bestenliste', output);
    console.log('✅ KV fertig');
  }
})();
