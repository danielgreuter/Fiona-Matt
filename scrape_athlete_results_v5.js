#!/usr/bin/env node
// scrape_athlete_results_v5.js — vollständige Historie inkl. Indoor + 80m
// Usage: node scrape_athlete_results_v5.js [--upload]

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const UPLOAD = process.argv.includes('--upload');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';

const SEARCH_URL = 'https://www.swiss-athletics.ch/wettkaempfe/resultate/bestenliste/bestenliste-pro-athlet/in-athletensuche/';

// Disciplines + seasons to scrape
const SCRAPE_COMBOS = [
  { disc: '60 m',   season: 'false', label: '60m Outdoor' },
  { disc: '60 m',   season: 'true',  label: '60m Indoor'  },
  { disc: '80 m',   season: 'false', label: '80m'         },
  { disc: '100 m',  season: 'false', label: '100m'        },
  { disc: '200 m',  season: 'false', label: '200m'        },
  { disc: 'Weit',   season: 'false', label: 'Weitsprung'  },
  { disc: 'Weit',   season: 'true',  label: 'Weitsprung Indoor' },
];

const DISC_MAP = {
  '60 m':  '60m',
  '80 m':  '80m',
  '100 m': '100m',
  '200 m': '200m',
  'Weit':  'Long Jump',
};

const F = {
  year:       'form_anonym:bestlistYear_input',
  season:     'form_anonym:bestlistSeason_input',
  category:   'form_anonym:bestlistCategory_input',
  discipline: 'form_anonym:bestlistDiscipline_input',
  type:       'form_anonym:bestlistType_input',
  tops:       'form_anonym:bestlistTops_input',
  btn:        'form_anonym:loadDataBtn',
};

function esc(id) { return id.replace(/:/g,'\\:').replace(/\./g,'\\.'); }

async function jsfSelect(frame, fieldId, value) {
  await frame.evaluate((args) => {
    const el = document.getElementById(args.id);
    if (!el) return;
    el.value = args.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) jQuery(el).trigger('change');
  }, { id: fieldId, value });
  await frame.waitForTimeout(1500);
}

function extractByPrefix(cells, prefix) {
  for (const c of cells) {
    if (c.startsWith(prefix)) return c.substring(prefix.length).trim();
  }
  return '';
}

function parseRow(cells, combo) {
  const result  = extractByPrefix(cells, 'Resultat');
  const wind    = extractByPrefix(cells, 'Wind');
  const venue   = extractByPrefix(cells, 'Ort');
  const comp    = extractByPrefix(cells, 'Wettkampf');
  const dateStr = extractByPrefix(cells, 'Datum');
  const place   = extractByPrefix(cells, 'Rang');

  const resMatch = result.match(/^[\d:.]+/);
  const resClean = resMatch ? resMatch[0] : result;
  if (!resClean || !dateStr) return null;

  const dateParts = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  const dateISO = dateParts ? `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}` : '';
  const year = dateParts ? parseInt(dateParts[3]) : 0;

  const windNum = parseFloat(wind);
  const isWindAssisted = !isNaN(windNum) && windNum > 2.0;
  const indoor = combo.season === 'true';
  const numResult = parseFloat(resClean.replace(',', '.').replace(':', '.')) || 0;

  return {
    discipline: DISC_MAP[combo.disc] || combo.disc,
    disciplineLabel: combo.label,
    result: resClean,
    numResult,
    wind: wind.match(/^[+-]?\d+\.?\d*$/) ? wind : '',
    windAssisted: isWindAssisted,
    indoor,
    venue,
    competition: comp,
    date: dateStr,
    dateISO,
    year,
    place: (() => {
      const v = place.trim();
      const m = v.match(/^(\d+)([fFhHrR]?)(\d*)$/);
      if (!m) return v || '';
      const pos = m[1], typ = m[2].toLowerCase(), num = m[3];
      const typMap = {f:'Final', h:'Lauf', r:'Runde'};
      const typStr = typMap[typ] || '';
      if (typStr && num) return pos + '. ' + typStr + ' ' + num;
      if (typStr) return pos + '. ' + typStr;
      return pos + '.';
    })(),
    source: 'swiss-athletics',
  };
}

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/results:fiona:sa`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '   ✅ KV OK' : `   ❌ KV Fehler ${res.status}`);
}

async function main() {
  console.log('🚀 Swiss Athletics Athleten-Resultate Scraper v5');

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ locale: 'de-CH', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Search for Fiona
  await page.goto(SEARCH_URL, { waitUntil: 'networkidle', timeout: 30000 });
  try {
    const btn = page.locator('button:has-text("Ja")').first();
    if (await btn.isVisible({ timeout: 3000 })) { await btn.click(); await page.waitForTimeout(1000); }
  } catch(e) {}

  const searchFrame = page.frames().find(f => f.url().includes('bestlistathletesearch'));
  await searchFrame.fill(`#${esc('form_anonym:bestlistAthleteSearchBeanLastName')}`, 'Matt');
  await searchFrame.fill(`#${esc('form_anonym:bestlistAthleteSearchBeanFirstName')}`, 'Fiona');
  await searchFrame.locator('input[type="submit"], button[type="submit"]').first().click();
  await page.waitForTimeout(3000);

  const searchFrame2 = page.frames().find(f => f.url().includes('alabus'));
  const fionaURL = await searchFrame2.evaluate(() => {
    for (const link of document.querySelectorAll('table tbody tr a')) {
      const onclick = link.getAttribute('onclick') || '';
      const match = onclick.match(/openURLForBestlist\('([^']+)'\)/);
      if (match && link.textContent.trim() === 'Fiona Matt') return match[1];
    }
    return null;
  });
  if (!fionaURL) throw new Error('Fiona URL nicht gefunden');
  console.log('   ✅ Fiona gefunden');

  await page.goto(fionaURL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const getFrame = () => page.frames().find(f =>
    f.url().includes('bestlistathlete') && !f.url().includes('search')
  );

  const allResults = [];

  for (const combo of SCRAPE_COMBOS) {
    console.log(`📋 ${combo.label}...`);

    let frame = getFrame();
    await jsfSelect(frame, F.year, 'ALL');
    await jsfSelect(frame, F.season, combo.season);
    await jsfSelect(frame, F.category, 'W');

    // Wait for disciplines
    await frame.waitForFunction(id => {
      const el = document.getElementById(id);
      return el && el.options.length > 1;
    }, F.discipline, { timeout: 10000 }).catch(() => {});

    // Find matching discipline
    const discValue = await frame.evaluate((args) => {
      const el = document.getElementById(args.id);
      if (!el) return null;
      const opt = Array.from(el.options).find(o => o.text.trim() === args.discText);
      return opt ? opt.value : null;
    }, { id: F.discipline, discText: combo.disc });

    if (!discValue) {
      console.log(`   ⚠️  Disziplin "${combo.disc}" nicht gefunden`);
      continue;
    }

    frame = getFrame();
    await jsfSelect(frame, F.discipline, discValue);
    await jsfSelect(frame, F.type, '0');
    await jsfSelect(frame, F.tops, '100');

    frame = getFrame();
    await frame.locator(`#${esc(F.btn)}`).click({ force: true });

    let rows = 0;
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(1500);
      frame = getFrame();
      rows = await frame.locator('table tbody tr').count().catch(() => 0);
      if (rows > 1) break;
    }

    if (rows <= 1) { console.log('   ⚠️  Keine Resultate'); continue; }

    const rawRows = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('table tbody tr'))
        .map(row => Array.from(row.querySelectorAll('td')).map(c => c.textContent.trim()))
        .filter(cells => cells.length >= 4)
    );

    const parsed = rawRows.map(cells => parseRow(cells, combo)).filter(Boolean);
    allResults.push(...parsed);
    console.log(`   ✅ ${parsed.length} Resultate`);
  }

  // Deduplicate (same date + result + discipline)
  const seen = new Set();
  const unique = allResults.filter(r => {
    const key = `${r.discipline}|${r.date}|${r.result}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by dateISO descending
  unique.sort((a, b) => b.dateISO.localeCompare(a.dateISO));

  // Calculate PBs (wind-legal only, per discipline)
  const pbByDisc = {};
  unique.forEach(r => {
    if (r.windAssisted) return;
    const existing = pbByDisc[r.discipline];
    const isJump = r.discipline === 'Long Jump';
    const isBetter = !existing ||
      (isJump ? r.numResult > existing.numResult : r.numResult < existing.numResult);
    if (isBetter) pbByDisc[r.discipline] = r;
  });

  console.log('\n   PBs (wind-legal):');
  Object.entries(pbByDisc).forEach(([disc, r]) =>
    console.log(`   ${disc}: ${r.result} (${r.date}, ${r.competition})`)
  );

  const output = {
    athlete: 'Fiona Matt',
    scraped: new Date().toISOString(),
    source: 'swiss-athletics',
    count: unique.length,
    pbs: pbByDisc,
    results: unique,
  };

  const outFile = path.join(__dirname, 'athlete_results.json');
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\n💾 Gespeichert: ${outFile} (${unique.length} Einträge)`);

  if (UPLOAD && CF_ACCOUNT_ID) {
    await uploadKV(output);
  }

  await browser.close();
  console.log('✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
