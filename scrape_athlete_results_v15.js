// scrape_athlete_results_v15.js — DEBUG-Version
// Screenshot + HTML-Dump nach jedem Filter-Schritt

const { chromium } = require('playwright');
const fs = require('fs');

const ATHLETE_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
const BASE_URL = `https://alabus.swiss-athletics.ch/satweb/faces/bestlistathlete.xhtml?con=${ATHLETE_CON}&lang=de`;

async function selectPF(page, componentId, labelText, optional = false) {
  const eid = componentId.replace(/:/g, '\\:');
  try {
    await page.click(`#${eid}`, { timeout: 8000 });
    const panel = page.locator(`#${eid}_panel`);
    await panel.waitFor({ state: 'visible', timeout: 10000 });
    await panel.locator(`.ui-selectonemenu-item[data-label="${labelText}"]`).first().click();
    await panel.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(800);
  } catch (err) {
    if (optional) { console.log(`  ⚠ skip ${labelText}`); return; }
    throw err;
  }
}

async function selectDiscViaJQ(page, rawId, labelText) {
  const result = await page.evaluate(({ id, label }) => {
    const inputEl = document.getElementById(id + '_input');
    const labelEl = document.getElementById(id + '_label');
    if (!inputEl) return 'ERR:no input';
    for (let i = 0; i < inputEl.options.length; i++) {
      if (inputEl.options[i].text === label) {
        inputEl.selectedIndex = i;
        if (labelEl) labelEl.textContent = label;
        const w = Object.values(window.PrimeFaces && window.PrimeFaces.widgets || {})
          .find(w => w && w.id && w.id.includes('Discipline'));
        if (w && typeof w.triggerChange === 'function') { w.triggerChange(true); return 'A:triggerChange'; }
        const jq = window.$ || window.jQuery;
        if (jq) { jq(inputEl).trigger('change'); return 'B:jquery'; }
        return 'C:change-only';
      }
    }
    return 'ERR:not found';
  }, { id: rawId, label: labelText });
  console.log(`  JS: ${result}`);
  await page.waitForTimeout(1000);
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function main() {
  console.log('🔍 DEBUG v15 — Screenshot + HTML-Dump\n');
  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

  // ── Test 1: Seite ohne Filter laden ─────────────────────────────────────────
  console.log('=== TEST 1: Seite ohne Filter ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'debug_01_initial.png', fullPage: false });

  const html1 = await page.evaluate(() => {
    const t = document.querySelector('table');
    const rows = t ? [...t.querySelectorAll('tr')].slice(0, 5).map(r => r.textContent.trim().replace(/\s+/g, ' ')) : [];
    return { tableFound: !!t, rows, bodyText: document.body.innerText.slice(0, 500) };
  });
  console.log('Tabelle gefunden:', html1.tableFound);
  console.log('Erste 5 Zeilen:', JSON.stringify(html1.rows, null, 2));
  console.log('Body (500 chars):', html1.bodyText);

  // ── Test 2: Nur Saison Indoor setzen ────────────────────────────────────────
  console.log('\n=== TEST 2: Saison Indoor ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  await selectPF(page, 'form_anonym:bestlistSeason', 'Indoor');
  await page.screenshot({ path: 'debug_02_indoor.png', fullPage: false });

  const html2 = await page.evaluate(() => {
    const t = document.querySelector('table');
    const rows = t ? [...t.querySelectorAll('tr')].slice(0, 8).map(r => r.textContent.trim().replace(/\s+/g, ' ')) : [];
    return { tableFound: !!t, rowCount: t ? t.querySelectorAll('tr').length : 0, rows };
  });
  console.log('Tabelle Zeilen:', html2.rowCount);
  console.log('Erste Zeilen:', JSON.stringify(html2.rows, null, 2));

  // ── Test 3: Saison Indoor + Disziplin 60m ───────────────────────────────────
  console.log('\n=== TEST 3: Indoor + 60m ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  await selectPF(page, 'form_anonym:bestlistSeason', 'Indoor');
  await selectDiscViaJQ(page, 'form_anonym:bestlistDiscipline', '60 m');
  await page.screenshot({ path: 'debug_03_indoor_60m.png', fullPage: false });

  const html3 = await page.evaluate(() => {
    const t = document.querySelector('table');
    const rows = t ? [...t.querySelectorAll('tr')].slice(0, 10).map(r => r.textContent.trim().replace(/\s+/g, ' ')) : [];
    // Alle sichtbaren Texte auf der Seite die "Fiona" enthalten
    const fionaHits = [...document.querySelectorAll('*')]
      .filter(el => el.children.length === 0 && el.textContent.includes('Fiona'))
      .map(el => el.textContent.trim()).slice(0, 5);
    return { tableFound: !!t, rowCount: t ? t.querySelectorAll('tr').length : 0, rows, fionaHits };
  });
  console.log('Tabelle Zeilen:', html3.rowCount);
  console.log('Erste Zeilen:', JSON.stringify(html3.rows, null, 2));
  console.log('"Fiona" auf der Seite:', html3.fionaHits);

  // ── Test 4: Alle Disziplinen (kein Filter) ──────────────────────────────────
  console.log('\n=== TEST 4: Alle Disziplinen (kein Disc-Filter) ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  await selectPF(page, 'form_anonym:bestlistSeason', 'Indoor');
  // "Alle Disziplinen" wählen
  await selectDiscViaJQ(page, 'form_anonym:bestlistDiscipline', 'Alle Disziplinen');
  await page.screenshot({ path: 'debug_04_alle_disc.png', fullPage: false });

  const html4 = await page.evaluate(() => {
    const t = document.querySelector('table');
    const rows = t ? [...t.querySelectorAll('tr')].slice(0, 10).map(r => r.textContent.trim().replace(/\s+/g, ' ')) : [];
    return { tableFound: !!t, rowCount: t ? t.querySelectorAll('tr').length : 0, rows };
  });
  console.log('Tabelle Zeilen:', html4.rowCount);
  console.log('Erste Zeilen:', JSON.stringify(html4.rows, null, 2));

  await browser.close();
  console.log('\n✅ Screenshots: debug_01_initial.png, debug_02_indoor.png, debug_03_indoor_60m.png, debug_04_alle_disc.png');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
