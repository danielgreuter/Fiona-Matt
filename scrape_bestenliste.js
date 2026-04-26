#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v19
 * - Playwright-basierter Table-Parser (kein Regex mehr)
 * - Debug HTML + Screenshot als Artifact
 * - Robustere Button-Erkennung
 * - Explizites Warten auf Ergebnis-Zeilen
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';
const UPLOAD = process.argv.includes('--upload');

const BASE_URL = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de';

const DISCIPLINES = [
  { key:'100m',           year:'2026', season:'Outdoor', label:'100 m',      isJump:false },
  { key:'100m_2025',      year:'2025', season:'Outdoor', label:'100 m',      isJump:false },
  { key:'60m',            year:'2026', season:'Indoor',  label:'60 m',       isJump:false },
  { key:'60m_2025',       year:'2025', season:'Indoor',  label:'60 m',       isJump:false },
  { key:'200m',           year:'2026', season:'Outdoor', label:'200 m',      isJump:false },
  { key:'200m_2025',      year:'2025', season:'Outdoor', label:'200 m',      isJump:false },
  { key:'Long Jump',      year:'2026', season:'Outdoor', label:'Weit',       isJump:true  },
  { key:'Long Jump_2025', year:'2025', season:'Outdoor', label:'Weit',       isJump:true  },
];

const wait = ms => new Promise(r => setTimeout(r, ms));

// ── Dropdown auswählen + JSF AJAX triggern ────────────────────

async function selectAndTrigger(page, selectId, value) {
  const escaped = selectId.replace(/:/g, '\\:');
  const loc = page.locator(`#${escaped}`);
  await loc.waitFor({ timeout: 10000 });
  await loc.selectOption({ value });
  await loc.dispatchEvent('change');
  try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch(_) {}
  await wait(800);
}

// ── Option-Value anhand Label finden ─────────────────────────

async function findOptionValue(page, selectId, labelMatch) {
  const escaped = selectId.replace(/:/g, '\\:');
  const options = await page.locator(`#${escaped} option`).all();
  for (const opt of options) {
    const text = (await opt.textContent()).trim();
    // Exakt oder startsWith
    if (text === labelMatch || text.startsWith(labelMatch)) {
      return await opt.getAttribute('value');
    }
  }
  return null;
}

async function getAllOptionTexts(page, selectId, limit = 8) {
  const escaped = selectId.replace(/:/g, '\\:');
  const options = await page.locator(`#${escaped} option`).all();
  const texts = [];
  for (const opt of options) texts.push((await opt.textContent()).trim());
  return texts.slice(0, limit);
}

// ── Tabelle via Playwright-Locator parsen ─────────────────────

async function parseTableViaLocator(page, isJump) {
  const rows = [];

  // Warte auf mindestens eine Ergebnis-Zeile (tbody tr mit td)
  try {
    await page.waitForSelector('table tbody tr td', { timeout: 12000 });
  } catch(e) {
    console.log(`   ⚠️  Timeout: keine Tabellen-Zeilen gefunden (${e.message})`);
    return [];
  }

  const tableRows = await page.locator('table tbody tr').all();
  console.log(`   Rohe TR-Zeilen: ${tableRows.length}`);

  for (const row of tableRows) {
    const cells = await row.locator('td').allTextContents();
    const cleaned = cells.map(c => c.replace(/\s+/g, ' ').trim()).filter(Boolean);

    if (cleaned.length < 3) continue;

    // Erster Wert muss eine Zahl (Rang) sein
    const rank = parseInt(cleaned[0]);
    if (isNaN(rank) || rank < 1 || rank > 2000) continue;

    // Resultat, Name, Datum, Verein aus den restlichen Zellen extrahieren
    let result = '', name = '', wind = '', date = '', club = '';

    for (const c of cleaned.slice(1)) {
      if (!result) {
        // Sprung: z.B. "5.87" oder "5,87"
        if (isJump && /^\d+[.,]\d{2}$/.test(c)) { result = c.replace(',', '.'); continue; }
        // Sprint: z.B. "12.34" oder "1:23.45"
        if (!isJump && /^\d{1,2}[:.]\d{2}(\.\d+)?$/.test(c)) { result = c; continue; }
      }
      if (result && !wind && /^[+-]?\d+[.,]\d$/.test(c)) { wind = c; continue; }
      if (!name && /^[A-ZÄÖÜ][a-zäöüéàèêâ]+([ \-][A-ZÄÖÜ][a-zäöüéàèêâ]+)+$/.test(c)) { name = c; continue; }
      if (!date && /^\d{2}\.\d{2}\.\d{4}$/.test(c)) { date = c; continue; }
      if (name && result && !club && c.length > 2 && !/^\d/.test(c) && !/^\d{2}\.\d{2}/.test(c)) {
        club = c;
      }
    }

    if (!result || !name) continue;

    rows.push({
      rank,
      name,
      result,
      wind: wind || null,
      club: club || null,
      date: date || null,
      isFiona: name.toLowerCase().includes('matt'),
    });
  }

  return rows;
}

// ── Eine Disziplin scrapen ────────────────────────────────────

async function scrapeDiscipline(page, disc, debugIndex) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await wait(1000);

  const yearSel   = 'form_anonym:bestlistYear_input';
  const seasonSel = 'form_anonym:bestlistSeason_input';
  const catSel    = 'form_anonym:bestlistCategory_input';
  const discSel   = 'form_anonym:bestlistDiscipline_input';

  // 1. Jahr
  const yearVal = await findOptionValue(page, yearSel, disc.year);
  if (!yearVal) throw new Error(`Jahr ${disc.year} nicht gefunden`);
  await selectAndTrigger(page, yearSel, yearVal);

  // 2. Saison
  const isIndoor = disc.season === 'Indoor';
  const seasonOpts = await page.locator(`#${seasonSel.replace(/:/g, '\\:')} option`).all();
  let seasonVal = null;
  for (const opt of seasonOpts) {
    const t = (await opt.textContent()).trim().toLowerCase();
    const v = await opt.getAttribute('value');
    if (!v || v === '') continue;
    if (isIndoor && t === 'indoor')   { seasonVal = v; break; }
    if (!isIndoor && t === 'outdoor') { seasonVal = v; break; }
  }
  if (!seasonVal) {
    // Fallback: erste nicht-leere Option
    for (const opt of seasonOpts) {
      const v = await opt.getAttribute('value');
      if (v && v !== '') { seasonVal = v; break; }
    }
  }
  if (!seasonVal) throw new Error(`Saison ${disc.season} nicht gefunden`);
  await selectAndTrigger(page, seasonSel, seasonVal);

  // 3. Kategorie U18 Frauen
  const catTexts = await getAllOptionTexts(page, catSel, 20);
  console.log(`   Kat-Optionen (${catTexts.length}): ${catTexts.slice(0,5).join(' | ')}...`);
  let catVal = null;
  const catOpts = await page.locator(`#${catSel.replace(/:/g, '\\:')} option`).all();
  for (const opt of catOpts) {
    const t = (await opt.textContent()).trim();
    if (t === 'U18 Frauen') { catVal = await opt.getAttribute('value'); break; }
  }
  if (!catVal) throw new Error(`U18 Frauen nicht gefunden. Optionen: ${catTexts.join(', ')}`);
  await selectAndTrigger(page, catSel, catVal);

  // 4. Disziplin (alle Optionen anzeigen für Diagnose)
  const discTexts = await getAllOptionTexts(page, discSel, 20);
  console.log(`   Disc-Optionen (${discTexts.length}): ${discTexts.join(' | ')}`);
  let discVal = null;
  const discOpts = await page.locator(`#${discSel.replace(/:/g, '\\:')} option`).all();
  for (const opt of discOpts) {
    const t = (await opt.textContent()).trim();
    if (t === disc.label || t.startsWith(disc.label)) {
      discVal = await opt.getAttribute('value');
      break;
    }
  }
  if (!discVal) throw new Error(`Disziplin "${disc.label}" nicht gefunden. Verfügbar: ${discTexts.join(', ')}`);
  await selectAndTrigger(page, discSel, discVal);

  // 5. Anzeigen-Button klicken — mehrere Selektoren versuchen
  const btnSelectors = [
    'button:has-text("Anzeigen")',
    'button:has-text("Laden")',
    'button:has-text("Suchen")',
    'input[type="submit"]:has-text("Anzeigen")',
    'input[type="submit"]',
    '.ui-button:has-text("Anzeigen")',
    '.ui-button:has-text("Laden")',
  ];

  let btnClicked = false;
  for (const sel of btnSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      console.log(`   Button gefunden: "${sel}"`);
      await btn.click();
      btnClicked = true;
      break;
    }
  }

  if (!btnClicked) {
    // Alle Buttons anzeigen für Diagnose
    const allBtns = await page.locator('button, input[type="submit"]').all();
    const btnTexts = [];
    for (const b of allBtns) btnTexts.push((await b.textContent()).trim().substring(0, 30));
    console.log(`   ⚠️  Kein Anzeigen-Button. Alle Buttons: ${btnTexts.join(' | ')}`);
    // Trotzdem via JSF Action versuchen
    await page.evaluate(() => {
      // PrimeFaces submit
      if (window.PrimeFaces) {
        const form = document.querySelector('form');
        if (form) PrimeFaces.ajax.Request.handle({ source: form });
      }
      // Fallback
      const form = document.querySelector('form');
      if (form) {
        const e = new Event('submit', { bubbles: true, cancelable: true });
        form.dispatchEvent(e);
      }
    });
  }

  try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch(_) {}
  await wait(2000);

  // Debug: Screenshot + HTML für erstes Mal
  if (debugIndex === 0) {
    await page.screenshot({ path: `debug_result.png`, fullPage: true });
    fs.writeFileSync('debug_result.html', await page.content());
    console.log(`   📸 debug_result.png + debug_result.html gespeichert`);
  }

  const rows = await parseTableViaLocator(page, disc.isJump);
  return rows;
}

// ── Gap-Berechnung ────────────────────────────────────────────

function toSec(t) {
  if (!t) return null;
  const p = t.split(':');
  return p.length === 2 ? parseFloat(p[0]) * 60 + parseFloat(p[1]) : parseFloat(t) || null;
}

function calcGap(a, b, isJump) {
  const as = toSec(a), bs = toSec(b);
  if (as == null || bs == null) return null;
  const d = isJump ? (as - bs) : (as - bs);
  return (d >= 0 ? '+' : '') + Math.abs(d).toFixed(2);
}

// ── KV Upload ─────────────────────────────────────────────────

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/bestenliste:fiona`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '✅ KV Upload OK' : `❌ KV Fehler ${res.status}: ${await res.text()}`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Swiss Athletics Bestenliste Scraper v19 (Playwright-Parser + Debug)\n');

  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0',
    locale: 'de-CH',
  });
  const page = await context.newPage();

  const result = { updated: new Date().toISOString().split('T')[0], disciplines: {} };

  for (let i = 0; i < DISCIPLINES.length; i++) {
    const disc = DISCIPLINES[i];
    console.log(`📋 ${disc.key} (${disc.season} ${disc.year})`);
    try {
      const rows  = await scrapeDiscipline(page, disc, i);
      const fiona = rows.find(r => r.isFiona);
      const top1  = rows[0];

      result.disciplines[disc.key] = {
        discipline: disc.key,
        year: disc.year,
        scraped: new Date().toISOString(),
        fiona: fiona ? {
          rank: fiona.rank,
          result: fiona.result,
          wind: fiona.wind || null,
          date: fiona.date,
          gapToFirst: top1 && top1.name !== fiona.name
            ? calcGap(fiona.result, top1.result, disc.isJump) : null,
        } : null,
        top15: rows.slice(0, 15),
        total: rows.length,
      };

      if (fiona)           console.log(`   ✅ Fiona: Rang ${fiona.rank} · ${fiona.result}`);
      else if (rows.length > 0) console.log(`   ⚠️  Fiona nicht in Top ${rows.length}`);
      else                 console.log(`   ❌ 0 Einträge — Parser-Problem`);
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
