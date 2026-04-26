#!/usr/bin/env node
/**
 * Debug-Script: Lädt 100m Outdoor 2026, macht Screenshot + HTML-Dump
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function pfSelect(page, inputId, labelText, partial = false) {
  const componentId = inputId.replace(/_input$/, '');
  const esc = s => s.replace(/:/g, '\\:');
  const wrapper = page.locator(`#${esc(componentId)}`);
  await wrapper.waitFor({ state: 'visible', timeout: 12000 });
  await wrapper.click();
  const panel = page.locator(`#${esc(componentId)}_panel`);
  try { await panel.waitFor({ state: 'visible', timeout: 8000 }); }
  catch { console.warn(`Panel ${componentId}_panel öffnete nicht`); return false; }

  const items = panel.locator('li');
  const allItems = await items.all();
  for (const item of allItems) {
    const text = ((await item.textContent()) || '').trim();
    const match = partial ? text.toLowerCase().includes(labelText.toLowerCase()) : text === labelText;
    if (match) {
      await item.click();
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch { await wait(2500); }
      console.log(`  ✓ "${labelText}" gewählt`);
      return true;
    }
  }
  const avail = await Promise.all(allItems.map(i => i.textContent()));
  console.warn(`  ⚠ "${labelText}" nicht gefunden. Verfügbar: ${avail.map(s=>(s||'').trim()).filter(Boolean).slice(0,10).join(' | ')}`);
  await page.keyboard.press('Escape');
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' });
  page.setDefaultTimeout(25000);

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await wait(3000);

  // Discover backing selects
  const comps = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('select').forEach(s => {
      out[s.id] = Array.from(s.options).map(o => o.text.trim());
    });
    return out;
  });
  console.log('Selects:', JSON.stringify(comps, null, 2));

  const findId = (needle, partial=false) => {
    for (const [id, opts] of Object.entries(comps))
      if (opts.some(o => partial ? o.toLowerCase().includes(needle.toLowerCase()) : o === needle)) return id;
    return null;
  };

  const seasonId = findId('Outdoor');
  const catId    = findId('U18 Frauen') || findId('U18', true);
  const yearId   = findId('2026');
  const discId   = findId('100 m') || findId('100', true);

  console.log(`\nGefundene IDs: Saison=${seasonId} Kat=${catId} Jahr=${yearId} Disc=${discId}`);

  await page.screenshot({ path: 'debug_before.png', fullPage: false });

  if (seasonId) await pfSelect(page, seasonId, 'Outdoor');
  if (catId)    await pfSelect(page, catId, 'U18 Frauen');

  // Re-discover
  const comps2 = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('select').forEach(s => { out[s.id] = Array.from(s.options).map(o => o.text.trim()); });
    return out;
  });
  const findId2 = (needle, partial=false) => {
    for (const [id, opts] of Object.entries(comps2))
      if (opts.some(o => partial ? o.toLowerCase().includes(needle.toLowerCase()) : o === needle)) return id;
    return null;
  };
  const yearId2 = findId2('2026') || yearId;
  const discId2 = findId2('100 m') || findId2('100', true) || discId;

  if (yearId2) await pfSelect(page, yearId2, '2026');
  if (discId2) await pfSelect(page, discId2, '100 m');

  await wait(3000);

  await page.screenshot({ path: 'debug_after.png', fullPage: true });

  // Dump table HTML
  const tableHtml = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    let out = `Total tables: ${tables.length}\n\n`;
    tables.forEach((t, i) => {
      out += `=== TABLE ${i} (class="${t.className}") ===\n`;
      out += t.outerHTML.substring(0, 2000) + '\n\n';
    });
    return out;
  });
  fs.writeFileSync('debug_tables.txt', tableHtml);
  console.log('\nGespeichert: debug_before.png, debug_after.png, debug_tables.txt');

  await browser.close();
})();
