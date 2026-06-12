// ═══════════════════════════════════════════════════
// scrape_chcalendar.js  (v1)
// Liest den alabus Swiss-Athletics Eventkalender VOLLSTAENDIG
// (alle PrimeFaces-Seiten) und laedt ihn in den Worker-KV
// (Key: chcalendar:v1), den ?action=chcalendar ausliefert.
// Filterlogik identisch zum bisherigen Worker-Code.
// Aufruf: node scrape_chcalendar.js --upload
// ═══════════════════════════════════════════════════
const { chromium } = require('playwright');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID   || '';
const UPLOAD = process.argv.includes('--upload');

const URL = 'https://alabus.swiss-athletics.ch/satweb/faces/eventcalendar.xhtml?lang=de';
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

// Aktuelle Tabellen-Zeilen als Text-Zellen auslesen
async function readRows(page) {
  return page.$$eval('tbody tr', trs =>
    trs.map(tr => [...tr.querySelectorAll('td')].map(td =>
      (td.innerText || '').replace(/\s+/g, ' ').trim()
    )).filter(c => c.length >= 3)
  );
}

function rowToEvent(cells) {
  // Datum: erstes dd.mm.yyyy in Zelle 0 (auch bei "30.06.2026 - 01.07.2026")
  const dm = (cells[0] || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!dm) return null;
  const date = `${dm[1]}.${dm[2]}.${dm[3]}`;
  const name  = cells[1] || '';
  const venue = cells[2] || '';
  if (name.length < 3) return null;

  // Kanton: erste Zelle ab Index 3, die exakt 2 Grossbuchstaben ist
  let canton = '';
  for (let i = 3; i < cells.length; i++) {
    if (/^[A-Z]{2}$/.test(cells[i])) { canton = cells[i]; break; }
  }

  // Meldeschluss: letztes dd.mm.yyyy in den Zellen ab Index 3
  let deadline = '';
  for (let i = cells.length - 1; i >= 3; i--) {
    const m = (cells[i] || '').match(/(\d{2}\.\d{2}\.\d{4})/);
    if (m) { deadline = m[1]; break; }
  }

  // Disziplinen-Heuristik (identisch zum Worker): falls eine Zelle Disziplinen
  // listet, muss "100m" vorkommen; sonst Namens-Heuristik
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

  // Nur zukuenftige Events
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const evDate = new Date(+dm[3], +dm[2] - 1, +dm[1]);
  if (evDate < today) return null;

  return { date, name, venue, canton, deadline, past: false };
}

async function main() {
  console.log('🚀 chcalendar v1\n');
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1500);

  // Zeilen pro Seite maximieren, falls Auswahl vorhanden (PrimeFaces rpp-Dropdown)
  try {
    const rpp = page.locator('select.ui-paginator-rpp-options').first();
    if (await rpp.count()) {
      const values = await rpp.locator('option').allTextContents();
      const max = values.map(v => parseInt(v, 10)).filter(Number.isFinite).sort((a, b) => b - a)[0];
      if (max) {
        await rpp.selectOption(String(max));
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1200);
        console.log(`   Zeilen pro Seite: ${max}`);
      }
    }
  } catch (e) { console.log('   (rpp-Auswahl uebersprungen: ' + e.message + ')'); }

  const events = [];
  const seen = new Set();
  let lastSig = '';
  for (let pg = 1; pg <= 60; pg++) {
    const rows = await readRows(page);
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

    // Weiter blaettern, solange "next" nicht deaktiviert ist
    const next = page.locator('a.ui-paginator-next').first();
    if (!(await next.count())) { console.log('   Kein Paginator - Ende'); break; }
    const cls = (await next.getAttribute('class')) || '';
    if (cls.includes('ui-state-disabled')) { console.log('   Letzte Seite erreicht'); break; }
    await next.click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(900);
  }

  await browser.close();

  // Sortierung nach Datum (wie Worker-Ausgabe erwartet)
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
