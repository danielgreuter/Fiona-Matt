#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v29
 * Playwright-basiert (HTTP geht nicht wegen doSpot() JS-Funktion)
 * Extraktion: innerText des Resultate-Containers, dann Text-Parsing
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

// ── Cookie-Banner ─────────────────────────────────────────────────────────────

async function dismissCookie(page) {
  for (const txt of ['Nein','Ablehnen','Reject','Ja','Akzeptieren']) {
    try {
      const btn = page.locator(`button:has-text("${txt}")`).first();
      await btn.waitFor({ state: 'visible', timeout: 6000 });
      await btn.click();
      await btn.waitFor({ state: 'hidden', timeout: 4000 }).catch(()=>{});
      console.log(`  🍪 "${txt}" geklickt`);
      await wait(400);
      return;
    } catch(_) {}
  }
}

// ── PrimeFaces SelectOneMenu ──────────────────────────────────────────────────

async function pfSelect(page, inputId, labelText, partial = false) {
  const compId = inputId.replace(/_input$/, '');
  const wrapper = page.locator(`#${esc(compId)}`);
  await wrapper.waitFor({ state: 'visible', timeout: 12000 });
  await wrapper.click();

  // Panel kann _items oder _panel heissen
  let panel = null;
  for (const suffix of ['_items', '_panel']) {
    const p = page.locator(`#${esc(compId)}${suffix}`);
    try { await p.waitFor({ state: 'visible', timeout: 4000 }); panel = p; break; }
    catch(_) {}
  }
  if (!panel) {
    console.warn(`  ⚠ Panel für ${compId} nicht gefunden`);
    await page.keyboard.press('Escape');
    return false;
  }

  const allItems = await panel.locator('li').all();
  for (const item of allItems) {
    const text = ((await item.textContent()) || '').trim();
    const match = partial
      ? text.toLowerCase().includes(labelText.toLowerCase())
      : text === labelText;
    if (match) {
      await item.click();
      // Warte auf doSpot() AJAX
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); }
      catch { await wait(1500); }
      console.log(`  ✓ "${text}"`);
      return true;
    }
  }

  const avail = (await Promise.all(allItems.map(i => i.textContent())))
    .map(s=>(s||'').trim()).filter(Boolean);
  console.warn(`  ⚠ "${labelText}" nicht gefunden. Optionen: ${avail.slice(0,6).join(' | ')}`);
  await page.keyboard.press('Escape');
  return false;
}

// ── Discover backing selects ──────────────────────────────────────────────────

async function discover(page) {
  return await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('select').forEach(s => {
      out[s.id] = Array.from(s.options).map(o => o.text.trim());
    });
    return out;
  });
}

function findId(comps, needle, partial=false) {
  for (const [id, opts] of Object.entries(comps))
    if (opts.some(o => partial
      ? o.toLowerCase().includes(needle.toLowerCase())
      : o === needle)) return id;
  return null;
}

// ── Warte auf Resultate ───────────────────────────────────────────────────────

async function waitForResults(page) {
  // Warte bis form_anonym:bestlistSearches Resultate enthält
  // Erkennung: mindestens ein Element mit einer Zeit oder Weite (z.B. "12.08")
  try {
    await page.waitForFunction(() => {
      const container = document.getElementById('form_anonym:bestlistSearches');
      if (!container) return false;
      const text = container.innerText || '';
      // Mindestens eine Sprint-Zeit (7.xx, 12.xx, 24.xx) oder Weite (5.xx)
      return /\b\d{1,2}\.\d{2}\b/.test(text) && text.length > 200;
    }, { timeout: 20000, polling: 500 });
    console.log('  ✓ Resultate erschienen');
    return true;
  } catch {
    // Debug
    const info = await page.evaluate(() => {
      const c = document.getElementById('form_anonym:bestlistSearches');
      return c ? c.innerText.substring(0,300).replace(/\n/g,' ') : '(Container nicht gefunden)';
    });
    console.warn(`  ✗ Keine Resultate nach 20s. Container: ${info}`);
    return false;
  }
}

// ── Extrahiere Resultate aus Container ────────────────────────────────────────

async function extractResults(page) {
  return await page.evaluate(() => {
    const container = document.getElementById('form_anonym:bestlistSearches');
    if (!container) return [['ERROR: container not found']];

    const rows = [];

    // Strategie 1: data-ri (PrimeFaces DataTable)
    container.querySelectorAll('[data-ri]').forEach(row => {
      const texts = [];
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (t) texts.push(t);
      }
      if (texts.length >= 4) rows.push(texts);
    });
    if (rows.length > 0) return rows;

    // Strategie 2: Suche nach div mit Klassen die auf DataTable-Rows hinweisen
    const rowSelectors = [
      '.ui-datatable-data tr',
      '.ui-widget-content',
      'tr[class*="ui-"]',
      'div[class*="row"]:not([class*="panelgrid"])',
    ];
    for (const sel of rowSelectors) {
      container.querySelectorAll(sel).forEach(row => {
        const texts = [];
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const t = node.textContent.trim();
          if (t) texts.push(t);
        }
        // Nur Zeilen die mit einer Zahl beginnen (Nr-Spalte)
        if (texts.length >= 5 && /^\d+$/.test(texts[0])) rows.push(texts);
      });
      if (rows.length > 0) return rows;
    }

    // Strategie 3: innerText zeilenweise, nur Zeilen die mit Nr. anfangen
    // Dump innerHTML für Diagnose (erste 3000 Zeichen)
    const snippet = container.innerHTML.substring(0, 3000);
    return [['DEBUG_HTML', snippet]];
  });
}

// ── Text-Rows mappen ──────────────────────────────────────────────────────────

function mapRows(rawRows) {
  return rawRows.map(texts => {
    const nr = parseInt(texts[0]);
    if (isNaN(nr) || nr < 1 || nr > 500) return null;

    // Finde Resultat (Zeit oder Weite)
    const resultIdx = texts.findIndex((t,i) => i > 0 &&
      /^\d{1,2}[.:]\d{2}(\.\d+)?$/.test(t) || /^\d+\.\d{2}$/.test(t));
    if (resultIdx < 0) return null;

    const result = texts[resultIdx];
    // Wind direkt nach Resultat wenn +/-
    let wind = null, nameSearch = resultIdx + 1;
    if (texts[resultIdx+1] && /^[+-]\d+\.\d$/.test(texts[resultIdx+1])) {
      wind = texts[resultIdx+1];
      nameSearch = resultIdx + 2;
    }
    // Überspringe Rang (z.B. "1r1")
    if (texts[nameSearch] && /^\d+r\d+$/.test(texts[nameSearch])) nameSearch++;

    const name = texts[nameSearch] || '';
    const club = texts[nameSearch+1] || '';
    const date = texts.find(t => /^\d{2}\.\d{2}\.\d{4}$/.test(t)) || '';

    return { rank: nr, result, wind, name, club, date };
  }).filter(r => r && r.result && r.name && r.name.length > 2);
}

// ── Upload KV ────────────────────────────────────────────────────────────────

async function uploadToKV(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method:'PUT',
    headers:{'Authorization':`Bearer ${CF_API_TOKEN}`,'Content-Type':'application/json'},
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
    await page.goto(BASE_URL, { waitUntil:'domcontentloaded', timeout:40000 });
    await wait(2500);

    await dismissCookie(page);

    const comps   = await discover(page);
    const seasonId = findId(comps, season);
    const catId    = findId(comps, CATEGORY_LABEL) || findId(comps, 'U18', true);
    const typeId   = findId(comps, 'Ein Resultat pro Athlet');
    const topsId   = findId(comps, '30');

    if (!seasonId || !catId)
      return { discipline:key, year, error:'selects_not_found', top15:[], fiona:null };

    // Saison
    if (!await pfSelect(page, seasonId, season))
      return { discipline:key, year, error:'season', top15:[], fiona:null };

    // Kategorie
    if (!await pfSelect(page, catId, CATEGORY_LABEL))
      return { discipline:key, year, error:'category', top15:[], fiona:null };

    // Re-discover (Disziplin-Options laden nach Kategorie)
    await wait(300);
    const comps2  = await discover(page);
    const yearId2 = findId(comps2, year) || findId(comps, year);
    const discId2 = findId(comps2, label) || findId(comps2, label, true)
                  || findId(comps, label)  || findId(comps, label, true);

    if (!yearId2) return { discipline:key, year, error:'year_not_found', top15:[], fiona:null };
    if (!discId2) return { discipline:key, year, error:'disc_not_found', top15:[], fiona:null };

    // Jahr
    if (!await pfSelect(page, yearId2, year))
      return { discipline:key, year, error:'year', top15:[], fiona:null };

    // Disziplin
    if (!await pfSelect(page, discId2, label) && !await pfSelect(page, discId2, label, true))
      return { discipline:key, year, error:'discipline', top15:[], fiona:null };

    // Typ + Tops
    if (typeId) await pfSelect(page, typeId, 'Ein Resultat pro Athlet');
    if (topsId) await pfSelect(page, topsId, '30');

    // Warte auf Resultate
    const hasResults = await waitForResults(page);
    if (!hasResults)
      return { discipline:key, year, error:'no_results', top15:[], fiona:null };

    const rawRows = await extractResults(page);

    // Immer HTML-Dump für erste Disziplin
    if (key === '100m') {
      const dump = await page.evaluate(() => {
        const c = document.getElementById('form_anonym:bestlistSearches');
        return c ? c.innerHTML.substring(0, 4000) : 'NOT FOUND';
      });
      console.log(`  🔍 DUMP:\n${dump}\n🔍 END`);
    }

    // Debug-Dump wenn kein Resultat gefunden
    if (rawRows.length > 0 && rawRows[0][0] === 'DEBUG_HTML') {
      console.log(`  🔍 innerHTML snippet:\n${rawRows[0][1]}`);
      return { discipline:key, year, error:'no_rows_parsed', top15:[], fiona:null };
    }

    console.log(`  → ${rawRows.length} Zeilen | [0]: ${JSON.stringify(rawRows[0]?.slice?.(0,6) ?? rawRows[0])}`);

    const rows  = mapRows(rawRows);
    const top15 = rows.slice(0, TOP_N).map(r => ({
      rank:r.rank, name:r.name, result:r.result,
      wind:r.wind, club:r.club, date:r.date,
      isFiona:r.name.includes(FIONA),
    }));
    const fEntry = rows.find(r => r.name.includes(FIONA));
    const fiona  = fEntry ? {
      rank:fEntry.rank, result:fEntry.result, wind:fEntry.wind, date:fEntry.date,
      gapToFirst: rows[0] ? `+${(parseFloat(fEntry.result)-parseFloat(rows[0].result)).toFixed(2)}` : null,
    } : null;

    if (fiona) console.log(`  ⭐ Fiona: Rang ${fiona.rank} — ${fiona.result}`);
    else console.log(`  Fiona nicht in Top-${TOP_N} (1. Platz: ${rows[0]?.name} ${rows[0]?.result})`);
    return { discipline:key, year, scraped:new Date().toISOString(), fiona, top15 };

  } finally {
    await page.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  });

  const results = {};
  for (const disc of DISCIPLINES) {
    console.log(`\n📋 ${disc.key}  (${disc.season} ${disc.year} — "${disc.label}")`);
    results[disc.key] = await scrapeDiscipline(context, disc);
  }

  await context.close();
  await browser.close();

  const output = { updated:new Date().toISOString(), disciplines:results };
  fs.writeFileSync('bestenliste.json', JSON.stringify(output, null, 2));
  console.log('\n✅ bestenliste.json geschrieben');

  if (UPLOAD) {
    console.log('⬆ KV…');
    await uploadToKV('bestenliste', output);
    console.log('✅ fertig');
  }
})();
