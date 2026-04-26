#!/usr/bin/env node

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
  await panel.waitFor({ state: 'visible', timeout: 8000 });

  const items = panel.locator('li');
  const count = await items.count();

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const text = ((await item.textContent()) || '').trim();

    const match = partial
      ? text.toLowerCase().includes(labelText.toLowerCase())
      : text === labelText;

    if (match) {
      await item.click();
      await wait(2000);
      console.log(`✓ gewählt: ${labelText}`);
      return true;
    }
  }

  console.warn(`Nicht gefunden: ${labelText}`);
  await page.keyboard.press('Escape');
  return false;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  });

  page.setDefaultTimeout(30000);

  await page.goto(BASE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 50000
  });

  await wait(3000);

  await page.screenshot({
    path: 'debug_before.png',
    fullPage: true
  });

  const comps = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('select').forEach(s => {
      out[s.id] = Array.from(s.options).map(o => o.text.trim());
    });
    return out;
  });

  fs.writeFileSync('debug_selects.json', JSON.stringify(comps, null, 2));

  function findId(needle, partial = false) {
    for (const [id, opts] of Object.entries(comps)) {
      if (opts.some(o =>
        partial
          ? o.toLowerCase().includes(needle.toLowerCase())
          : o === needle
      )) {
        return id;
      }
    }
    return null;
  }

  const seasonId = findId('Outdoor');
  const catId = findId('U18 Frauen') || findId('U18', true);
  const yearId = findId('2026');
  const discId = findId('100 m') || findId('100', true);

  console.log('IDs:', { seasonId, catId, yearId, discId });

  if (seasonId) await pfSelect(page, seasonId, 'Outdoor');
  if (catId) await pfSelect(page, catId, 'U18 Frauen');
  if (yearId) await pfSelect(page, yearId, '2026');
  if (discId) await pfSelect(page, discId, '100 m');

  await wait(2000);

  try {
    await page.getByRole('button', { name: 'Anzeigen' }).click();
    console.log('✓ Anzeigen geklickt');
  } catch (e) {
    console.warn('Button nicht per Role gefunden, versuche Fallback...');
    await page.locator('button:has-text("Anzeigen"), input[value="Anzeigen"]').first().click();
  }

  await wait(7000);

  await page.screenshot({
    path: 'debug_after.png',
    fullPage: true
  });

  const tableHtml = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    let out = `Total tables: ${tables.length}\n\n`;

    tables.forEach((t, i) => {
      out += `=== TABLE ${i} ===\n`;
      out += t.outerHTML + '\n\n';
    });

    return out;
  });

  fs.writeFileSync('debug_tables.txt', tableHtml);

  const bodyText = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync('debug_body.txt', bodyText);

  const bodyHtml = await page.evaluate(() => document.body.innerHTML);
  fs.writeFileSync('debug_body.html', bodyHtml);

  console.log('Debug-Dateien erstellt:');
  console.log('- debug_before.png');
  console.log('- debug_after.png');
  console.log('- debug_tables.txt');
  console.log('- debug_body.txt');
  console.log('- debug_body.html');
  console.log('- debug_selects.json');

  await browser.close();
})();
