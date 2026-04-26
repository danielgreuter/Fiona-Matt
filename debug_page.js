#!/usr/bin/env node
const { chromium } = require('playwright');
const fs = require('fs');
const wait = ms => new Promise(r => setTimeout(r, ms));

const BASE_URL = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' });
  page.setDefaultTimeout(25000);

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await wait(3000);

  // Dismiss cookie banner if present
  try {
    const nein = page.locator('button:has-text("Nein"), button:has-text("Ja"), button:has-text("Ablehnen"), button:has-text("Akzeptieren")').first();
    if (await nein.isVisible({ timeout: 3000 })) { await nein.click(); await wait(1000); console.log('Cookie-Banner geschlossen'); }
  } catch (_) {}

  // Dump full body HTML
  const html = await page.evaluate(() => document.body.innerHTML);
  fs.writeFileSync('debug_body.html', html);
  console.log(`body.html geschrieben (${html.length} Zeichen)`);

  // Find divs that contain result-like text (e.g. "12.08")
  const structure = await page.evaluate(() => {
    const results = [];
    // Find any element whose text matches a sprint result
    document.querySelectorAll('div, span, li').forEach(el => {
      if (/^\d{2}\.\d{2}$/.test((el.innerText||'').trim())) {
        const parent = el.closest('[class]') || el.parentElement;
        const gp = parent ? (parent.closest('[class]') || parent.parentElement) : null;
        results.push({
          tag: el.tagName,
          text: el.innerText.trim(),
          class: el.className,
          parentTag: parent ? parent.tagName : '-',
          parentClass: parent ? parent.className : '-',
          gpTag: gp ? gp.tagName : '-',
          gpClass: gp ? gp.className : '-',
        });
      }
    });
    return results.slice(0, 5);
  });
  console.log('Elemente mit Resultaten (z.B. "12.08"):');
  structure.forEach(s => console.log(JSON.stringify(s)));

  await browser.close();
})();
