// scrape_bestenliste.js
// Swiss Athletics U18 Frauen Bestenliste scraper
// Schreibt 2026 immer neu; 2025 nur einmal (danach eingefroren).

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD    = process.argv.includes('--upload');
const FIONA     = 'Fiona Matt';
const FIONA_DOB = '02.09.2009';   // Geburtsdatum zur Identifikation
const BASE_URL  = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de&mobile=false&';

// ─── Cloudflare KV ──────────────────────────────────────────────────────────
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID;

async function kvGet(key) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV GET ${key}: ${res.status}`);
  return res.text();
}

async function kvPut(key, value) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: typeof value === 'string' ? value : JSON.stringify(value),
    }
  );
  if (!res.ok) throw new Error(`KV PUT ${key}: ${res.status} ${await res.text()}`);
}

// ─── Disziplinen ─────────────────────────────────────────────────────────────
// label      = Ausgabe-Key im JSON
// saLabel    = Text auf swiss-athletics.ch
// season     = "Outdoor" | "Indoor"
// isJump     = true → kein Wind-Feld

const DISCIPLINES_2026 = [
  { label: '100m',       saLabel: '100 m', season: 'Outdoor', isJump: false },
  { label: '60m',        saLabel: '60 m',  season: 'Indoor',  isJump: false },
  { label: '200m',       saLabel: '200 m', season: 'Outdoor', isJump: false },
  { label: 'Long Jump',  saLabel: 'Weit',  season: 'Outdoor', isJump: true  },
];

const DISCIPLINES_2025 = [
  { label: '100m',       saLabel: '100 m', season: 'Outdoor', isJump: false },
  { label: '60m',        saLabel: '60 m',  season: 'Indoor',  isJump: false },
  { label: '200m',       saLabel: '200 m', season: 'Outdoor', isJump: false },
  { label: 'Long Jump',  saLabel: 'Weit',  season: 'Outdoor', isJump: true  },
];

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function isFionaRow(cols) {
  // Fiona erkennen: Name-Spalte enthält "Matt" oder DOB stimmt
  return cols.some(c => c.includes('Matt')) || cols.some(c => c === FIONA_DOB);
}

function parseRows(rows, isJump) {
  // Spalten je nach Disziplin:
  // Sprint mit Wind: rank | result | wind | round? | name | club | dob
  // Sprint ohne Wind (Halle): rank | result | round? | name | club | dob
  // Weitsprung: rank | result | wind | versuch? | name | club | dob
  const results = [];
  for (const cols of rows) {
    if (cols.length < 4) continue;
    const rank   = parseInt(cols[0]);
    const result = cols[1];
    if (isNaN(rank) || !result) continue;

    // Wind: wenn cols[2] wie "+0.0" oder "-1.2" oder "0.0" aussieht → Windwert
    const windLike = /^[+-]?\d+\.\d+$/.test(cols[2]);
    let wind = null, nameIdx;
    if (isJump) {
      wind    = windLike ? cols[2] : null;
      nameIdx = windLike ? 4 : 3;
    } else {
      wind    = windLike ? cols[2] : null;
      nameIdx = windLike ? 4 : 3;
    }

    const name = cols[nameIdx] || '';
    const club = cols[nameIdx + 1] || '';
    const dob  = cols[nameIdx + 2] || '';

    results.push({
      rank,
      name,
      result,
      wind,
      club,
      date: dob,
      isFiona: name.includes('Matt') || dob === FIONA_DOB,
    });
  }
  return results;
}

function buildFionaEntry(rows) {
  const fRow = rows.find(r => r.isFiona);
  if (!fRow) return null;
  const first   = rows[0];
  const gap     = first && first.result !== fRow.result
    ? calcGap(fRow.result, first.result, fRow.result.includes('.'))
    : null;
  return {
    rank:       fRow.rank,
    result:     fRow.result,
    wind:       fRow.wind,
    date:       fRow.date,
    gapToFirst: gap,
  };
}

function calcGap(fionaResult, firstResult, isTime) {
  const f = parseFloat(fionaResult);
  const b = parseFloat(firstResult);
  if (isNaN(f) || isNaN(b)) return null;
  const diff = isTime ? (f - b) : (b - f);  // Zeit: Fiona langsamer = positiv; Weite: Fiona kürzer = positiv
  return (diff >= 0 ? '+' : '') + diff.toFixed(2);
}

// ─── Playwright: eine Disziplin scrapen ──────────────────────────────────────

async function scrapeDiscipline(page, disc, year) {
  const yr     = String(year);
  const label  = `${disc.label}  (${disc.season} ${yr} — "${disc.saLabel}")`;
  console.log(`\n📋 ${label}`);

  // Seite laden (fresh reload damit Filter zurückgesetzt)
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  // ── Filter setzen ─────────────────────────────────────────────────────────
  async function selectOption(labelText, value) {
    // Sucht das <select>-Element dessen zugehöriges Label den Text enthält
    // und setzt es auf den Wert der die gesuchte Option enthält
    const selected = await page.evaluate(({ lbl, val }) => {
      const labels = Array.from(document.querySelectorAll('label, span, td'));
      for (const el of labels) {
        if (!el.textContent.trim().includes(lbl)) continue;
        // Suche naheliegendes Select
        let sel = el.nextElementSibling;
        if (!sel || sel.tagName !== 'SELECT') {
          const parent = el.closest('tr,td,div');
          if (parent) sel = parent.querySelector('select');
        }
        if (!sel) continue;
        const opt = Array.from(sel.options).find(o => o.text.trim().includes(val));
        if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', {bubbles:true})); return true; }
      }
      return false;
    }, { lbl: labelText, val: value });
    if (selected) {
      console.log(`  ✓ "${value}"`);
    } else {
      console.warn(`  ✗ "${value}" nicht gefunden (${labelText})`);
    }
    await page.waitForTimeout(400);
  }

  // Alternativ-Methode: Text-Match in Select direkt
  async function selectDirect(value) {
    const done = await page.evaluate((val) => {
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const opt = Array.from(sel.options).find(o => o.text.trim() === val || o.text.trim().includes(val));
        if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', {bubbles:true})); return sel.id || true; }
      }
      return false;
    }, value);
    if (done) console.log(`  ✓ "${value}"`);
    else      console.warn(`  ✗ "${value}" nicht gefunden`);
    await page.waitForTimeout(400);
  }

  await selectDirect(disc.season);
  await page.waitForTimeout(600);
  await selectDirect('U18 Frauen');
  await page.waitForTimeout(600);
  await selectDirect(yr);
  await page.waitForTimeout(600);
  // Checkbox 'Nur Athlet/innen / Teams dieser Kategorie' aktivieren (PrimeFaces)
  await page.evaluate(() => {
    const cb = document.querySelector('[id="form_anonym:categoryExclusive"] .ui-chkbox-box');
    if (cb) cb.click();
  });
  await page.waitForTimeout(800);
  console.log('  ✓ Checkbox categoryExclusive geklickt');
  await selectDirect('Ein Resultat pro Athlet');
  await page.waitForTimeout(400);
  await selectDirect('30');
  await page.waitForTimeout(400);
  await selectDirect(disc.saLabel);
  await page.waitForTimeout(400);

  // Anzeigen-Button klicken
  const btn = await page.$('input[type=submit][value*=Anzeigen], button:has-text("Anzeigen")');
  if (btn) { await btn.click(); console.log(`  ✓ "Anzeigen" geklickt`); }
  else      { console.warn(`  ✗ Anzeigen-Button nicht gefunden`); }
  await page.waitForTimeout(3000);

  // ── iFrame finden & parsen ────────────────────────────────────────────────
  const frames = page.frames();
  let iframeFrame = null;
  for (const f of frames) {
    if (f.url().includes('bestlist.xhtml')) { iframeFrame = f; break; }
  }
  if (!iframeFrame) {
    // Fallback: iframe-Element holen
    const iframeEl = await page.$('iframe');
    if (iframeEl) {
      const iUrl = await iframeEl.getAttribute('src');
      console.log(`  iFrame URL: ${iUrl?.substring(0,80)}…`);
      iframeFrame = await iframeEl.contentFrame();
    }
  } else {
    console.log(`  iFrame URL: ${iframeFrame.url().substring(0,80)}…`);
  }

  if (!iframeFrame) {
    console.warn('  ✗ Kein iFrame gefunden');
    return null;
  }

  await iframeFrame.waitForTimeout(4000);

  // Tabelle parsen
  const html = await iframeFrame.content();
  const hasDate = html.includes('Datum') || html.includes('2009') || html.includes('2010');
  console.log(`  Datum: ${hasDate} | HTML: ${html.length}`);

  const scraped = await iframeFrame.evaluate(() => {
    const trs = document.querySelectorAll('table tr');
    const result = [];
    const firstThree = [];
    let i = 0;
    for (const tr of trs) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 3) continue;
        // Strip label prefixes (Swiss Athletics changed structure: 'Nr1' -> '1', 'ResultatX' -> 'X')
      const cols = Array.from(tds).map(td => {
        const raw = td.textContent.trim();
        return raw.replace(/^(Nr|Resultat|Wind|Rang|Name|Verein|Nat\.|Punkte|Datum)/, '').trim();
      });
      if (i++ < 3) firstThree.push(cols.slice(0, 6));
      const rankNum = parseInt(cols[0]);
      if (rankNum > 0 && rankNum <= 100) result.push(cols);
    }
    return { result, firstThree };
  });
  const rows = scraped.result;
  if (scraped.firstThree.length > 0) console.log('  Debug rows:', JSON.stringify(scraped.firstThree));
  else console.log('  ⚠️  Keine td-Zeilen gefunden');

  console.log(`  → ${rows.length} Zeilen | [0]: ${JSON.stringify(rows[0])}`);

  if (rows.length === 0) return null;

  const parsed = parseRows(rows, disc.isJump);
  const top15  = parsed.slice(0, 15);
  const fiona  = buildFionaEntry(parsed);

  if (fiona) {
    console.log(`  ⭐ Fiona: Rang ${fiona.rank} — ${fiona.result}`);
  } else {
    console.log(`  — Fiona nicht in Top ${rows.length}`);
  }

  const top1 = parsed[0];
  if (top1) console.log(`  1.: ${top1.name} ${top1.result}`);

  return {
    discipline: disc.label,
    year: yr,
    scraped: new Date().toISOString(),
    fiona,
    top15,
  };
}

// ─── Hauptprogramm ───────────────────────────────────────────────────────────

(async () => {
  // Prüfen ob 2025-Daten bereits eingefroren sind
  let skip2025 = false;
  if (UPLOAD) {
    console.log('\n🔍 Prüfe ob 2025-Daten bereits eingefroren…');
    try {
      const existing = await kvGet('bestenliste_2025:fiona');
      if (existing) {
        const parsed = JSON.parse(existing);
        if (parsed && parsed.disciplines && parsed.frozen) {
          skip2025 = true;
          console.log('  ✅ 2025 bereits eingefroren — wird nicht neu gescraped');
        } else {
          console.log('  ℹ️  2025-Key vorhanden aber noch nicht frozen → wird aktualisiert');
        }
      } else {
        console.log('  ℹ️  2025-Key noch nicht vorhanden → wird erstmalig gescraped');
      }
    } catch (e) {
      console.warn('  ⚠️  KV-Prüfung fehlgeschlagen:', e.message);
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  // ── 2026 scrapen ────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════');
  console.log('  SAISON 2026');
  console.log('══════════════════════════════');

  const disciplines2026 = {};
  for (const disc of DISCIPLINES_2026) {
    const result = await scrapeDiscipline(page, disc, 2026);
    if (result) disciplines2026[disc.label] = result;
  }

  const json2026 = {
    updated:     new Date().toISOString(),
    disciplines: disciplines2026,
  };

  fs.writeFileSync('bestenliste.json', JSON.stringify(json2026, null, 2));
  console.log('\n✅ bestenliste.json');

  if (UPLOAD) {
    await kvPut('bestenliste:fiona', json2026);
    console.log('✅ KV fertig (2026)');
  }

  // ── 2025 scrapen (nur wenn nicht eingefroren) ────────────────────────────
  if (!skip2025) {
    console.log('\n══════════════════════════════');
    console.log('  SAISON 2025');
    console.log('══════════════════════════════');

    const disciplines2025 = {};
    for (const disc of DISCIPLINES_2025) {
      const result = await scrapeDiscipline(page, disc, 2025);
      if (result) disciplines2025[disc.label] = result;
    }

    const json2025 = {
      updated:     new Date().toISOString(),
      frozen:      true,     // ← Ab jetzt nicht mehr überschreiben
      disciplines: disciplines2025,
    };

    fs.writeFileSync('bestenliste_2025.json', JSON.stringify(json2025, null, 2));
    console.log('\n✅ bestenliste_2025.json');

    if (UPLOAD) {
      await kvPut('bestenliste_2025:fiona', json2025);
      console.log('✅ KV fertig (2025 — eingefroren)');
    }
  }

  await browser.close();
  console.log('\n✅ Fertig');
})();
