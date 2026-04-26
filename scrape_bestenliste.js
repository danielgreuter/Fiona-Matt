#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v26
 *
 * Korrekte Saisontrennung:
 * - openURLForBestlist() überschreiben → kein Redirect zu swiss-athletics.ch
 * - Dropdowns auf alabus ausfüllen (inkl. Saison Outdoor/Indoor)
 * - JSF-Submit direkt auf alabus-Seite → saisongefilterte Resultate erscheinen
 * - Resultate direkt aus alabus lesen (kein iframe-Problem)
 *
 * Für 100m/60m: weiterhin direkte URL (funktioniert bereits korrekt)
 * Für 200m/Weit: Formular-Ansatz mit Saison=Outdoor
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
  { key:'100m',           year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv', season:'Outdoor', label:'100 m', isJump:false, useForm:false },
  { key:'100m_2025',      year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv', season:'Outdoor', label:'100 m', isJump:false, useForm:false },
  { key:'60m',            year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79',  season:'Indoor',  label:'60 m',  isJump:false, useForm:false },
  { key:'60m_2025',       year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79',  season:'Indoor',  label:'60 m',  isJump:false, useForm:false },
  { key:'200m',           year:'2026', discId:null, season:'Outdoor', label:'200 m', isJump:false, useForm:true  },
  { key:'200m_2025',      year:'2025', discId:null, season:'Outdoor', label:'200 m', isJump:false, useForm:true  },
  { key:'Long Jump',      year:'2026', discId:null, season:'Outdoor', label:'Weit',  isJump:true,  useForm:true  },
  { key:'Long Jump_2025', year:'2025', discId:null, season:'Outdoor', label:'Weit',  isJump:true,  useForm:true  },
];

const wait = ms => new Promise(r => setTimeout(r, ms));
const yearSel   = 'form_anonym:bestlistYear_input';
const seasonSel = 'form_anonym:bestlistSeason_input';
const catSel    = 'form_anonym:bestlistCategory_input';
const discSel   = 'form_anonym:bestlistDiscipline_input';

function esc(id) { return id.replace(/:/g, '\\:'); }

async function selectAndTrigger(page, selectId, value) {
  const loc = page.locator(`#${esc(selectId)}`);
  await loc.waitFor({ timeout: 10000 });
  await loc.selectOption({ value });
  await loc.dispatchEvent('change');
  try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch(_) {}
  await wait(600);
}

async function findOptVal(page, selectId, labelMatch) {
  for (const opt of await page.locator(`#${esc(selectId)} option`).all()) {
    const t = (await opt.textContent()).trim();
    if (t === labelMatch || t.toLowerCase() === labelMatch.toLowerCase() || t.startsWith(labelMatch))
      return await opt.getAttribute('value');
  }
  return null;
}

// ── Formular-Ansatz: Saison korrekt setzen, dann JSF-Submit ──

async function scrapeViaForm(page, disc) {
  await page.goto(`${ALABUS_BASE}?lang=de`, { waitUntil: 'networkidle', timeout: 30000 });
  await wait(800);

  // openURLForBestlist deaktivieren → kein Redirect zu swiss-athletics.ch
  await page.evaluate(() => { window.openURLForBestlist = () => {}; });

  // 1. Jahr
  const yearVal = await findOptVal(page, yearSel, disc.year);
  if (!yearVal) throw new Error(`Jahr ${disc.year} nicht gefunden`);
  await selectAndTrigger(page, yearSel, yearVal);

  // 2. Saison
  const seasonVal = await findOptVal(page, seasonSel, disc.season);
  if (!seasonVal) throw new Error(`Saison ${disc.season} nicht gefunden`);
  await selectAndTrigger(page, seasonSel, seasonVal);

  // 3. Kategorie
  const catVal = await findOptVal(page, catSel, 'U18 Frauen');
  if (!catVal) throw new Error('U18 Frauen nicht gefunden');
  await selectAndTrigger(page, catSel, catVal);

  // 4. Disziplin — Option-Value loggen für Diagnose
  const discVal = await findOptVal(page, discSel, disc.label);
  if (!discVal) {
    const opts = await page.locator(`#${esc(discSel)} option`).allTextContents();
    throw new Error(`"${disc.label}" nicht in: ${opts.join(', ')}`);
  }
  console.log(`   Disc-ID (${disc.season}): ${discVal}`);
  await selectAndTrigger(page, discSel, discVal);

  // 5. Anzeigen klicken — bleibt auf alabus wegen override
  const btn = page.locator('button:has-text("Anzeigen")').first();
  if (await btn.count() > 0) {
    await btn.click();
  } else {
    // Fallback: JSF-Submit direkt
    await page.evaluate(() => {
      if (window.PrimeFaces) PrimeFaces.addSubmitParam('form_anonym', {}).submit('form_anonym');
    });
  }

  try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch(_) {}
  await wait(2000);

  return await parseRows(page, disc.isJump);
}

// ── Direkte URL (100m, 60m) ───────────────────────────────────

async function scrapeViaUrl(page, disc) {
  const indoor = disc.season === 'Indoor';
  const p = new URLSearchParams({ lang:'de', mobile:'false', blyear:disc.year, blcat:CAT_U18F, disci:disc.discId, top:'30' });
  if (indoor) p.set('indoor', 'true');
  const url = `${ALABUS_BASE}?${p}`;
  console.log(`   URL: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await wait(1500);
  return await parseRows(page, disc.isJump);
}

// ── Parser ────────────────────────────────────────────────────

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
        await page.reload({ waitUntil:'networkidle', timeout:20000 }); await wait(2000);
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
    const validResult = isJump ? /^\d+[.,]\d{2}$/.test(result) : /^\d{1,2}[:.]\d{2}(\.\d+)?$/.test(result);
    if (!validResult) continue;
    let name='', wind='', club='', date='', nameIdx=-1;
    for (let ci=2; ci<cells.length; ci++) {
      if (NAME_RE.test(cells[ci])) { name=cells[ci]; nameIdx=ci; break; }
    }
    if (nameIdx>2 && WIND_RE.test(cells[nameIdx-1])) wind=cells[nameIdx-1];
    if (nameIdx>=0 && nameIdx+1<cells.length) club=cells[nameIdx+1];
    for (let ci=cells.length-1; ci>=0; ci--) { if (DATE_RE.test(cells[ci])) { date=cells[ci]; break; } }
    if (!name) continue;
    const isFiona = name.toLowerCase().includes('matt') || club.toLowerCase().includes('eschen-mauren');
    rows.push({ rank, name, result:result.replace(',','.'), wind:wind||null, club:club||null, date:date||null, isFiona });
  }
  return rows;
}

function toSec(t) { if(!t) return null; const p=t.split(':'); return p.length===2?parseFloat(p[0])*60+parseFloat(p[1]):parseFloat(t)||null; }
function calcGap(a,b) { const d=toSec(a)-toSec(b); return (d>=0?'+':'')+Math.abs(d).toFixed(2); }

async function uploadKV(data) {
  const url=`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/bestenliste:fiona`;
  const res=await fetch(url,{method:'PUT',headers:{'Authorization':`Bearer ${CF_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(data)});
  console.log(res.ok?'✅ KV Upload OK':`❌ KV Fehler ${res.status}`);
}

async function main() {
  console.log('🚀 Bestenliste Scraper v26 (Form-Submit mit Saison-Filter)\n');

  const browser = await chromium.launch({
    executablePath:'/usr/bin/google-chrome-stable', headless:true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  });
  const page = await browser.newContext({
    userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0', locale:'de-CH',
  }).then(ctx=>ctx.newPage());

  const result = { updated:new Date().toISOString().split('T')[0], disciplines:{} };

  for (const disc of DISCIPLINES) {
    console.log(`📋 ${disc.key} (${disc.season} ${disc.year})`);
    try {
      const rows = disc.useForm
        ? await scrapeViaForm(page, disc)
        : await scrapeViaUrl(page, disc);
      const fiona=rows.find(r=>r.isFiona), top1=rows[0];
      result.disciplines[disc.key] = {
        discipline:disc.key, year:disc.year, scraped:new Date().toISOString(),
        fiona: fiona?{rank:fiona.rank,result:fiona.result,wind:fiona.wind||null,date:fiona.date,
          gapToFirst:top1&&top1.name!==fiona.name?calcGap(fiona.result,top1.result):null}:null,
        top15:rows.slice(0,15), total:rows.length,
      };
      if (fiona)            console.log(`   ✅ Fiona: Rang ${fiona.rank} · ${fiona.result}`);
      else if (rows.length) console.log(`   ⚠️  Fiona nicht in Top ${rows.length} — Top1: ${top1?.result} (${top1?.date})`);
      else                  console.log(`   ⚪ Keine Resultate`);
    } catch(e) {
      console.log(`   ❌ ${e.message}`);
      result.disciplines[disc.key]={error:e.message,fiona:null,top15:[],total:0};
    }
    console.log('');
  }

  await browser.close();
  fs.writeFileSync('bestenliste.json', JSON.stringify(result,null,2));
  console.log('💾 bestenliste.json gespeichert');
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(result);
  console.log('\n✅ Fertig!');
}

main().catch(e=>{console.error('❌',e.message);process.exit(1);});
