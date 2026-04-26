#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v22
 * PrimeFaces SelectOneMenu — UI-Interaktion (Click Trigger → Click Item)
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

// ── PrimeFaces SelectOneMenu: Click trigger → click item ─────────────────────
// inputId = "form_anonym:bestlistDiscipline_input"
// componentId = "form_anonym:bestlistDiscipline"

async function pfSelect(page, inputId, labelText, partial = false) {
  const componentId = inputId.replace(/_input$/, '');
  const esc = s => s.replace(/:/g, '\\:');

  // 1. Click the PF component wrapper to open the dropdown panel
  const wrapper = page.locator(`#${esc(componentId)}`);
  await wrapper.waitFor({ state: 'visible', timeout: 12000 });
  await wrapper.click();

  // 2. Wait for the panel to open
  const panel = page.locator(`#${esc(componentId)}_panel`);
  try {
    await panel.waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    console.warn(`  ⚠ Panel #${componentId}_panel öffnete nicht`);
    return false;
  }

  // 3. Find and click the matching list item
  const items = panel.locator('li.ui-selectonemenu-item, li[data-label]');
  const allItems = await items.all();
  for (const item of allItems) {
    const text = ((await item.textContent()) || '').trim();
    const match = partial
      ? text.toLowerCase().includes(labelText.toLowerCase())
      : text === labelText;
    if (match) {
      await item.click();
      // Wait for AJAX response
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch {
        await wait(2500);
      }
      console.log(`  ✓ "${labelText}" gewählt in ${componentId}`);
      return true;
    }
  }

  // Debug: show what options are available
  const available = await Promise.all(allItems.map(i => i.textContent()));
  console.warn(`  ⚠ "${labelText}" nicht gefunden. Verfügbar: ${available.map(s=>(s||'').trim()).filter(Boolean).join(', ')}`);

  // Close panel by pressing Escape
  await page.keyboard.press('Escape');
  return false;
}

// ── Discover PF component IDs from hidden backing selects ─────────────────────
// The backing <select id="...Year_input"> → component = "...Year"

async function discoverComponents(page) {
  return await page.evaluate(() => {
    const comps = {};
    document.querySelectorAll('select[id$="_input"]').forEach(sel => {
      const id = sel.id; // e.g. form_anonym:bestlistYear_input
      const opts = Array.from(sel.options).map(o => o.text.trim());
      comps[id] = opts;
    });
    return comps;
  });
}

function findCompId(comps, needle, partial = false) {
  for (const [id, opts] of Object.entries(comps)) {
    if (opts.some(o => partial
      ? o.toLowerCase().includes(needle.toLowerCase())
      : o === needle)) return id;
  }
  return null;
}

// ── DOM table extraction ──────────────────────────────────────────────────────

async function extractTable(page) {
  return await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table tbody tr').forEach(tr => {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (tds.length < 4) return;
      const texts = tds.map(td => (td.innerText || '').trim().replace(/\s+/g, ' '));
      const nr = parseInt(texts[0]);
      if (!isNaN(nr) && nr >= 1 && nr <= 500) rows.push(texts);
    });
    return rows;
  });
}

function mapRows(rawRows) {
  // Columns: Nr | Resultat | Wind | Rang | Name | Verein | Nat. | Geb.Dat. | Wettkampf | Ort | Datum
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
    await wait(3000); // let PrimeFaces init

    const comps = await discoverComponents(page);
    const yearId   = findCompId(comps, year);
    const seasonId = findCompId(comps, season);
    const catId    = findCompId(comps, CATEGORY_LABEL) || findCompId(comps, 'U18', true);
    const discId   = findCompId(comps, label) || findCompId(comps, label, true);

    console.log(`  IDs → Jahr:${yearId} | Saison:${seasonId} | Kat:${catId} | Disc:${discId}`);

    if (!yearId || !seasonId || !catId || !discId) {
      console.error('  ✗ Komponenten nicht gefunden');
      console.error('  Backing selects:', JSON.stringify(
        Object.fromEntries(Object.entries(comps).map(([k,v])=>[k, v.slice(0,4)]))
      ));
      return { discipline: key, year, error: 'components_not_found', top15: [], fiona: null };
    }

    // Order matters: Season → Category → (AJAX reloads disc options) → Year → Discipline
    if (!await pfSelect(page, seasonId, season))
      return { discipline: key, year, error: 'season', top15: [], fiona: null };

    if (!await pfSelect(page, catId, CATEGORY_LABEL) && !await pfSelect(page, catId, 'U18', true))
      return { discipline: key, year, error: 'category', top15: [], fiona: null };

    // Re-discover after category AJAX (disc options change)
    await wait(500);
    const comps2 = await discoverComponents(page);
    const discId2 = findCompId(comps2, label) || findCompId(comps2, label, true) || discId;
    const yearId2 = findCompId(comps2, year) || yearId;

    if (!await pfSelect(page, yearId2, year))
      return { discipline: key, year, error: 'year', top15: [], fiona: null };

    if (!await pfSelect(page, discId2, label) && !await pfSelect(page, discId2, label, true))
      return { discipline: key, year, error: 'discipline', top15: [], fiona: null };

    await wait(2000);

    // Click search button if present
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
    else {
      const txt = await page.evaluate(() => {
        const t = document.querySelector('table');
        return t ? t.innerText.substring(0, 400) : '(keine Tabelle gefunden)';
      });
      console.log(`  Tabellen-Text: ${txt}`);
    }

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
