#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v23
 * - Wartet aktiv auf Tabellenzeilen (waitForSelector)
 * - Probiert mehrere Selektoren für PrimeFaces DataTable
 * - Inline-Debug im Actions-Log
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

// ── PrimeFaces SelectOneMenu click interaction ────────────────────────────────

async function pfSelect(page, inputId, labelText, partial = false) {
  const componentId = inputId.replace(/_input$/, '');
  const esc = s => s.replace(/:/g, '\\:');

  const wrapper = page.locator(`#${esc(componentId)}`);
  await wrapper.waitFor({ state: 'visible', timeout: 12000 });
  await wrapper.click();

  const panel = page.locator(`#${esc(componentId)}_panel`);
  try { await panel.waitFor({ state: 'visible', timeout: 8000 }); }
  catch { console.warn(`  ⚠ Panel ${componentId}_panel öffnete nicht`); return false; }

  const allItems = await panel.locator('li').all();
  for (const item of allItems) {
    const text = ((await item.textContent()) || '').trim();
    const match = partial
      ? text.toLowerCase().includes(labelText.toLowerCase())
      : text === labelText;
    if (match) {
      await item.click();
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }); }
      catch { await wait(2500); }
      console.log(`  ✓ "${text}" gewählt in ${componentId}`);
      return true;
    }
  }

  const avail = (await Promise.all(allItems.map(i => i.textContent())))
    .map(s => (s||'').trim()).filter(Boolean);
  console.warn(`  ⚠ "${labelText}" nicht gefunden. Verfügbar: ${avail.slice(0,10).join(' | ')}`);
  await page.keyboard.press('Escape');
  return false;
}

// ── Discover backing select IDs ───────────────────────────────────────────────

async function discoverComponents(page) {
  return await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('select').forEach(sel => {
      out[sel.id] = Array.from(sel.options).map(o => o.text.trim());
    });
    return out;
  });
}

function findCompId(comps, needle, partial = false) {
  for (const [id, opts] of Object.entries(comps))
    if (opts.some(o => partial
      ? o.toLowerCase().includes(needle.toLowerCase())
      : o === needle)) return id;
  return null;
}

// ── Wait for results and extract table ───────────────────────────────────────

async function extractTable(page) {
  // Try to wait for at least one data row to appear
  const ROW_SELECTORS = [
    'div.ui-datatable table tbody tr',
    'div[id*="bestlist"] table tbody tr',
    'table.ui-datatable-data tbody tr',
    'tbody[id*="data"] tr',
    'table tbody tr[data-ri]',
    'table tbody tr',
  ];

  let foundSelector = null;
  for (const sel of ROW_SELECTORS) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 });
      const count = await page.locator(sel).count();
      if (count > 0) { foundSelector = sel; break; }
    } catch { /* try next */ }
  }

  if (!foundSelector) {
    // Debug: what's on the page?
    const debug = await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      const divs   = Array.from(document.querySelectorAll('div[class*="datatable"], div[class*="list"], div[id*="best"]'))
                         .map(d => `<div id="${d.id}" class="${d.className}">${d.innerText.substring(0,100)}</div>`);
      return {
        tableCount: tables.length,
        tableClasses: Array.from(tables).map(t => t.className).slice(0,5),
        relevantDivs: divs.slice(0,5),
        bodyText: document.body.innerText.substring(0, 300),
      };
    });
    console.log(`  🔍 Debug DOM: tables=${debug.tableCount} | classes=${debug.tableClasses.join(',')} | body="${debug.bodyText.replace(/\n/g,' ').substring(0,150)}"`);
    if (debug.relevantDivs.length) console.log(`  relevantDivs: ${debug.relevantDivs.join(' ')}`);
    return [];
  }

  console.log(`  ✓ Selektor gefunden: ${foundSelector}`);

  return await page.evaluate((sel) => {
    const rows = [];
    document.querySelectorAll(sel).forEach(tr => {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (tds.length < 4) return;
      const texts = tds.map(td => (td.innerText || td.textContent || '').trim().replace(/\s+/g, ' '));
      const nr = parseInt(texts[0]);
      if (!isNaN(nr) && nr >= 1 && nr <= 500) rows.push(texts);
    });
    return rows;
  }, foundSelector);
}

function mapRows(rawRows) {
  // Nr | Resultat | Wind | Rang | Name | Verein | Nat. | Geb.Dat. | Wettkampf | Ort | Datum
  return rawRows.map(cells => ({
    rank:   parseInt(cells[0]),
    result: (cells[1] || '').trim(),
    wind:   (cells[2] || '').trim() || null,
    name:   (cells[4] || '').trim(),
    club:   (cells[5] || '').trim(),
    date:   (cells[10] || cells[9] || '').trim(),
  })).filter(r => r.result && r.name);
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
  if (!j.success) throw new Error(`KV failed: ${JSON.stringify(j.errors)}`);
}

// ── Scrape one discipline ─────────────────────────────────────────────────────

async function scrapeDiscipline(context, disc) {
  const { key, year, season, label } = disc;
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await wait(3000);

    const comps = await discoverComponents(page);
    const seasonId = findCompId(comps, season);
    const catId    = findCompId(comps, CATEGORY_LABEL) || findCompId(comps, 'U18', true);

    if (!seasonId || !catId) {
      console.error(`  ✗ Saison/Kat nicht gefunden`);
      return { discipline: key, year, error: 'selects_not_found', top15: [], fiona: null };
    }

    if (!await pfSelect(page, seasonId, season))
      return { discipline: key, year, error: 'season', top15: [], fiona: null };

    if (!await pfSelect(page, catId, CATEGORY_LABEL) && !await pfSelect(page, catId, 'U18', true))
      return { discipline: key, year, error: 'category', top15: [], fiona: null };

    // Re-discover after AJAX
    await wait(500);
    const comps2  = await discoverComponents(page);
    const yearId2 = findCompId(comps2, year) || findCompId(comps, year);
    const discId2 = findCompId(comps2, label) || findCompId(comps2, label, true)
                 || findCompId(comps, label)   || findCompId(comps, label, true);

    if (!yearId2) { console.error(`  ✗ Jahr ${year} nicht gefunden`); return { discipline:key, year, error:'year_not_found', top15:[], fiona:null }; }
    if (!discId2) { console.error(`  ✗ Disziplin "${label}" nicht gefunden`); return { discipline:key, year, error:'disc_not_found', top15:[], fiona:null }; }

    if (!await pfSelect(page, yearId2, year))
      return { discipline: key, year, error: 'year', top15: [], fiona: null };

    if (!await pfSelect(page, discId2, label) && !await pfSelect(page, discId2, label, true))
      return { discipline: key, year, error: 'discipline', top15: [], fiona: null };

    // Extra wait after last dropdown
    await wait(3000);

    // Click search if present
    try {
      const btn = page.locator('button:has-text("Suchen"), button:has-text("Anzeigen"), input[type="submit"]').first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch { await wait(3000); }
      }
    } catch (_) {}

    const rawRows = await extractTable(page);
    console.log(`  → ${rawRows.length} Zeilen`);
    if (rawRows[0]) console.log(`  Roh[0]: ${JSON.stringify(rawRows[0])}`);

    const rows  = mapRows(rawRows);
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
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
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
    console.log('⬆ KV Upload…');
    await uploadToKV('bestenliste', output);
    console.log('✅ fertig');
  }
})();
