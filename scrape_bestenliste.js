#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v14 — FINAL
 * Fix: Parser nutzt Label-Präfixe statt feste Spalten-Indices
 * Struktur variiert je nach Disziplin (Wind-Spalte fehlt bei Indoor)
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BESTLIST_URL   = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de';
const FIONA_NAME     = 'Fiona Matt';
const SCREENSHOT_DIR = os.homedir() + '\\Desktop';

const F = {
  year:       'form_anonym:bestlistYear_input',
  season:     'form_anonym:bestlistSeason_input',
  category:   'form_anonym:bestlistCategory_input',
  discipline: 'form_anonym:bestlistDiscipline_input',
  type:       'form_anonym:bestlistType_input',
  tops:       'form_anonym:bestlistTops_input',
};

const DISCIPLINES = [
  { label:'100 m', key:'100m',      season:'Outdoor', year:'2025' },
  { label:'60 m',  key:'60m',       season:'Indoor',  year:'2026' },
  { label:'200 m', key:'200m',      season:'Outdoor', year:'2025' },
  { label:'Weit',  key:'Long Jump', season:'Outdoor', year:'2025' },
];

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';
const UPLOAD        = process.argv.includes('--upload') && CF_ACCOUNT_ID;

function esc(id) { return id.replace(/:/g,'\\:').replace(/\./g,'\\.'); }

async function jsfSelect(page, fieldId, label) {
  await page.selectOption(`select#${esc(fieldId)}`, { label });
  await page.evaluate(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) jQuery(el).trigger('change');
  }, fieldId);
  await page.waitForTimeout(1500);
}

async function main() {
  console.log('🚀 Swiss Athletics Bestenliste Scraper v14\n');

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
    locale: 'de-CH',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const result = { updated: new Date().toISOString().split('T')[0], disciplines: {} };

  for (const disc of DISCIPLINES) {
    console.log(`📋 Scraping: ${disc.key} (${disc.season} ${disc.year})...`);
    try {
      result.disciplines[disc.key] = await scrape(page, disc);
      const f = result.disciplines[disc.key].fiona;
      if (f) console.log(`   ✅ Fiona: Rang ${f.rank} · ${f.result} · Δ${f.gapToFirst||'—'} zu Rang 1`);
      else   console.log(`   ⚠️  Fiona nicht in Top ${result.disciplines[disc.key].total}`);
    } catch(e) {
      console.log(`   ❌ ${e.message}`);
      const sFile = path.join(SCREENSHOT_DIR, `alabus_fehler_${disc.key.replace(' ','_')}.png`);
      await page.screenshot({ path: sFile, fullPage: true }).catch(() => {});
      console.log(`   📸 ${sFile}`);
      result.disciplines[disc.key] = { error: e.message, fiona: null, top5: [], total: 0 };
    }
    console.log('');
  }

  const outFile = path.join(__dirname, 'bestenliste.json');
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`💾 Gespeichert: ${outFile}`);
  if (UPLOAD) await uploadKV(result);
  await browser.close();
  console.log('✅ Fertig!');
}

async function scrape(page, disc) {
  await page.goto(BESTLIST_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector(`select#${esc(F.year)}`, { timeout: 15000 });

  // Formular ausfüllen
  await jsfSelect(page, F.year, disc.year);
  await jsfSelect(page, F.season, disc.season);

  await page.waitForFunction(
    sel => (document.querySelector(sel)?.options?.length || 0) > 3,
    `select#${esc(F.category)}`, { timeout: 10000 }
  );
  const catOpts = await page.locator(`select#${esc(F.category)} option`).allTextContents();
  const catLbl  = catOpts.find(o => o.trim() === 'U18 Frauen')
               || catOpts.find(o => o.includes('U18') && o.includes('Frauen'));
  if (!catLbl) throw new Error('Kategorie nicht gefunden');
  await jsfSelect(page, F.category, catLbl.trim());

  await page.waitForFunction(
    sel => Array.from(document.querySelector(sel)?.options||[])
      .some(o => o.text.includes(' m') || o.text.includes('Weit')),
    `select#${esc(F.discipline)}`, { timeout: 15000 }
  );
  const discOpts = await page.locator(`select#${esc(F.discipline)} option`).allTextContents();
  const discLbl  = discOpts.find(o => o.trim() === disc.label)
                || discOpts.find(o => o.trim().startsWith(disc.label));
  if (!discLbl) throw new Error(`Disziplin "${disc.label}" nicht gefunden`);
  await jsfSelect(page, F.discipline, discLbl.trim());
  console.log(`   ${disc.year} · ${disc.season} · ${discLbl.trim()}`);

  // Typ: Ein Resultat pro Athlet
  await page.evaluate(id => {
    const el = document.getElementById(id);
    if (!el) return;
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i].text.toLowerCase().includes('ein resultat')) {
        el.selectedIndex = i;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  }, F.type);
  await page.waitForTimeout(1000);

  // Tops: 500
  await page.evaluate(id => {
    const el = document.getElementById(id);
    if (!el) return;
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i].text.trim() === '500') {
        el.selectedIndex = i;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  }, F.tops);
  await page.waitForTimeout(1000);

  // Anzeigen
  for (const btn of await page.locator('button').all()) {
    const t = (await btn.textContent().catch(() => '')).trim().toLowerCase();
    if (t.includes('anzeig')) { await btn.click({ force: true }); break; }
  }

  // Frame mit Tabelle finden
  console.log('   Warte auf iFrame...');
  let dataFrame = null;
  let maxRows = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.waitForTimeout(1500);
    for (const frame of page.frames()) {
      try {
        const rows = await frame.locator('table tbody tr').count();
        // Pick frame with most rows AND that contains alabus data (not google ads)
        if (rows > maxRows && !frame.url().includes('google') && !frame.url().includes('pagead')) {
          maxRows = rows;
          dataFrame = frame;
        }
      } catch {}
    }
    // Stop early if we have a good frame (>10 rows means it's real data)
    if (maxRows > 10) break;
  }
  if (!dataFrame) throw new Error('Frame mit Tabelle nicht gefunden');
  const rowCount = await dataFrame.locator('table tbody tr').count();
  console.log(`   ✓ ${rowCount} Zeilen gefunden (${dataFrame.url().slice(-50)})`);

  // Parser: nutzt Label-Präfixe zum Extrahieren (robust gegen fehlende Wind-Spalte)
  const rows = await dataFrame.evaluate(fionaName => {
    function extractByPrefix(cells, prefix) {
      for (const c of cells) {
        if (c.startsWith(prefix)) return c.slice(prefix.length).trim();
      }
      return '';
    }

    return Array.from(document.querySelectorAll('table tbody tr')).flatMap(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(c => c.textContent.trim());
      if (cells.length < 4) return [];

      // Rang aus "Nr1", "Nr2" etc.
      const nrCell  = cells[0] || '';
      const rank    = parseInt(nrCell.replace('Nr', '').trim());
      if (isNaN(rank)) return [];

      // Werte per Label-Präfix extrahieren (reihenfolge-unabhängig)
      const resRaw  = extractByPrefix(cells, 'Resultat');
      const resMatch = resRaw.match(/^[\d:.]+/);
      const result  = resMatch ? resMatch[0] : '';

      const windRaw = extractByPrefix(cells, 'Wind');
      const wind    = windRaw.match(/^[+-]?\d+\.?\d*$/) ? windRaw : '';

      const name    = extractByPrefix(cells, 'Name');
      if (!name || name.length < 2) return [];

      const club    = extractByPrefix(cells, 'Verein');
      const dateRaw = extractByPrefix(cells, 'Datum');
      const dateMatch = dateRaw.match(/\d{2}\.\d{2}\.\d{4}/);
      const date    = dateMatch ? dateMatch[0] : dateRaw;

      return [{
        rank,
        name,
        club,
        result,
        wind,
        date,
        isFiona: name === fionaName || name.includes('Matt'),
      }];
    });
  }, FIONA_NAME);

  console.log(`   ${rows.length} Einträge geparst`);
  if (rows.length === 0) {
    // Debug: show first 2 raw rows
    const rawRows = await dataFrame.evaluate(() =>
      Array.from(document.querySelectorAll('table tbody tr')).slice(0,2).map(row =>
        Array.from(row.querySelectorAll('td')).map(c=>c.textContent.trim()).join(' | ')
      )
    );
    rawRows.forEach(r => console.log('   RAW:', r));
  }

  const fiona  = rows.find(r => r.isFiona);
  const top1   = rows[0];
  const isJump = disc.key === 'Long Jump';

  function toSec(t) {
    if (!t) return null;
    const p = t.replace(/[^0-9.:]/g, '').split(':');
    return p.length === 2 ? parseFloat(p[0]) * 60 + parseFloat(p[1]) : parseFloat(p[0]) || null;
  }
  function gap(a, b) {
    const as = toSec(a), bs = toSec(b);
    if (as == null || bs == null) return null;
    const d = isJump ? as - bs : as - bs;
    return (d >= 0 ? '+' : '-') + Math.abs(d).toFixed(2);
  }

  return {
    discipline: disc.key,
    season: disc.season,
    year: disc.year,
    scraped: new Date().toISOString(),
    fiona: fiona ? {
      rank: fiona.rank,
      result: fiona.result,
      wind: fiona.wind,
      date: fiona.date,
      gapToFirst: top1 ? gap(fiona.result, top1.result) : null,
    } : null,
    top5: rows.slice(0, 5),
    total: rows.length,
  };
}

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/bestenliste:fiona`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '   ✅ KV OK' : `   ❌ KV Fehler ${res.status}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
