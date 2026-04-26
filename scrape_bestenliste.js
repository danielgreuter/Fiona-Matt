#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v25
 * - waitForFunction statt blindem wait() nach Dropdowns
 * - robuster Button-Click via JS-Fallback
 * - Extraktion aus div[data-ri] oder Fallback auf Text-Parsing
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

// ── PrimeFaces SelectOneMenu ──────────────────────────────────────────────────

async function pfSelect(page, inputId, labelText, partial = false) {
  const compId = inputId.replace(/_input$/, '');
  const wrapper = page.locator(`#${esc(compId)}`);
  await wrapper.waitFor({ state: 'visible', timeout: 12000 });
  await wrapper.click();

  // Panel kann _items oder _panel heissen
  let panel = page.locator(`#${esc(compId)}_items`);
  try { await panel.waitFor({ state: 'visible', timeout: 5000 }); }
  catch {
    panel = page.locator(`#${esc(compId)}_panel`);
    try { await panel.waitFor({ state: 'visible', timeout: 5000 }); }
    catch {
      console.warn(`  ⚠ Panel für ${compId} nicht sichtbar`);
      await page.keyboard.press('Escape');
      return false;
    }
  }

  const allItems = await panel.locator('li').all();
  for (const item of allItems) {
    const text = ((await item.textContent()) || '').trim();
    const match = partial
      ? text.toLowerCase().includes(labelText.toLowerCase())
      : text === labelText;
    if (match) {
      await item.click();
      // Warte bis AJAX settled (max 8s), kein harter Fehler wenn nicht networkidle
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); }
      catch { await wait(2000); }
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

// ── Klick "Anzeigen"-Button (PrimeFaces CommandButton) ────────────────────────

async function clickAnzeigen(page) {
  // Versuche verschiedene Selektoren
  const selectors = [
    'button:has-text("Anzeigen")',
    'a:has-text("Anzeigen")',
    '[id*="search"]',
    '[id*="anzeigen"]',
    '[id*="show"]',
    'button[type="submit"]',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click();
        console.log(`  ✓ Button geklickt: ${sel}`);
        return true;
      }
    } catch(_) {}
  }

  // JS-Fallback: finde alle Buttons und klicke den mit "Anzeigen"-Text
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a, input[type="submit"], span[role="button"]'));
    for (const b of btns) {
      if ((b.textContent || '').trim().toLowerCase().includes('anzeigen')) {
        b.click();
        return b.textContent.trim();
      }
    }
    return null;
  });
  if (clicked) { console.log(`  ✓ JS-Click: "${clicked}"`); return true; }

  console.warn('  ⚠ Kein Anzeigen-Button gefunden');
  return false;
}

// ── Warte auf Resultate und extrahiere ───────────────────────────────────────

async function waitAndExtract(page) {
  // Warte bis div[data-ri] erscheint (max 15s)
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-ri]').length > 0,
      { timeout: 15000, polling: 500 }
    );
    console.log('  ✓ div[data-ri] gefunden');
  } catch {
    // Noch kein Resultat — versuche Button klicken
    console.log('  → Noch keine Resultate, klicke Anzeigen…');
    await clickAnzeigen(page);
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('[data-ri]').length > 0,
        { timeout: 15000, polling: 500 }
      );
      console.log('  ✓ div[data-ri] nach Button-Click');
    } catch {
      // Letzte Chance: raw text parsing
      const divCount = await page.evaluate(() => document.querySelectorAll('[data-ri]').length);
      const body = await page.evaluate(() => document.body.innerText.substring(0, 500).replace(/\n/g,' '));
      console.warn(`  ✗ Keine Resultate. data-ri=${divCount} | body: ${body}`);
      return [];
    }
  }

  // Extrahiere Zeilen
  return await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('[data-ri]').forEach(row => {
      // Sammle alle Leaf-Text-Nodes
      const texts = [];
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (t) texts.push(t);
      }
      if (texts.length >= 4) rows.push({ ri: row.getAttribute('data-ri'), texts });
    });
    return rows;
  });
}

// ── Mappe Rohdaten auf strukturierte Einträge ─────────────────────────────────

function mapRows(rawRows) {
  return rawRows.map(r => {
    const t = r.texts;
    // Layout: Nr, Resultat, Wind, Rang, Name, Verein, Nat, Geb.Dat, Wettkampf, Ort, Datum
    // Manchmal fehlt Wind wenn kein Windwert
    const nr = parseInt(t[0]);
    if (isNaN(nr)) return null;

    // Resultat: zweite Zelle — Zeit (7.xx / 12.xx / 24.xx) oder Weite (5.xx)
    const result = t[1] || '';
    // Wind: dritte Zelle wenn +/- Vorzeichen
    let wind = null, nameIdx = 4;
    if (t[2] && /^[+-]?\d+\.\d$/.test(t[2])) { wind = t[2]; }
    else { nameIdx = 3; } // kein Wind, Name rückt vor

    const name = t[nameIdx] || '';
    const club = t[nameIdx + 1] || '';
    const date = t.find(s => /^\d{2}\.\d{2}\.\d{4}$/.test(s)) || '';

    return { rank: nr, result, wind, name, club, date };
  }).filter(r => r && r.result && r.name);
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

    // Cookie-Banner
    try {
      for (const txt of ['Nein','Ablehnen','Akzeptieren','Ja']) {
        const btn = page.locator(`button:has-text("${txt}")`).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click(); await wait(600);
          console.log(`  Cookie "${txt}" geklickt`); break;
        }
      }
    } catch(_) {}

    const comps   = await discoverComponents(page);
    const seasonId = findCompId(comps, season);
    const catId    = findCompId(comps, CATEGORY_LABEL) || findCompId(comps, 'U18', true);
    const typeId   = findCompId(comps, 'Ein Resultat pro Athlet');
    const topsId   = findCompId(comps, '30');

    if (!seasonId || !catId)
      return { discipline: key, year, error: 'selects_not_found', top15: [], fiona: null };

    if (!await pfSelect(page, seasonId, season))
      return { discipline: key, year, error: 'season', top15: [], fiona: null };

    if (!await pfSelect(page, catId, CATEGORY_LABEL) && !await pfSelect(page, catId, 'U18', true))
      return { discipline: key, year, error: 'category', top15: [], fiona: null };

    // Re-discover nach Kategorie-AJAX
    await wait(500);
    const comps2  = await discoverComponents(page);
    const yearId2 = findCompId(comps2, year) || findCompId(comps, year);
    const discId2 = findCompId(comps2, label) || findCompId(comps2, label, true)
                  || findCompId(comps, label)  || findCompId(comps, label, true);

    if (!yearId2) return { discipline: key, year, error: 'year_not_found', top15: [], fiona: null };
    if (!discId2) return { discipline: key, year, error: 'disc_not_found', top15: [], fiona: null };

    if (!await pfSelect(page, yearId2, year))
      return { discipline: key, year, error: 'year', top15: [], fiona: null };

    if (!await pfSelect(page, discId2, label) && !await pfSelect(page, discId2, label, true))
      return { discipline: key, year, error: 'discipline', top15: [], fiona: null };

    if (typeId) await pfSelect(page, typeId, 'Ein Resultat pro Athlet');
    if (topsId) await pfSelect(page, topsId, '30');

    // Warte auf Resultate + extrahiere
    const rawRows = await waitAndExtract(page);
    console.log(`  → ${rawRows.length} Zeilen | Roh[0]: ${JSON.stringify(rawRows[0]?.texts?.slice(0,6))}`);

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
