// scrape_bestenliste.js — v3, Playwright mit page.selectOption()

const { chromium } = require('playwright');
const fs = require('fs');

const UPLOAD    = process.argv.includes('--upload');
const FIONA_DOB = '02.09.2009';
const BASE_URL  = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml?lang=de&mobile=false&';

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID;

async function kvGet(key) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } }
  );
  if (res.status === 404) return null;
  return res.text();
}

async function kvPut(key, value) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: typeof value === 'string' ? value : JSON.stringify(value) }
  );
  if (!res.ok) throw new Error(`KV PUT ${key}: ${res.status}`);
}

const DISCIPLINES = [
  { label: '60m',       saLabel: '60 m',  season: 'Indoor',  isJump: false },
  { label: '100m',      saLabel: '100 m', season: 'Outdoor', isJump: false },
  { label: '200m',      saLabel: '200 m', season: 'Outdoor', isJump: false },
  { label: 'Long Jump', saLabel: 'Weit',  season: 'Outdoor', isJump: true  },
];

const SEL = {
  year:     '#form_anonym\\:bestlistYear_input',
  season:   '#form_anonym\\:bestlistSeason_input',
  category: '#form_anonym\\:bestlistCategory_input',
  disc:     '#form_anonym\\:bestlistDiscipline_input',
  type:     '#form_anonym\\:bestlistType_input',
  tops:     '#form_anonym\\:bestlistTops_input',
};

async function scrapeDiscipline(page, disc, year) {
  const yr = String(year);
  console.log(`\n📋 ${disc.label} (${disc.season} ${yr})`);

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  await page.selectOption(SEL.season, { label: disc.season });
  console.log(`  ✓ Saison: ${disc.season}`);
  await page.waitForTimeout(800);

  await page.selectOption(SEL.category, { label: 'U18 Frauen' });
  console.log(`  ✓ Kategorie: U18 Frauen`);
  await page.waitForTimeout(800);

  await page.selectOption(SEL.year, { label: yr });
  console.log(`  ✓ Jahr: ${yr}`);
  await page.waitForTimeout(800);

  await page.selectOption(SEL.type, { label: 'Ein Resultat pro Athlet' }).catch(() => {});
  await page.waitForTimeout(600);

  await page.selectOption(SEL.tops, { label: '30' }).catch(() => {});
  await page.waitForTimeout(600);

  await page.selectOption(SEL.disc, { label: disc.saLabel });
  console.log(`  ✓ Disziplin: ${disc.saLabel}`);
  await page.waitForTimeout(800);

  // Kategorie verify & re-set if needed
  const catSelected = await page.locator(`${SEL.category} option:checked`).innerText().catch(() => '');
  if (!catSelected.includes('U18 Frauen')) {
    await page.selectOption(SEL.category, { label: 'U18 Frauen' });
    await page.waitForTimeout(800);
    console.log(`  ✓ Kategorie nochmals gesetzt`);
  }

  // Anzeigen klicken
  await page.locator('input[type=submit][value*=Anzeigen], button:has-text("Anzeigen")').first().click();
  console.log(`  ✓ Anzeigen geklickt`);
  await page.waitForTimeout(4000);

  // iFrame finden
  let iframeFrame = null;
  for (const f of page.frames()) {
    if (f.url().includes('bestlist.xhtml')) { iframeFrame = f; break; }
  }
  if (!iframeFrame) {
    const el = await page.$('iframe');
    if (el) iframeFrame = await el.contentFrame();
  }
  if (!iframeFrame) { console.warn('  ✗ Kein iFrame'); return null; }
  await iframeFrame.waitForTimeout(3000);

  const scraped = await iframeFrame.evaluate(() => {
    const trs = document.querySelectorAll('table tr');
    const result = [], first3 = [];
    let i = 0;
    for (const tr of trs) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 3) continue;
      const cols = Array.from(tds).map(td =>
        td.textContent.trim().replace(/^(Nr|Resultat|Wind|Rang|Name|Verein|Nat\.|Geb\. Dat\.|Wettkampf|Ort|Datum)/, '').trim()
      );
      if (i++ < 3) first3.push(cols.slice(0, 12));  // extended for column debugging
      const rank = parseInt(cols[0]);
      if (rank > 0 && rank <= 100) result.push(cols);
    }
    return { result, first3 };
  });

  const rows = scraped.result;
  console.log(`  → ${rows.length} Zeilen | [0]: ${JSON.stringify(scraped.first3[0])}`);

  if (rows.length === 0) return { discipline: disc.label, year: yr, scraped: new Date().toISOString(), fiona: null, top15: [] };

  const top15 = rows.slice(0, 15).map(cols => {
    const windLike = /^[+-]?\d+\.\d+$/.test(cols[2]);
    const rawIdx   = windLike ? 4 : 3;
    // NH* Spalte uberspringen (Weitsprung hat extra NH*-Spalte zwischen Rang und Name)
    const nameIdx  = (cols[rawIdx] === 'NH*' || cols[rawIdx] === '') ? rawIdx + 1 : rawIdx;
    return {
      rank:    parseInt(cols[0]),
      result:  cols[1],
      wind:    windLike ? cols[2] : null,
      name:    cols[nameIdx] || '',
      club:    cols[nameIdx + 1] || '',
      nat:     cols[nameIdx + 2] || '',
      venue:     cols[nameIdx + 4] || '',    // Ort (Wettkampfstätte)
      comp_date: cols[nameIdx + 5] || '',    // Datum (Wettkampfdatum)
      born:      cols[nameIdx + 6] || '',
      isFiona: (cols[nameIdx] || '').includes('Matt'),
    };
  });

  const fRow  = top15.find(r => r.isFiona);
  const fiona = fRow ? {
    rank: fRow.rank, result: fRow.result, wind: fRow.wind,
    gapToFirst: top15[0] ? (parseFloat(fRow.result) - parseFloat(top15[0].result) >= 0 ? '+' : '') + (parseFloat(fRow.result) - parseFloat(top15[0].result)).toFixed(2) : null,
  } : null;

  if (fiona) console.log(`  ⭐ Fiona: Rang ${fiona.rank} — ${fiona.result}`);
  else console.log(`  — Fiona nicht in Top ${rows.length}`);
  if (top15[0]) console.log(`  1.: ${top15[0].name} ${top15[0].result}`);

  return { discipline: disc.label, year: yr, scraped: new Date().toISOString(), fiona, top15 };
}

(async () => {
  let skip2025 = false;
  if (UPLOAD) {
    try {
      const ex = await kvGet('bestenliste_2025:fiona');
      if (ex && JSON.parse(ex).frozen) { skip2025 = true; console.log('✅ 2025 eingefroren'); }
    } catch(e) {}
  }

  const browser = await chromium.launch({ headless: true });
  const page    = await (await browser.newContext()).newPage();

  // 2026
  console.log('\n══ SAISON 2026 ══');
  const disc2026 = {};
  for (const disc of DISCIPLINES) {
    const r = await scrapeDiscipline(page, disc, 2026);
    if (r) disc2026[disc.label] = r;
  }
  const json2026 = { updated: new Date().toISOString(), disciplines: disc2026 };
  fs.writeFileSync('bestenliste.json', JSON.stringify(json2026, null, 2));
  console.log('\n✅ bestenliste.json');
  if (UPLOAD) { await kvPut('bestenliste:fiona', json2026); console.log('✅ KV (2026)'); }

  // 2025
  if (!skip2025) {
    console.log('\n══ SAISON 2025 ══');
    const disc2025 = {};
    for (const disc of DISCIPLINES) {
      const r = await scrapeDiscipline(page, disc, 2025);
      if (r) disc2025[disc.label] = r;
    }
    const json2025 = { updated: new Date().toISOString(), frozen: true, disciplines: disc2025 };
    fs.writeFileSync('bestenliste_2025.json', JSON.stringify(json2025, null, 2));
    console.log('\n✅ bestenliste_2025.json');
    if (UPLOAD) { await kvPut('bestenliste_2025:fiona', json2025); console.log('✅ KV (2025)'); }
  }

  await browser.close();
  console.log('\n✅ Fertig');
})();
