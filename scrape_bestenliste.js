#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v21
 * - Frische Seite pro Disziplin (kein AJAX-Timing-Problem)
 * - DOM-basierter Table-Parser statt Regex
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

// ── Select by option text, wait for AJAX to settle ───────────────────────────

async function selectOption(page, selectId, labelText, partial = false) {
  const esc = selectId.replace(/:/g, '\\:');
  const sel = page.locator(`#${esc}`);
  try {
    await sel.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    console.warn(`  ⚠ Select #${selectId} nicht sichtbar`);
    return false;
  }
  const options = await sel.locator('option').all();
  for (const opt of options) {
    const text = (await opt.textContent()).trim();
    const match = partial
      ? text.toLowerCase().includes(labelText.toLowerCase())
      : text === labelText;
    if (match) {
      const val = await opt.getAttribute('value');
      await sel.selectOption({ value: val });
      // JSF change trigger
      await page.evaluate(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof jsf !== 'undefined') {
          jsf.ajax.request(el, null, { execute: '@this', render: '@form' });
        }
      }, selectId);
      // Wait for AJAX to settle
      try {
        await page.waitForLoadState('networkidle', { timeout: 8000 });
      } catch { await wait(2000); }
      return true;
    }
  }
  console.warn(`  ⚠ Option "${labelText}" nicht in #${selectId}`);
  return false;
}

// ── Discover select IDs by option content ─────────────────────────────────────

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
    if (opts.some(o => partial
      ? o.toLowerCase().includes(needle.toLowerCase())
      : o === needle)) return id;
  }
  return null;
}

// ── DOM-based table extraction (PrimeFaces DataTable) ────────────────────────

async function extractTable(page) {
  return await page.evaluate((fionaName) => {
    const rows = [];
    // PrimeFaces renders tbody with data rows (tr[data-ri] or just tr inside tbody)
    const tbodies = document.querySelectorAll('table tbody');
    for (const tbody of tbodies) {
      const trs = tbody.querySelectorAll('tr');
      for (const tr of trs) {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 4) continue;
        const texts = tds.map(td => td.innerText.trim().replace(/\s+/g, ' '));

        // First cell should be a row number (Nr)
        const nr = parseInt(texts[0]);
        if (isNaN(nr) || nr < 1 || nr > 500) continue;

        rows.push(texts);
      }
    }
    return rows;
  }, FIONA);
}

// ── Map raw cell arrays to structured entries ─────────────────────────────────
// Swiss Athletics table: Nr | Resultat | Wind | Rang | Name | Verein | Nat. | Geb.Dat. | Wettkampf | Ort | Datum

function mapRows(rawRows, isJump) {
  return rawRows.map(cells => {
    const rank   = parseInt(cells[0]);
    const result = cells[1] || '';
    const wind   = cells[2] || null;
    const name   = cells[4] || '';
    const club   = cells[5] || '';
    const date   = cells[10] || cells[9] || '';
    return {
      rank,
      result,
      wind: wind && wind !== '' && wind !== '0.0' ? wind : null,
      name,
      club,
      date,
    };
  }).filter(r => r.result && r.name);
}

// ── Upload to Cloudflare KV ───────────────────────────────────────────────────

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

// ── Scrape one discipline ─────────────────────────────────────────────────────

async function scrapeDiscipline(context, disc) {
  const { key, year, season, label } = disc;
  const isJump = label.toLowerCase().includes('weit');
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    console.log(`  🌐 Lade Seite…`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await wait(2500);

    const selects = await discoverSelects(page);
    const yearId   = findSelectId(selects, year);
    const seasonId = findSelectId(selects, season);
    const catId    = findSelectId(selects, CATEGORY_LABEL) || findSelectId(selects, 'U18', true);
    const discId   = findSelectId(selects, label) || findSelectId(selects, label, true);

    if (!yearId || !seasonId || !catId || !discId) {
      console.error(`  ✗ Dropdowns nicht gefunden (Jahr:${yearId} Saison:${seasonId} Kat:${catId} Disc:${discId})`);
      console.error('  Selects:', JSON.stringify(Object.fromEntries(Object.entries(selects).map(([k,v])=>[k,v.slice(0,5)]))));
      return { discipline: key, year, error: 'selects_not_found', top15: [], fiona: null };
    }

    console.log(`  Selects → Jahr:${yearId} | Saison:${seasonId} | Kat:${catId} | Disc:${discId}`);

    // Set dropdowns in order
    if (!await selectOption(page, seasonId, season))              return { discipline:key, year, error:'season', top15:[], fiona:null };
    if (!await selectOption(page, catId, CATEGORY_LABEL) &&
        !await selectOption(page, catId, 'U18', true))            return { discipline:key, year, error:'category', top15:[], fiona:null };

    // Re-discover after AJAX (options may have changed)
    const selects2 = await discoverSelects(page);
    const discId2  = findSelectId(selects2, label) || findSelectId(selects2, label, true) || discId;
    const yearId2  = findSelectId(selects2, year) || yearId;

    if (!await selectOption(page, yearId2, year))                 return { discipline:key, year, error:'year', top15:[], fiona:null };
    if (!await selectOption(page, discId2, label) &&
        !await selectOption(page, discId2, label, true))          return { discipline:key, year, error:'discipline', top15:[], fiona:null };

    await wait(2000);

    // Click search if visible
    try {
      const btn = page.locator([
        'button[id*="search"]', 'input[type="submit"]',
        'button:has-text("Suchen")', 'button:has-text("Anzeigen")',
        'button:has-text("Liste anzeigen")'
      ].join(', ')).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch { await wait(2500); }
      }
    } catch (_) {}

    const rawRows = await extractTable(page);
    console.log(`  → ${rawRows.length} Zeilen (DOM)`);

    // Debug: dump first raw row
    if (rawRows.length > 0) console.log(`  Roh[0]: ${JSON.stringify(rawRows[0])}`);
    else {
      // Fallback: dump table text for debugging
      const tableText = await page.evaluate(() => {
        const t = document.querySelector('table');
        return t ? t.innerText.substring(0, 500) : '(keine Tabelle)';
      });
      console.log(`  Tabelle-Text: ${tableText}`);
    }

    const rows = mapRows(rawRows, isJump);
    const top15 = rows.slice(0, TOP_N).map(r => ({
      rank: r.rank, name: r.name, result: r.result,
      wind: r.wind, club: r.club, date: r.date,
      isFiona: r.name.includes(FIONA),
    }));

    const fEntry = rows.find(r => r.name.includes(FIONA));
    const fiona  = fEntry ? {
      rank: fEntry.rank, result: fEntry.result, wind: fEntry.wind, date: fEntry.date,
      gapToFirst: rows[0] ? `+${(parseFloat(fEntry.result)-parseFloat(rows[0].result)).toFixed(2)}` : null,
    } : null;

    if (fiona) console.log(`  ⭐ Fiona: Rang ${fiona.rank} — ${fiona.result}`);
    return { discipline: key, year, scraped: new Date().toISOString(), fiona, top15 };

  } finally {
    await page.close();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const results = {};

  for (const disc of DISCIPLINES) {
    console.log(`\n📋 ${disc.key}  (${disc.season} ${disc.year} — "${disc.label}")`);
    results[disc.key] = await scrapeDiscipline(context, disc);
  }

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
