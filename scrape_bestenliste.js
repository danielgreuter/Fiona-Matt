#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v17 — Playwright
 * Nutzt echten Browser (wie Athlete-Resultate v8 Vorgänger)
 * Navigiert per JSF durch Dropdowns — stabil gegenüber URL-Änderungen
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';
const UPLOAD = process.argv.includes('--upload');

const BASE_URL = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de';

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

const wait = ms => new Promise(r => setTimeout(r, ms));

// ── Select helper ─────────────────────────────────────────────

async function selectByLabel(page, selectId, labelText, partial = false) {
  const select = page.locator(`#${selectId.replace(/:/g, '\\:')}`);
  await select.waitFor({ timeout: 8000 });
  const options = await select.locator('option').all();
  for (const opt of options) {
    const text = (await opt.textContent()).trim();
    if (partial ? text.toLowerCase().includes(labelText.toLowerCase()) : text === labelText) {
      const val = await opt.getAttribute('value');
      await select.selectOption({ value: val });
      await wait(800);
      return true;
    }
  }
  return false;
}

// ── Parse results table ───────────────────────────────────────

function parseTable(html, isJump) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowM;
  while ((rowM = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cellRe.exec(rowM[1])) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim());
    }
    if (cells.length < 4) continue;
    const rank = parseInt((cells[0]||'').replace(/Nr\.?\s*/i,'').trim());
    if (isNaN(rank)||rank<1||rank>1000) continue;
    let result='',name='',club='',date='',wind='';
    for (const c of cells.slice(1)) {
      if (!result && (isJump ? /^\d+\.\d{2}$/ : /^\d+[:.]\d{2}$/).test(c)) { result=c; continue; }
      if (result && !wind && /^[+-]?\d+\.\d$/.test(c)) { wind=c; continue; }
      if (!name && /^[A-ZÄÖÜ][a-zäöüß]+([ -][A-ZÄÖÜ][a-zäöüß]+)+$/.test(c)) { name=c; continue; }
      if (!date && /^\d{2}\.\d{2}\.\d{4}$/.test(c)) { date=c; continue; }
      if (name&&result&&!club&&c.length>2&&!/^\d/.test(c)) club=c;
    }
    if (!name||!result) continue;
    rows.push({ rank, name, result, wind, club, date, isFiona: name.includes('Matt') });
  }
  return rows;
}

function toSec(t) {
  if (!t) return null;
  const p = t.split(':');
  return p.length===2 ? parseFloat(p[0])*60+parseFloat(p[1]) : parseFloat(t)||null;
}

function calcGap(a, b, isJump) {
  const as=toSec(a), bs=toSec(b);
  if (as==null||bs==null) return null;
  const d = isJump ? (as-bs) : (as-bs);
  return (d>=0?'+':'')+d.toFixed(2);
}

// ── Scrape one discipline ─────────────────────────────────────

async function scrapeDiscipline(page, disc) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await wait(1500);
  await page.screenshot({ path: `/tmp/alabus_debug_01_loaded.png` });

  // Jahr
  const yearSel = 'form_anonym:bestlistYear_input';
  const yearOk = await selectByLabel(page, yearSel, disc.year);
  if (!yearOk) {
    await page.screenshot({ path: `/tmp/alabus_debug_year_fail.png` });
    throw new Error(`Jahr ${disc.year} nicht gefunden`);
  }
  await wait(1000);

  // Saison
  const seasonSel = 'form_anonym:bestlistSeason_input';
  const seasonLabel = disc.season === 'Indoor' ? 'halle' : 'outdoor';
  const seasonOk = await selectByLabel(page, seasonSel, seasonLabel, true);
  if (!seasonOk) {
    await page.screenshot({ path: `/tmp/alabus_debug_season_fail.png` });
    throw new Error(`Saison ${disc.season} nicht gefunden`);
  }
  await wait(1000);

  // Kategorie U18 Frauen
  const catSel = 'form_anonym:bestlistCategory_input';
  const catOk = await selectByLabel(page, catSel, 'U18', true);
  if (!catOk) {
    await page.screenshot({ path: `/tmp/alabus_debug_cat_fail.png` });
    throw new Error('Kategorie U18 nicht gefunden');
  }
  await wait(1000);

  // Disziplin
  const discSel = 'form_anonym:bestlistDiscipline_input';
  const discOk = await selectByLabel(page, discSel, disc.label);
  if (!discOk) {
    await page.screenshot({ path: `/tmp/alabus_debug_disc_fail.png` });
    throw new Error(`Disziplin "${disc.label}" nicht gefunden`);
  }
  await wait(1000);

  // Anzeigen Button klicken
  await page.screenshot({ path: `/tmp/alabus_debug_02_before_submit.png` });
  const btn = page.locator('button, input[type=submit]').filter({ hasText: /[Aa]nzeig/ });
  const btnCount = await btn.count();
  if (btnCount > 0) {
    await btn.first().click();
  } else {
    await page.locator('form#form_anonym').evaluate(f => f.requestSubmit());
  }
  await page.waitForLoadState('networkidle');
  await wait(2000);
  await page.screenshot({ path: `/tmp/alabus_debug_03_results.png` });

  const html = await page.content();
  const isJump = disc.key.startsWith('Long Jump');
  const rows = parseTable(html, isJump);
  console.log(`   ${rows.length} Einträge geparst`);
  return rows;
}

// ── KV Upload ─────────────────────────────────────────────────

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/bestenliste:fiona`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '✅ KV Upload OK' : `❌ KV Fehler ${res.status}`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Swiss Athletics Bestenliste Scraper v17 (Playwright)\n');

  const chromePath = process.env.CHROME_PATH
    || (fs.existsSync('/usr/bin/google-chrome-stable') ? '/usr/bin/google-chrome-stable' : null)
    || (fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : null);

  if (chromePath) console.log(`✅ Chrome: ${chromePath}`);
  else console.log('⚠️  Kein Chrome-Pfad — Playwright nutzt Bundled-Browser');

  const browser = await chromium.launch({
    executablePath: chromePath || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0',
    locale: 'de-CH',
  });
  const page = await context.newPage();

  const result = { updated: new Date().toISOString().split('T')[0], disciplines: {} };

  for (const disc of DISCIPLINES) {
    console.log(`📋 ${disc.key} (${disc.season} ${disc.year})`);
    try {
      const rows   = await scrapeDiscipline(page, disc);
      const isJump = disc.key.startsWith('Long Jump');
      const fiona  = rows.find(r => r.isFiona);
      const top1   = rows[0];

      result.disciplines[disc.key] = {
        discipline: disc.key,
        year: disc.year,
        scraped: new Date().toISOString(),
        fiona: fiona ? {
          rank: fiona.rank,
          result: fiona.result,
          wind: fiona.wind || null,
          date: fiona.date,
          gapToFirst: top1 ? calcGap(fiona.result, top1.result, isJump) : null,
        } : null,
        top15: rows.slice(0, 15),
        total: rows.length,
      };

      if (fiona) console.log(`   ✅ Fiona: Rang ${fiona.rank} · ${fiona.result}`);
      else       console.log(`   ⚠️  Fiona nicht in Top ${rows.length}`);
    } catch(e) {
      console.log(`   ❌ ${e.message}`);
      result.disciplines[disc.key] = { error: e.message, fiona: null, top15: [], total: 0 };
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
