#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v20
 * Fix: Keine hardcodierten JSF-IDs mehr.
 *      Dropdowns werden anhand ihrer Option-Texte erkannt.
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';
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

const FIONA = 'Fiona Matt';
const CATEGORY_LABEL = 'U18 Frauen';
const TOP_N = 15;

const wait = ms => new Promise(r => setTimeout(r, ms));

async function discoverSelects(page) {
  return await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('select').forEach(sel => {
      out[sel.id] = Array.from(sel.options).map(o => o.text.trim());
    });
    return out;
  });
}

function findSelectId(selects, needle, partial = false) {
  for (const [id, opts] of Object.entries(selects)) {
    const found = opts.some(o =>
      partial ? o.toLowerCase().includes(needle.toLowerCase()) : o === needle
    );
    if (found) return id;
  }
  return null;
}

async function selectOption(page, selectId, labelText, partial = false) {
  const esc = selectId.replace(/:/g, '\\:');
  const select = page.locator(`#${esc}`);
  await select.waitFor({ state: 'visible', timeout: 12000 });
  const options = await select.locator('option').all();
  for (const opt of options) {
    const text = (await opt.textContent()).trim();
    const match = partial
      ? text.toLowerCase().includes(labelText.toLowerCase())
      : text === labelText;
    if (match) {
      const val = await opt.getAttribute('value');
      await select.selectOption({ value: val });
      await page.evaluate(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof jsf !== 'undefined') {
          jsf.ajax.request(el, null, { execute: '@this', render: '@form' });
        }
      }, selectId);
      await wait(1500);
      return true;
    }
  }
  console.warn(`  ⚠ Option "${labelText}" nicht gefunden in #${selectId}`);
  return false;
}

async function loadPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  console.log('  🌐 Lade Seite neu…');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await wait(2500);

  const selects = await discoverSelects(page);
  const ids = Object.keys(selects);
  console.log(`  📋 ${ids.length} Selects: ${ids.join(', ')}`);

  const yearId   = findSelectId(selects, '2026') || findSelectId(selects, '2025');
  const seasonId = findSelectId(selects, 'Outdoor') || findSelectId(selects, 'Indoor');
  const catId    = findSelectId(selects, CATEGORY_LABEL) || findSelectId(selects, 'U18', true);
  const discId   = findSelectId(selects, '100 m') || findSelectId(selects, '60 m') || findSelectId(selects, '200 m');

  console.log(`  IDs → Jahr:${yearId}  Saison:${seasonId}  Kat:${catId}  Disziplin:${discId}`);

  if (!yearId || !seasonId || !catId || !discId) {
    console.error('  ✗ Dropdowns nicht gefunden. Seiteninhalte:');
    console.error(JSON.stringify(selects, null, 2));
    await page.close();
    return null;
  }
  return { page, yearId, seasonId, catId, discId };
}

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
    if (isNaN(rank) || rank < 1 || rank > 1000) continue;
    let result='', name='', club='', date='', wind='';
    for (const c of cells.slice(1)) {
      if (!result && (isJump ? /^\d+\.\d{2}$/.test(c) : /^\d{1,2}[:.]\d{2}(\.\d+)?$/.test(c))) { result = c; }
      else if (!wind && /^[+-]\d+\.\d$/.test(c))          { wind = c; }
      else if (!date && /^\d{2}\.\d{2}\.\d{4}$/.test(c))  { date = c; }
      else if (!name && /^[A-ZÁÀÂÄÉÈÊËÍÏÓÔÖÚÛÜÑÇ][a-záàâäéèêëíïóôöúûüñç\-' ]+$/.test(c) && c.length > 3) { name = c; }
      else if (!club && c.length > 2 && !/^\d/.test(c))   { club = c; }
    }
    if (result && name) rows.push({ rank, name, result, wind: wind||null, club, date });
  }
  return rows;
}

async function uploadToKV(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const j = await res.json();
  if (!j.success) throw new Error(`KV upload failed: ${JSON.stringify(j.errors)}`);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const results = {};
  let lastSeason = null;
  let ctx = null;

  for (const disc of DISCIPLINES) {
    const { key, year, season, label } = disc;
    const isJump = label.toLowerCase().includes('weit');
    console.log(`\n📋 ${key}  (${season} ${year} — "${label}")`);

    if (!ctx || season !== lastSeason) {
      if (ctx) await ctx.page.close();
      ctx = await loadPage(context);
      if (!ctx) {
        results[key] = { discipline: key, year, error: 'page_load_failed', top15: [] };
        lastSeason = season;
        continue;
      }
      const okSeason = await selectOption(ctx.page, ctx.seasonId, season);
      if (!okSeason) { results[key] = { discipline: key, year, error: 'season_failed', top15: [] }; lastSeason = season; continue; }

      const okCat = await selectOption(ctx.page, ctx.catId, CATEGORY_LABEL) ||
                    await selectOption(ctx.page, ctx.catId, 'U18', true);
      if (!okCat) { results[key] = { discipline: key, year, error: 'category_failed', top15: [] }; lastSeason = season; continue; }

      // Re-discover disc dropdown after AJAX reload
      await wait(1000);
      const updated = await discoverSelects(ctx.page);
      ctx.discId = findSelectId(updated, label) || findSelectId(updated, label, true) || ctx.discId;
      lastSeason = season;
    }

    const okYear = await selectOption(ctx.page, ctx.yearId, year);
    if (!okYear) { results[key] = { discipline: key, year, error: 'year_failed', top15: [] }; continue; }

    const okDisc = await selectOption(ctx.page, ctx.discId, label) ||
                   await selectOption(ctx.page, ctx.discId, label, true);
    if (!okDisc) { results[key] = { discipline: key, year, error: 'disc_failed', top15: [] }; continue; }

    await wait(2000);

    try {
      const btn = ctx.page.locator([
        'button[id*="search"]', 'input[type="submit"]',
        'button:has-text("Suchen")', 'button:has-text("Anzeigen")', 'button:has-text("Liste")'
      ].join(', ')).first();
      if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); await wait(2500); }
    } catch (_) {}

    const html = await ctx.page.content();
    const rows = parseTable(html, isJump);
    console.log(`  → ${rows.length} Einträge  |  Erstes: ${rows[0]?.name} ${rows[0]?.result}`);

    const top15 = rows.slice(0, TOP_N).map(r => ({
      rank: r.rank, name: r.name, result: r.result, wind: r.wind,
      club: r.club, date: r.date, isFiona: r.name.includes(FIONA)
    }));
    const fEntry = rows.find(r => r.name.includes(FIONA));
    const fiona = fEntry ? {
      rank: fEntry.rank, result: fEntry.result, wind: fEntry.wind, date: fEntry.date,
      gapToFirst: rows[0] ? `+${(parseFloat(fEntry.result)-parseFloat(rows[0].result)).toFixed(2)}` : null
    } : null;

    results[key] = { discipline: key, year, scraped: new Date().toISOString(), fiona, top15 };
    if (fiona) console.log(`  ⭐ Fiona: Rang ${fiona.rank} — ${fiona.result}`);
  }

  if (ctx) await ctx.page.close();
  await context.close();
  await browser.close();

  const output = { updated: new Date().toISOString(), disciplines: results };
  fs.writeFileSync('bestenliste.json', JSON.stringify(output, null, 2));
  console.log('\n✅ bestenliste.json geschrieben');

  if (UPLOAD) {
    console.log('⬆ Upload KV…');
    await uploadToKV('bestenliste', output);
    console.log('✅ KV fertig');
  }
})();
