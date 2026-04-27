#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v31
 * Strategie: Direkte URL-Navigation zum alabus iFrame
 * Format: https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?
 *         lang=de&blyear=YYYY&blcat=CAT_ID&disci=DISC_ID&top=30&blseason=SEASON
 *
 * IDs werden einmalig von der Seite geladen, dann direkt URLs konstruiert.
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';
const UPLOAD = process.argv.includes('--upload');

const ALABUS_BASE = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml';
const FORM_URL    = `${ALABUS_BASE}?lang=de`;

const FIONA = 'Fiona Matt';
const TOP_N = 15;

const wait = ms => new Promise(r => setTimeout(r, ms));

// ── IDs einmalig von der Seite laden ─────────────────────────────────────────

async function loadIds(page) {
  await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await wait(2000);

  // Cookie-Banner
  for (const txt of ['Nein','Ablehnen','Ja','Akzeptieren']) {
    try {
      const btn = page.locator(`button:has-text("${txt}")`).first();
      await btn.waitFor({ state:'visible', timeout:3000 });
      await btn.click();
      await wait(500);
      break;
    } catch(_) {}
  }

  // Kategorie wählen um Disziplin-Optionen zu laden
  // Erst Saison auf Outdoor setzen
  const ids = await page.evaluate(() => {
    const getOptions = id => {
      const sel = document.getElementById(id);
      if (!sel) return {};
      const out = {};
      Array.from(sel.options).forEach(o => { if (o.value) out[o.text.trim()] = o.value; });
      return out;
    };
    return {
      seasons: getOptions('form_anonym:bestlistSeason_input'),
      years:   getOptions('form_anonym:bestlistYear_input'),
      cats:    getOptions('form_anonym:bestlistCategory_input'),
      types:   getOptions('form_anonym:bestlistType_input'),
      tops:    getOptions('form_anonym:bestlistTops_input'),
    };
  });

  console.log('Seasons:', JSON.stringify(ids.seasons));
  console.log('Cats:', Object.keys(ids.cats).join(', '));

  return ids;
}

async function loadDiscIds(page, seasonValue, catValue) {
  // Saison setzen via PF-Click
  await pfSelectById(page, 'form_anonym:bestlistSeason', seasonValue);
  // Kategorie setzen
  await pfSelectById(page, 'form_anonym:bestlistCategory', catValue);
  await wait(1500);

  const discIds = await page.evaluate(() => {
    const sel = document.getElementById('form_anonym:bestlistDiscipline_input');
    if (!sel) return {};
    const out = {};
    Array.from(sel.options).forEach(o => { if (o.value) out[o.text.trim()] = o.value; });
    return out;
  });
  console.log('Disciplines:', Object.keys(discIds).join(', '));
  return discIds;
}

async function pfSelectById(page, compId, value) {
  const esc = s => s.replace(/:/g, '\\:');
  const wrapper = page.locator(`#${esc(compId)}`);
  try { await wrapper.waitFor({ state:'visible', timeout:8000 }); }
  catch { return false; }
  await wrapper.click();

  let panel = null;
  for (const suffix of ['_items','_panel']) {
    const p = page.locator(`#${esc(compId)}${suffix}`);
    try { await p.waitFor({ state:'visible', timeout:3000 }); panel = p; break; }
    catch(_) {}
  }
  if (!panel) { await page.keyboard.press('Escape'); return false; }

  const items = await panel.locator('li').all();
  for (const item of items) {
    const val = await item.getAttribute('data-label') || await item.textContent();
    // Find by value in backing select
    const selected = await page.evaluate((cid, v) => {
      const sel = document.getElementById(cid + '_input');
      if (!sel) return false;
      const opt = Array.from(sel.options).find(o => o.value === v);
      return opt ? opt.text.trim() : null;
    }, compId, value);

    if (!selected) {
      // Try clicking by matching value directly
      const text = (await item.textContent() || '').trim();
      const matchVal = await page.evaluate((cid, t) => {
        const sel = document.getElementById(cid + '_input');
        if (!sel) return null;
        const opt = Array.from(sel.options).find(o => o.text.trim() === t);
        return opt ? opt.value : null;
      }, compId, text);
      if (matchVal === value) {
        await item.click();
        try { await page.waitForLoadState('networkidle', { timeout:6000 }); } catch { await wait(1500); }
        return true;
      }
    }
  }

  // Fallback: JS direkt
  await page.keyboard.press('Escape');
  const ok = await page.evaluate((cid, v) => {
    const sel = document.getElementById(cid + '_input');
    if (!sel) return false;
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles:true }));
    return true;
  }, compId, value);
  await wait(1500);
  return ok;
}

// ── Direkte iFrame-URL bauen und navigieren ───────────────────────────────────

function buildUrl(year, catId, discId, seasonValue, type='1', tops='30') {
  // seasonValue: 'false' = Outdoor, 'true' = Indoor
  const params = new URLSearchParams({
    lang:     'de',
    mobile:   'false',
    blyear:   year,
    blcat:    catId,
    disci:    discId,
    top:      tops,
    blseason: seasonValue,
    bltop:    type,
  });
  return `${ALABUS_BASE}?${params.toString()}`;
}

// ── Resultate aus iFrame-Seite extrahieren ────────────────────────────────────

async function extractFromPage(page) {
  const html = await page.content();
  const rows = [];

  // data-ri rows
  const rowRe = /data-ri="(\d+)"[^>]*>([\s\S]*?)(?=data-ri="\d+"|<\/tbody>|$)/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cm;
    while ((cm = cellRe.exec(m[2])) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim());
    }
    if (cells.length >= 4 && /^\d+$/.test(cells[0])) rows.push(cells);
  }

  return rows;
}

function mapRows(rawRows) {
  return rawRows.map(cells => {
    const rank = parseInt(cells[0]);
    if (isNaN(rank)||rank<1||rank>500) return null;
    const result = (cells[1]||'').trim();
    let wind=null, nameIdx=4;
    if ((cells[2]||'').match(/^[+-]?\d+\.\d$/)) wind = cells[2];
    else nameIdx = 3;
    const name   = (cells[nameIdx]||'').trim();
    const club   = (cells[nameIdx+1]||'').trim();
    const date   = cells.find(c=>/^\d{2}\.\d{2}\.\d{4}$/.test((c||'').trim()))||'';
    return { rank, result, wind, name, club, date };
  }).filter(r=>r&&r.result&&r.name&&r.name.length>2);
}

// ── Upload KV ─────────────────────────────────────────────────────────────────

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

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  });

  // Seite für ID-Discovery
  const setupPage = await context.newPage();
  setupPage.setDefaultTimeout(20000);

  // IDs laden
  const ids = await loadIds(setupPage);
  const catId = ids.cats['U18 Frauen'];
  const seasonOutdoor = ids.seasons['Outdoor'] || 'false';
  const seasonIndoor  = ids.seasons['Indoor']  || 'true';
  const typeId = ids.types['Ein Resultat pro Athlet'] || '1';

  console.log(`\nU18 Frauen catId: ${catId}`);
  console.log(`Outdoor: ${seasonOutdoor}, Indoor: ${seasonIndoor}`);

  // Disc-IDs für Outdoor laden
  const discOutdoor = await loadDiscIds(setupPage, seasonOutdoor, catId);
  // Disc-IDs für Indoor laden (neue Seite)
  await setupPage.goto(FORM_URL, { waitUntil:'domcontentloaded', timeout:40000 });
  await wait(1500);
  const discIndoor = await loadDiscIds(setupPage, seasonIndoor, catId);
  await setupPage.close();

  console.log('\nOutdoor Discs:', JSON.stringify(discOutdoor));
  console.log('Indoor Discs:', JSON.stringify(discIndoor));

  const DISCIPLINES = [
    { key:'100m',           year:'2026', season:seasonOutdoor, label:'100 m', discIds:discOutdoor },
    { key:'100m_2025',      year:'2025', season:seasonOutdoor, label:'100 m', discIds:discOutdoor },
    { key:'60m',            year:'2026', season:seasonIndoor,  label:'60 m',  discIds:discIndoor  },
    { key:'60m_2025',       year:'2025', season:seasonIndoor,  label:'60 m',  discIds:discIndoor  },
    { key:'200m',           year:'2026', season:seasonOutdoor, label:'200 m', discIds:discOutdoor },
    { key:'200m_2025',      year:'2025', season:seasonOutdoor, label:'200 m', discIds:discOutdoor },
    { key:'Long Jump',      year:'2026', season:seasonOutdoor, label:'Weit',  discIds:discOutdoor },
    { key:'Long Jump_2025', year:'2025', season:seasonOutdoor, label:'Weit',  discIds:discOutdoor },
  ];

  const results = {};

  for (const disc of DISCIPLINES) {
    const { key, year, season, label, discIds } = disc;
    console.log(`\n📋 ${key}  (${season==='true'?'Indoor':'Outdoor'} ${year} — "${label}")`);

    const discId = discIds[label];
    if (!discId) {
      console.error(`  ✗ Disc-ID für "${label}" nicht gefunden`);
      results[key] = { discipline:key, year, error:'no_disc_id', top15:[], fiona:null };
      continue;
    }

    const url = buildUrl(year, catId, discId, season, typeId);
    console.log(`  URL: ${url.substring(0, 120)}…`);

    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    try {
      await page.goto(url, { waitUntil:'networkidle', timeout:30000 });
      await wait(1000);

      const html = await page.content();
      const hasDate = /\d{2}\.\d{2}\.\d{4}/.test(html);
      console.log(`  Datum: ${hasDate} | HTML: ${html.length}`);

      if (key === '100m') {
        await page.screenshot({ path:'screenshot_results.png', fullPage:true });
        fs.writeFileSync('page_results.html', html);
        console.log('  📸 Screenshot gespeichert');
      }

      const rawRows = extractFromPage !== undefined ? await (async () => {
        const r = [];
        const rowRe = /data-ri="(\d+)"[^>]*>([\s\S]*?)(?=data-ri="\d+"|<\/tbody>|$)/g;
        let m;
        while ((m = rowRe.exec(html)) !== null) {
          const cells = [];
          const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
          let cm;
          while ((cm = cellRe.exec(m[2])) !== null) {
            cells.push(cm[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim());
          }
          if (cells.length >= 4 && /^\d+$/.test(cells[0])) r.push(cells);
        }
        return r;
      })() : [];

      console.log(`  → ${rawRows.length} Zeilen | [0]: ${JSON.stringify(rawRows[0]?.slice(0,5))}`);

      const rows  = mapRows(rawRows);
      const top15 = rows.slice(0,TOP_N).map(r=>({
        rank:r.rank, name:r.name, result:r.result,
        wind:r.wind, club:r.club, date:r.date,
        isFiona:r.name.includes(FIONA),
      }));
      const fEntry = rows.find(r=>r.name.includes(FIONA));
      const fiona  = fEntry ? {
        rank:fEntry.rank, result:fEntry.result, wind:fEntry.wind, date:fEntry.date,
        gapToFirst: rows[0] ? `+${(parseFloat(fEntry.result)-parseFloat(rows[0].result)).toFixed(2)}` : null,
      } : null;

      if (fiona) console.log(`  ⭐ Fiona: Rang ${fiona.rank} — ${fiona.result}`);
      else if (rows[0]) console.log(`  1.: ${rows[0].name} ${rows[0].result}`);

      results[key] = { discipline:key, year, scraped:new Date().toISOString(), fiona, top15 };
    } finally {
      await page.close();
    }
  }

  await context.close();
  await browser.close();

  const output = { updated:new Date().toISOString(), disciplines:results };
  fs.writeFileSync('bestenliste.json', JSON.stringify(output,null,2));
  console.log('\n✅ bestenliste.json geschrieben');

  if (UPLOAD) {
    console.log('⬆ KV…');
    await uploadToKV('bestenliste', output);
    console.log('✅ fertig');
  }
})();
