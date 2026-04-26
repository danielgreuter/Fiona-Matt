#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v19 — Playwright
 * Fix v19: Navigiert die Seite bei JEDEM Season-Wechsel neu,
 *          damit JSF-Dropdowns sauber laden (kein Indoor→Outdoor Hänger mehr).
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

// ── Select helper ─────────────────────────────────────────────────────────────

async function selectByLabel(page, selectId, labelText, partial = false) {
  const esc = selectId.replace(/:/g, '\\:');
  const select = page.locator(`#${esc}`);
  await select.waitFor({ state: 'visible', timeout: 10000 });
  const options = await select.locator('option').all();
  for (const opt of options) {
    const text = (await opt.textContent()).trim();
    const match = partial
      ? text.toLowerCase().includes(labelText.toLowerCase())
      : text === labelText;
    if (match) {
      const val = await opt.getAttribute('value');
      await select.selectOption({ value: val });
      // fire change event for JSF AJAX
      await page.evaluate(id => {
        const el = document.getElementById(id);
        if (el) {
          el.dispatchEvent(new Event('change', { bubbles: true }));
          if (typeof PrimeFaces !== 'undefined') {
            PrimeFaces.ajax.Request.handle({ source: el, process: '@this', update: '@form' });
          }
        }
      }, selectId.replace(/\\\:/g, ':'));
      await wait(1200);
      return true;
    }
  }
  console.warn(`  ⚠ Option "${labelText}" not found in #${selectId}`);
  return false;
}

// ── Parse results table ───────────────────────────────────────────────────────

function parseTable(html, isJump) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowM;
  while ((rowM = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cellRe.exec(rowM[1])) !== null) {
      cells.push(
        cm[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()
      );
    }
    if (cells.length < 4) continue;
    const rank = parseInt((cells[0] || '').replace(/Nr\.?\s*/i, '').trim());
    if (isNaN(rank) || rank < 1 || rank > 1000) continue;

    let result = '', name = '', club = '', date = '', wind = '';
    for (const c of cells.slice(1)) {
      if (!result && (isJump ? /^\d+\.\d{2}$/.test(c) : /^\d{1,2}[:.]\d{2}(\.\d+)?$/.test(c))) {
        result = c;
      } else if (!wind && /^[+-]\d+\.\d$/.test(c)) {
        wind = c;
      } else if (!date && /^\d{2}\.\d{2}\.\d{4}$/.test(c)) {
        date = c;
      } else if (!name && /^[A-ZÁÀÂÄÉÈÊËÍÏÓÔÖÚÛÜÑÇА-Я][a-záàâäéèêëíïóôöúûüñç\-' ]+$/.test(c) && c.length > 3) {
        name = c;
      } else if (!club && c.length > 2 && !/^\d/.test(c)) {
        club = c;
      }
    }
    if (result && name) rows.push({ rank, name, result, wind: wind || null, club, date });
  }
  return rows;
}

// ── Upload to Cloudflare KV ────────────────────────────────────────────────────

async function uploadToKV(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const j = await res.json();
  if (!j.success) throw new Error(`KV upload failed for ${key}: ${JSON.stringify(j.errors)}`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const results = {};
  let lastSeason = null;
  let page = null;
  const context = await browser.newContext();

  for (const disc of DISCIPLINES) {
    const { key, year, season, label } = disc;
    const isJump = label.toLowerCase().includes('weit') || label.toLowerCase().includes('jump');
    console.log(`\n📋 ${key} (${season} ${year} — "${label}")`);

    // ── FRESH PAGE on every season change (or first run) ──────────────────────
    if (!page || season !== lastSeason) {
      if (page) await page.close();
      page = await context.newPage();
      page.setDefaultTimeout(15000);
      console.log(`  🌐 Navigating fresh (season changed: ${lastSeason} → ${season})`);
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await wait(1000);

      // Set Saison
      const seasonOk = await selectByLabel(page, 'j_idt36:environment', season);
      if (!seasonOk) { console.error('  ✗ Season select failed'); results[key] = { discipline: key, year, error: 'season_select_failed', top15: [] }; lastSeason = season; continue; }
      await wait(800);

      // Set Kategorie
      const catOk = await selectByLabel(page, 'j_idt36:categorycode', CATEGORY_LABEL);
      if (!catOk) { console.error('  ✗ Category select failed'); results[key] = { discipline: key, year, error: 'category_select_failed', top15: [] }; lastSeason = season; continue; }
      await wait(800);

      lastSeason = season;
    }

    // ── Year (always set) ─────────────────────────────────────────────────────
    const yearOk = await selectByLabel(page, 'j_idt36:year', year);
    if (!yearOk) { console.error('  ✗ Year select failed'); results[key] = { discipline: key, year, error: 'year_select_failed', top15: [] }; continue; }

    // ── Discipline ────────────────────────────────────────────────────────────
    const discOk = await selectByLabel(page, 'j_idt36:eventcode', label, false);
    if (!discOk) {
      // try partial match
      const discOk2 = await selectByLabel(page, 'j_idt36:eventcode', label, true);
      if (!discOk2) { console.error('  ✗ Discipline select failed'); results[key] = { discipline: key, year, error: 'disc_select_failed', top15: [] }; continue; }
    }
    await wait(1500);

    // ── Trigger search ────────────────────────────────────────────────────────
    try {
      const btn = page.locator('button[id*="search"], input[type="submit"], button:has-text("Suchen"), button:has-text("Anzeigen")').first();
      if (await btn.isVisible({ timeout: 3000 })) {
        await btn.click();
        await wait(2000);
      }
    } catch (_) { /* no submit button, auto-search */ }

    // ── Grab HTML and parse ───────────────────────────────────────────────────
    const html = await page.content();
    const rows = parseTable(html, isJump);
    console.log(`  → ${rows.length} rows parsed`);

    const top15 = rows.slice(0, TOP_N).map(r => ({
      rank: r.rank,
      name: r.name,
      result: r.result,
      wind: r.wind,
      club: r.club,
      date: r.date,
      isFiona: r.name.includes(FIONA),
    }));

    const fionaEntry = rows.find(r => r.name.includes(FIONA));
    const fionaData = fionaEntry ? {
      rank: fionaEntry.rank,
      result: fionaEntry.result,
      wind: fionaEntry.wind,
      date: fionaEntry.date,
      gapToFirst: rows[0] ? `+${(parseFloat(fionaEntry.result) - parseFloat(rows[0].result)).toFixed(2)}` : null,
    } : null;

    results[key] = {
      discipline: key,
      year,
      scraped: new Date().toISOString(),
      fiona: fionaData,
      top15,
    };

    if (fionaData) console.log(`  ⭐ Fiona: Rang ${fionaData.rank} — ${fionaData.result}`);
  }

  await context.close();
  await browser.close();

  // ── Assemble output ────────────────────────────────────────────────────────
  const output = { updated: new Date().toISOString(), disciplines: results };
  const json = JSON.stringify(output, null, 2);
  fs.writeFileSync('bestenliste.json', json);
  console.log('\n✅ bestenliste.json written');

  if (UPLOAD) {
    console.log('⬆ Uploading to KV…');
    await uploadToKV('bestenliste', output);
    console.log('✅ KV upload done');
  }
})();
