// ═══════════════════════════════════════════════════
// scrape_chcalendar.js  (v6)
// Einstieg ueber die offizielle Swiss-Athletics-Seite
// (Session-Fix fuer "Der Benutzer ist nicht mehr gueltig"),
// dann im alabus-iframe: Suchen klicken, blaettern, parsen.
// Upload in Worker-KV (Key: chcalendar:v1).
// Aufruf: node scrape_chcalendar.js --upload
// ═══════════════════════════════════════════════════
const { chromium } = require('playwright');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';
const UPLOAD = process.argv.includes('--upload');

const WRAPPER_URL = 'https://www.swiss-athletics.ch/wettkaempfe/veranstaltungen/wettkampfkalender/';
const DIRECT_URL  = 'https://alabus.swiss-athletics.ch/satweb/faces/eventcalendar.xhtml?lang=de';
const KV_KEY = 'chcalendar:v1';

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${KV_KEY}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '✅ KV OK' : `❌ KV ${res.status}: ${await res.text()}`);
}

// Robust goto: Retry bei transienten Netzwerkfehlern
async function gotoRetry(page, url, opts, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await page.goto(url, opts);
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e);
      const transient = /net::ERR_|ERR_CONNECTION|ERR_TIMED_OUT|ERR_EMPTY_RESPONSE|ERR_NETWORK_CHANGED|Timeout/i.test(msg);
      if (!transient || i === tries - 1) throw e;
      const wait = 3000 * (i + 1) * (i + 1);
      console.log(`   \u23f3 goto fehlgeschlagen (${msg.split('\n')[0]}), Retry ${i + 1}/${tries - 1} in ${wait / 1000}s`);
      await page.waitForTimeout(wait);
    }
  }
  throw lastErr;
}

// Cookie-Consent der Swiss-Athletics-Seite wegklicken (best effort)
async function acceptCookies(page) {
  const candidates = [
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Akzeptieren")',
    'button:has-text("OK")',
    'button:has-text("Ja")',
    'a:has-text("OK")',
  ];
  for (const sel of candidates) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() && await loc.isVisible().catch(() => false)) {
        await loc.click({ timeout: 3000 });
        console.log(`   Cookie-Banner bestaetigt (${sel})`);
        await page.waitForTimeout(800);
        return;
      }
    } catch (e) { /* naechster */ }
  }
}

// alabus-iframe auf der Wrapper-Seite finden
async function findAlabusFrame(page) {
  for (let i = 0; i < 20; i++) {
    for (const f of page.frames()) {
      if (/alabus\.swiss-athletics\.ch/i.test(f.url())) return f;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

// Wartet, bis nach dem Such-Klick echte Datenzeilen erscheinen
async function waitForResults(ctx, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const n = await ctx.evaluate(() => {
        // Datenzeilen: <tr> mit >=3 <td>, die ein Datum enthalten
        const trs = [...document.querySelectorAll('tr')];
        let c = 0;
        for (const tr of trs) {
          const tds = tr.querySelectorAll('td');
          if (tds.length >= 3 && /\d{2}\.\d{2}\.\d{4}/.test(tr.innerText || '')) c++;
        }
        const noData = /keine\s+(daten|wettk|ergebnisse)/i.test(document.body.innerText || '');
        return c > 0 ? c : (noData ? -1 : 0);
      });
      if (n > 0) { console.log(`   Ergebnisse erschienen (${n} Datenzeilen)`); return true; }
      if (n === -1) { console.log('   Suche lieferte "keine Daten"'); return false; }
    } catch (e) { /* weiter warten */ }
    await ctx.waitForTimeout(600);
  }
  console.log('   \u26a0 Timeout beim Warten auf Ergebnisse');
  return false;
}

// Suchen-Klick im Kalender (ctx = Frame oder Page)
async function triggerSearch(ctx) {
  const candidates = [
    'button:has-text("Suchen")',
    'a.ui-button:has-text("Suchen")',
    'span.ui-button-text:has-text("Suchen")',
    'a[href*="such" i]',
    'input[type="submit"]',
    'button[id*="search" i]',
    'a[id*="search" i]',
    'button[id*="such" i]',
    'a[id*="such" i]',
  ];
  for (const sel of candidates) {
    try {
      const loc = ctx.locator(sel).first();
      if (await loc.count()) {
        console.log(`   Suche ausloesen via ${sel}`);
        // Zweifacher Anlauf: normaler Klick, dann DOM-Klick (PrimeFaces onclick)
        await loc.click({ timeout: 5000 }).catch(() => {});
        if (await waitForResults(ctx, 12000)) return true;
        console.log('   Kein Ergebnis - erzwinge DOM-Klick');
        await ctx.evaluate((s) => {
          const el = document.querySelector(s.replace(/:has-text\([^)]*\)/, ''));
          if (el) el.click();
        }, sel).catch(() => {});
        if (await waitForResults(ctx, 12000)) return true;
      }
    } catch (e) { /* naechster */ }
  }
  // Letzter Versuch: irgendeinen sichtbaren Button mit Text "Suchen" per DOM klicken
  try {
    await ctx.evaluate(() => {
      const el = [...document.querySelectorAll('button, a, input[type=submit], span')]
        .find(b => /^\s*suchen\s*$/i.test((b.innerText || b.value || '')));
      if (el) el.click();
    });
    if (await waitForResults(ctx, 12000)) return true;
  } catch (e) { /* egal */ }
  console.log('   \u26a0 Suche konnte nicht ausgeloest werden');
  return false;
}

// Zeilen lesen (ctx = Frame oder Page), 3 Fallback-Stufen
async function readRows(ctx) {
  for (const sel of ['tbody tr', 'table tr']) {
    try {
      const rows = await ctx.$$eval(sel, trs =>
        trs.map(tr => [...tr.querySelectorAll('td')].map(td =>
          (td.innerText || '').replace(/\s+/g, ' ').trim()
        )).filter(c => c.length >= 3)
      );
      if (rows.length) return rows;
    } catch (e) { /* naechste Stufe */ }
  }
  try {
    const html = await ctx.content();
    const rows = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(html)) !== null) {
      const cells = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm;
      while ((cm = cellRe.exec(rm[1])) !== null) {
        cells.push(cm[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
      }
      if (cells.length >= 3) rows.push(cells);
    }
    if (rows.length) console.log('   (Zeilen via Roh-HTML-Fallback)');
    return rows;
  } catch (e) { return []; }
}

async function diagnose(ctx, page) {
  try {
    const info = await ctx.evaluate(() => ({
      tables: document.querySelectorAll('table').length,
      trs: document.querySelectorAll('tr').length,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    }));
    console.log(`   \u26a0 Diagnose: url=${ctx.url()} | tables=${info.tables} trs=${info.trs}`);
    console.log(`   \u26a0 Seitentext: ${info.text}`);
    await page.screenshot({ path: 'debug_chcal.png', fullPage: true }).catch(() => {});
  } catch (e) { console.log('   Diagnose fehlgeschlagen: ' + e.message); }
}

function rowToEvent(cells) {
  const dm = (cells[0] || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!dm) return null;
  const date = `${dm[1]}.${dm[2]}.${dm[3]}`;
  const name  = cells[1] || '';
  const venue = cells[2] || '';
  if (name.length < 3) return null;

  let canton = '';
  for (let i = 3; i < cells.length; i++) {
    if (/^[A-Z]{2}$/.test(cells[i])) { canton = cells[i]; break; }
  }

  let deadline = '';
  for (let i = cells.length - 1; i >= 3; i--) {
    const m = (cells[i] || '').match(/(\d{2}\.\d{2}\.\d{4})/);
    if (m) { deadline = m[1]; break; }
  }

  let disciplines = '';
  for (let i = 3; i < cells.length; i++) {
    const cell = cells[i] || '';
    if (/^[A-Z]{2}$/.test(cell)) continue;
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(cell)) continue;
    if (!disciplines && /\d+\s*m\b|sprung|wurf|stoss|mehrkampf|hürden/i.test(cell)) disciplines = cell;
  }
  const has100m = disciplines
    ? /\b100\s*m\b/i.test(disciplines)
    : /WRC|national|nachwuchs|meeting/i.test(name);
  if (!has100m) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const evDate = new Date(+dm[3], +dm[2] - 1, +dm[1]);
  if (evDate < today) return null;

  return { date, name, venue, canton, deadline, past: false };
}

async function main() {
  console.log('🚀 chcalendar v6\n');
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();

  // 1) Offizieller Einstieg ueber die Swiss-Athletics-Seite (gueltige Session)
  let ctx = null;
  try {
    await gotoRetry(page, WRAPPER_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await acceptCookies(page);
    ctx = await findAlabusFrame(page);
    if (ctx) console.log(`   alabus-iframe gefunden: ${ctx.url()}`);
    else console.log('   \u26a0 Kein alabus-iframe auf der Wrapper-Seite - Fallback auf Direktaufruf');
  } catch (e) {
    console.log('   \u26a0 Wrapper-Seite fehlgeschlagen (' + e.message.split('\n')[0] + ') - Fallback auf Direktaufruf');
  }

  // 2) Fallback: Direktaufruf wie bisher
  if (!ctx) {
    await gotoRetry(page, DIRECT_URL, { waitUntil: 'networkidle', timeout: 45000 });
    ctx = page;
  }
  await page.waitForTimeout(1500);

  // 3) Suche ausloesen (wartet intern auf Ergebnisse)
  await triggerSearch(ctx);

  // 4) Zeilen pro Seite maximieren, falls Auswahl vorhanden
  try {
    const rpp = ctx.locator('select.ui-paginator-rpp-options').first();
    if (await rpp.count()) {
      const values = await rpp.locator('option').allTextContents();
      const max = values.map(v => parseInt(v, 10)).filter(Number.isFinite).sort((a, b) => b - a)[0];
      if (max) {
        await rpp.selectOption(String(max));
        await ctx.waitForTimeout(1500);
        console.log(`   Zeilen pro Seite: ${max}`);
      }
    }
  } catch (e) { /* optional */ }

  // 5) Blaettern und sammeln
  const events = [];
  const seen = new Set();
  let lastSig = '';
  for (let pg = 1; pg <= 60; pg++) {
    const rows = await readRows(ctx);
    if (pg === 1 && !rows.length) await diagnose(ctx, page);
    const sig = rows.length ? rows[0].join('|') : '';
    if (sig && sig === lastSig) { console.log(`   Seite ${pg}: identisch zur vorherigen - Ende`); break; }
    lastSig = sig;

    let added = 0;
    for (const cells of rows) {
      const ev = rowToEvent(cells);
      if (!ev) continue;
      const key = ev.date + '|' + ev.name;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(ev);
      added++;
    }
    console.log(`   Seite ${pg}: ${rows.length} Zeilen, ${added} relevante Events`);

    const next = ctx.locator('a.ui-paginator-next').first();
    if (!(await next.count())) { console.log('   Kein Paginator - Ende'); break; }
    const cls = (await next.getAttribute('class')) || '';
    if (cls.includes('ui-state-disabled')) { console.log('   Letzte Seite erreicht'); break; }
    await next.click();
    await ctx.waitForTimeout(1200);
  }

  await browser.close();

  events.sort((a, b) => {
    const pa = a.date.split('.'), pb = b.date.split('.');
    return new Date(+pa[2], +pa[1] - 1, +pa[0]) - new Date(+pb[2], +pb[1] - 1, +pb[0]);
  });

  const output = { events, updated: new Date().toISOString(), source: 'scraper' };
  console.log(`\n📊 ${events.length} kommende 100m-relevante Wettkaempfe`);
  events.slice(0, 8).forEach(e => console.log(`   ${e.date}  ${e.name} (${e.venue} ${e.canton})  MS: ${e.deadline || '-'}`));

  require('fs').writeFileSync('ch_calendar.json', JSON.stringify(output, null, 2));
  if (events.length === 0) {
    console.log('⚠ Keine Events gefunden - KV wird NICHT ueberschrieben.');
    process.exit(1);
  }
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(output);
}

main().catch(e => { console.error('FEHLER:', e); process.exit(1); });
