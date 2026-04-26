#!/usr/bin/env node
// Debug v3 — alles via console.log, keine Datei-Artefakte nötig
const { chromium } = require('playwright');
const wait = ms => new Promise(r => setTimeout(r, ms));
const BASE_URL = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  console.log('=== Lade Seite ===');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await wait(4000);

  // Cookie-Banner schliessen
  try {
    for (const txt of ['Nein','Ablehnen','Akzeptieren','Ja']) {
      const btn = page.locator(`button:has-text("${txt}")`).first();
      if (await btn.isVisible({ timeout: 1500 })) { await btn.click(); await wait(800); console.log(`Cookie "${txt}" geklickt`); break; }
    }
  } catch(_) {}

  // Alle select-Inhalte
  const selects = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('select').forEach(s => { out[s.id] = Array.from(s.options).map(o=>o.text.trim()); });
    return out;
  });
  console.log('=== SELECTS ===');
  console.log(JSON.stringify(selects, null, 2));

  // Body-Struktur: erste 8000 Zeichen
  const body = await page.evaluate(() => document.body.innerHTML.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,''));
  console.log('=== BODY HTML (8000 Zeichen) ===');
  console.log(body.substring(0, 8000));

  await browser.close();
  console.log('=== FERTIG ===');
})();
