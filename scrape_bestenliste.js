#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v24
 * Fixes:
 * - PF Panel-ID ist _items nicht _panel
 * - Resultate in div[data-ri], nicht in <table>
 * - Cookie-Banner Dismissal
 * - "Ein Resultat pro Athlet" + "30" setzen
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
const esc  = s => s.replace(/:/g, '\\:');

// ── PrimeFaces SelectOneMenu: click wrapper → wait for _items panel → click li ──

async function pfSelect(page, inputId, labelText, partial = false) {
  const compId = inputId.replace(/_input$/, '');

  // Click the visible wrapper div to open panel
  const wrapper = page.locator(`#${esc(compId)}`);
  await wrapper.waitFor({ state: 'visible', timeout: 12000 });
  await wrapper.click();

  // Panel ID is <compId>_items (not _panel!)
  const panel = page.locator(`#${esc(compId)}_items`);
  try {
    await panel.waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    // Fallback: try _panel
    const panel2 = page.locator(`#${esc(compId)}_panel`);
    try { await panel2.waitFor({ state: 'visible', timeout: 4000 }); }
    catch {
      console.warn(`  ⚠ Panel für ${compId} nicht gefunden`);
      await page.keyboard.press('Escape');
      return false;
    }
  }

  // Find and click the matching li item
  const liSel = `#${esc(compId)}_items li, #${esc(compId)}_panel li`;
  const allItems = await page.locator(liSel).all();
  for (const item of allItems) {
    const text = ((await item.textContent()) || '').trim();
    const match = partial
      ? text.toLowerCase().includes(labelText.toLowerCase())
      : text === labelText;
    if (match) {
      await item.click();
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }); }
      catch { await wait(2500); }
      console.log(`  ✓ "${text}" in ${compId}`);
      return true;
    }
  }

  const avail = (await Promise.all(allItems.map(i => i.textContent())))
    .map(s => (s||'').trim()).filter(Boolean);
  console.warn(`  ⚠ "${labelText}" nicht gefunden. Verfügbar: ${avail.slice(0,8).join(' | ')}`);
  await page.keyboard.press('Escape');
  return false;
}

// ── Discover backing select IDs ───────────────────────────────────────────────

async function discoverComponents(page) {
  return await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('select').forEach(s => {
      out[s.id] = Array.from(s.options).map(o => o.text.trim());
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

// ── Extract results from PrimeFaces div[data-ri] rows ────────────────────────

async function extractResults(page) {
  // Wait for at least one result row
  try {
    await page.waitForSelector('div[data-ri]', { timeout: 8000 });
  } catch {
    // Debug: what's on the page?
    const info = await page.evaluate(() => ({
      dataRiCount: document.querySelectorAll('[data-ri]').length,
      divCount: document.querySelectorAll('div').length,
      bodySnippet: document.body.innerText.substring(0, 300).replace(/\n/g,' '),
    }));
    console.log(`  ⚠ Keine div[data-ri] gefunden. Info: ${JSON.stringify(info)}`);
    return [];
  }

  return await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('div[data-ri]').forEach(row => {
      // Each cell is a div with ui-cell-data or similar
      const cells = Array.from(row.querySelectorAll('[class*="cell"], [class*="col"], div > span, div'))
        .map(el => (el.children.length === 0 ? (el.innerText||'').trim() : null))
        .filter(t => t !== null && t !== '');

      // Also try: just get all direct child divs' text
      const directCells = Array.from(row.children)
        .map(c => (c.innerText || '').trim().replace(/\s+/g,' '));

      const best = directCells.length >= 4 ? directCells : cells;
      if (best.length >= 4) rows.push({ ri: row.getAttribute('data-ri'), cells: best });
    });
    return rows;
  });
}

// ── Map extracted rows to structured data ────────────────────────────────────
// Expected columns: Nr | Resultat | Wind | Rang | Name | Verein | Nat. | Geb.Dat. | Wettkampf | Ort | Datum

function mapRows(rawRows) {
  return rawRows.map(r => {
    const c = r.cells;
    return {
      rank:   parseInt(c[0]) || (parseInt(r.ri) + 1),
      result: (c[1] || '').trim(),
      wind:   (c[2] || '').trim() || null,
      name:   (c[4] || '').trim(),
      club:   (c[5] || '').trim(),
      date:   (c[10] || c[9] || '').trim(),
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

    // Dismiss cookie banner
    try {
      for (const txt of ['Nein','Ablehnen','Akzeptieren','Ja']) {
        const btn = page.locator(`button:has-text("${txt}")`).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click();
          await wait(800);
          console.log(`  Cookie "${txt}" geklickt`);
          break;
        }
      }
    } catch(_) {}

    const comps   = await discoverComponents(page);
    const seasonId = findCompId(comps, season);
    const catId    = findCompId(comps, CATEGORY_LABEL) || findCompId(comps, 'U18', true);
    const typeId   = findCompId(comps, 'Ein Resultat pro Athlet');
    const topsId   = findCompId(comps, '30');

    if (!seasonId || !catId) {
      console.error(`  ✗ Saison/Kat IDs nicht gefunden`);
      return { discipline: key, year, error: 'selects_not_found', top15: [], fiona: null };
    }

    // 1. Saison
    if (!await pfSelect(page, seasonId, season))
      return { discipline: key, year, error: 'season', top15: [], fiona: null };

    // 2. Kategorie
    if (!await pfSelect(page, catId, CATEGORY_LABEL) && !await pfSelect(page, catId, 'U18', true))
      return { discipline: key, year, error: 'category', top15: [], fiona: null };

    // Re-discover (discipline options reload after category)
    await wait(500);
    const comps2  = await discoverComponents(page);
    const yearId2 = findCompId(comps2, year) || findCompId(comps, year);
    const discId2 = findCompId(comps2, label) || findCompId(comps2, label, true)
                  || findCompId(comps, label)  || findCompId(comps, label, true);

    if (!yearId2) return { discipline: key, year, error: 'year_not_found', top15: [], fiona: null };
    if (!discId2) return { discipline: key, year, error: 'disc_not_found', top15: [], fiona: null };

    // 3. Jahr
    if (!await pfSelect(page, yearId2, year))
      return { discipline: key, year, error: 'year', top15: [], fiona: null };

    // 4. Disziplin
    if (!await pfSelect(page, discId2, label) && !await pfSelect(page, discId2, label, true))
      return { discipline: key, year, error: 'discipline', top15: [], fiona: null };

    // 5. Typ: "Ein Resultat pro Athlet"
    if (typeId) await pfSelect(page, typeId, 'Ein Resultat pro Athlet');

    // 6. Anzahl: 30
    if (topsId) await pfSelect(page, topsId, '30');

    await wait(3000);

    const rawRows = await extractResults(page);
    console.log(`  → ${rawRows.length} div[data-ri]-Zeilen`);
    if (rawRows[0]) console.log(`  Roh[0]: ${JSON.stringify(rawRows[0].cells)}`);

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
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
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
