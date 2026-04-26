#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v18 — Playwright + JSF AJAX fix
 * Nach jeder Dropdown-Auswahl wird change-Event gefeuert → AJAX wird ausgelöst
 * Dann auf networkidle warten → neue Optionen laden
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';
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

const wait = ms => new Promise(r => setTimeout(r, ms));

// ── Wählt eine Option und feuert JSF AJAX-Event ───────────────

async function selectAndTrigger(page, selectId, value) {
  const escaped = selectId.replace(/:/g, '\\:');
  const loc = page.locator(`#${escaped}`);
  await loc.waitFor({ timeout: 10000 });
  await loc.selectOption({ value });
  await loc.dispatchEvent('change');
  // Auf JSF AJAX-Response warten
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch(_) {}
  await wait(800);
}

// ── Findet den Value einer Option anhand des Labels ───────────

async function findOptionValue(page, selectId, labelMatch, partial = false) {
  const escaped = selectId.replace(/:/g, '\\:');
  const options = await page.locator(`#${escaped} option`).all();
  for (const opt of options) {
    const text = (await opt.textContent()).trim();
    const match = partial
      ? text.toLowerCase().includes(labelMatch.toLowerCase())
      : text === labelMatch;
    if (match) return await opt.getAttribute('value');
  }
  return null;
}

// ── Scrape eine Disziplin ─────────────────────────────────────

async function scrapeDiscipline(page, disc) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await wait(1000);

  const yearSel = 'form_anonym:bestlistYear_input';
  const seasonSel = 'form_anonym:bestlistSeason_input';
  const catSel = 'form_anonym:bestlistCategory_input';
  const discSel = 'form_anonym:bestlistDiscipline_input';

  // 1. Jahr
  const yearVal = await findOptionValue(page, yearSel, disc.year);
  if (!yearVal) throw new Error(`Jahr ${disc.year} nicht gefunden`);
  await selectAndTrigger(page, yearSel, yearVal);

  // 2. Saison
  const isIndoor = disc.season === 'Indoor';
  let seasonVal = null;
  const seasonOpts = await page.locator(`#${seasonSel.replace(/:/g, '\\:')} option`).all();
  for (const opt of seasonOpts) {
    const t = (await opt.textContent()).trim().toLowerCase();
    if (isIndoor && t === 'indoor') { seasonVal = await opt.getAttribute('value'); break; }
    if (!isIndoor && t === 'outdoor') { seasonVal = await opt.getAttribute('value'); break; }
  }
  // Fallback: erste nicht-leere Option
  if (!seasonVal) {
    for (const opt of seasonOpts) {
      const v = await opt.getAttribute('value');
      if (v && v !== '') { seasonVal = v; break; }
    }
  }
  if (!seasonVal) throw new Error(`Saison ${disc.season} nicht gefunden`);
  await selectAndTrigger(page, seasonSel, seasonVal);

  // 3. Kategorie U18 Frauen
  let catVal = null;
  const catOpts = await page.locator(`#${catSel.replace(/:/g, '\\:')} option`).all();
  const catTexts = [];
  for (const opt of catOpts) {
    const t = (await opt.textContent()).trim();
    catTexts.push(t);
    if (t === 'U18 Frauen') { catVal = await opt.getAttribute('value'); break; }
  }
  console.log(`   Kat-Optionen (${catTexts.length}): ${catTexts.slice(0,5).join(' | ')}...`);
  if (!catVal) throw new Error(`U18 Frauen nicht gefunden. Optionen: ${catTexts.join(', ')}`);
  await selectAndTrigger(page, catSel, catVal);

  // 4. Disziplin — nach AJAX neu laden
  let discVal = null;
  const discOpts = await page.locator(`#${discSel.replace(/:/g, '\\:')} option`).all();
  const discTexts = [];
  for (const opt of discOpts) {
    const t = (await opt.textContent()).trim();
    discTexts.push(t);
    if (t === disc.label || t.startsWith(disc.label)) {
      discVal = await opt.getAttribute('value');
      break;
    }
  }
  console.log(`   Disc-Optionen: ${discTexts.slice(0,8).join(' | ')}`);
  if (!discVal) throw new Error(`Disziplin "${disc.label}" nicht gefunden`);
  await selectAndTrigger(page, discSel, discVal);

  // 5. Anzeigen klicken
  const btn = page.locator('button, input[type=submit]').filter({ hasText: /[Aa]nzeig/ });
  if (await btn.count() > 0) {
    await btn.first().click();
  } else {
    // JSF submit fallback
    await page.evaluate(() => {
      const form = document.querySelector('form');
      if (form) form.submit();
    });
  }
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch(_) {}
  await wait(2000);

  const html = await page.content();
  const isJump = disc.key.startsWith('Long Jump');
  const rows = parseTable(html, isJump);
  console.log(`   ${rows.length} Einträge geparst`);
  return rows;
}

// ── Tabellen-Parser ───────────────────────────────────────────

function parseTable(html, isJump) {
  const rows = [];

  // Suche nach Resultat-Tabelle (alabus hat data-scrollable oder ähnliche Klassen)
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowM;

  while ((rowM = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cellRe.exec(rowM[1])) !== null) {
      const text = cm[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#[0-9]+;/g, '')
        .trim();
      if (text) cells.push(text);
    }
    if (cells.length < 3) continue;

    // Rang: erste Zelle muss eine Zahl sein
    const rank = parseInt(cells[0]);
    if (isNaN(rank) || rank < 1 || rank > 2000) continue;

    // Resultat suchen
    let result = '', name = '', wind = '', date = '', club = '';
    for (const c of cells.slice(1)) {
      if (!result) {
        if (isJump && /^\d+\.\d{2}$/.test(c)) { result = c; continue; }
        if (!isJump && /^\d{1,2}[:.]\d{2}(\.\d+)?$/.test(c)) { result = c; continue; }
      }
      if (result && !wind && /^[+-]?\d+\.\d$/.test(c)) { wind = c; continue; }
      if (!name && /^[A-ZÄÖÜ][a-zäöüéàèê]+([ \-][A-ZÄÖÜ][a-zäöüéàèê]+)+$/.test(c)) { name = c; continue; }
      if (!date && /^\d{2}\.\d{2}\.\d{4}$/.test(c)) { date = c; continue; }
      if (name && result && !club && c.length > 2 && !/^\d/.test(c) && !/^\d{2}\.\d{2}/.test(c)) club = c;
    }

    if (!result || !name) continue;
    rows.push({ rank, name, result, wind, club, date, isFiona: name.includes('Matt') });
  }

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
  console.log(res.ok ? '✅ KV Upload OK' : `❌ KV Fehler ${res.status}`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Swiss Athletics Bestenliste Scraper v18 (Playwright + JSF AJAX fix)\n');

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

  for (const disc of DISCIPLINES) {
    console.log(`📋 ${disc.key} (${disc.season} ${disc.year})`);
    try {
      const rows   = await scrapeDiscipline(page, disc);
      const isJump = disc.key.startsWith('Long Jump');
      const fiona  = rows.find(r => r.isFiona);
      const top1   = rows[0];

      result.disciplines[disc.key] = {
        discipline: disc.key,
        year: disc.year,
        scraped: new Date().toISOString(),
        fiona: fiona ? {
          rank: fiona.rank,
          result: fiona.result,
          wind: fiona.wind || null,
          date: fiona.date,
          gapToFirst: top1 && top1.name !== fiona.name ? calcGap(fiona.result, top1.result, isJump) : null,
        } : null,
        top15: rows.slice(0, 15),
        total: rows.length,
      };

      if (fiona) console.log(`   ✅ Fiona: Rang ${fiona.rank} · ${fiona.result}`);
      else if (rows.length > 0) console.log(`   ⚠️  Fiona nicht in Top ${rows.length}`);
      else console.log(`   ❌ 0 Einträge — Parser-Problem`);
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
