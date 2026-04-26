#!/usr/bin/env node
/**
 * Swiss Athletics Bestenliste Scraper v22
 *
 * Fix: Jede <td> enthält einen <span class="ui-column-title"> als Prefix.
 * allTextContents() gab "Nr1", "Resultat12.08" etc. → parseInt scheiterte.
 * Lösung: ui-column-title Spans via evaluateAll() vor dem Lesen entfernen.
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN  = process.env.CF_API_TOKEN  || '';
const CF_KV_NS_ID   = process.env.CF_KV_NS_ID  || '';
const UPLOAD = process.argv.includes('--upload');

const ALABUS_BASE = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml';
const CAT_U18F    = '5c4o3k5m-d686mo-j986g2ie-1-j986g45y-bn';

const DISCIPLINES = [
  { key:'100m',           year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv', indoor:false, isJump:false },
  { key:'100m_2025',      year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986gfpc-4zv', indoor:false, isJump:false },
  { key:'60m',            year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79',  indoor:true,  isJump:false },
  { key:'60m_2025',       year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79',  indoor:true,  isJump:false },
  { key:'200m',           year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ghgt-6ks', indoor:false, isJump:false },
  { key:'200m_2025',      year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ghgt-6ks', indoor:false, isJump:false },
  { key:'Long Jump',      year:'2026', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ge5c-3mp', indoor:false, isJump:true  },
  { key:'Long Jump_2025', year:'2025', discId:'5c4o3k5m-d686mo-j986g2ie-1-j986ge5c-3mp', indoor:false, isJump:true  },
];

const wait = ms => new Promise(r => setTimeout(r, ms));

function buildUrl(disc) {
  const p = new URLSearchParams({ lang:'de', mobile:'false', blyear:disc.year, blcat:CAT_U18F, disci:disc.discId, top:'30' });
  if (disc.indoor) p.set('indoor', 'true');
  return `${ALABUS_BASE}?${p}`;
}

// ── Zeilen parsen — strippt ui-column-title Spans ─────────────

async function parseRows(page, isJump) {
  try {
    await page.waitForSelector('table tbody tr', { timeout: 15000 });
  } catch(e) {
    console.log(`   ⚠️  Timeout warten auf Tabellenzeilen`);
    return [];
  }

  const rowEls = await page.locator('table tbody tr').all();
  console.log(`   Zeilen gefunden: ${rowEls.length}`);

  const rows = [];
  for (const row of rowEls) {
    // ui-column-title Spans im Clone entfernen, dann innerText lesen
    const cells = await row.locator('td').evaluateAll(tds =>
      tds.map(td => {
        const clone = td.cloneNode(true);
        clone.querySelectorAll('.ui-column-title').forEach(s => s.remove());
        return clone.innerText.replace(/\s+/g, ' ').trim();
      })
    );

    if (cells.length < 3) continue;

    // cells[0] = Rang-Nr, cells[1] = Resultat, cells[2] = Wind, cells[3] = Rang,
    // cells[4] = Name, cells[5] = Verein, cells[6] = Nat., cells[7] = Geb.Dat,
    // cells[8] = Wettkampf, cells[9] = Ort, cells[10] = Datum

    const rank = parseInt(cells[0]);
    if (isNaN(rank) || rank < 1 || rank > 2000) continue;

    const result = cells[1] || '';
    const wind   = cells[2] || '';
    const name   = cells[4] || '';
    const club   = cells[5] || '';
    const date   = cells[10] || cells[7] || ''; // Wettkampfdatum bevorzugen

    // Resultat-Validierung
    const validResult = isJump
      ? /^\d+[.,]\d{2}$/.test(result)
      : /^\d{1,2}[:.]\d{2}(\.\d+)?$/.test(result);
    if (!validResult || !name) continue;

    rows.push({
      rank,
      name,
      result: result.replace(',', '.'),
      wind:   wind || null,
      club:   club || null,
      date:   date || null,
      isFiona: name.toLowerCase().includes('matt'),
    });
  }
  return rows;
}

// ── Eine Disziplin scrapen ────────────────────────────────────

async function scrapeDiscipline(page, disc) {
  const url = buildUrl(disc);
  console.log(`   URL: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await wait(1500);
  return await parseRows(page, disc.isJump);
}

// ── Helpers ───────────────────────────────────────────────────

function toSec(t) {
  if (!t) return null;
  const p = t.split(':');
  return p.length === 2 ? parseFloat(p[0])*60+parseFloat(p[1]) : parseFloat(t)||null;
}
function calcGap(a, b) {
  const d = toSec(a) - toSec(b);
  return (d >= 0?'+':'')+Math.abs(d).toFixed(2);
}

async function uploadKV(data) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS_ID}/values/bestenliste:fiona`;
  const res = await fetch(url, {
    method:'PUT',
    headers:{ 'Authorization':`Bearer ${CF_API_TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify(data),
  });
  console.log(res.ok ? '✅ KV Upload OK' : `❌ KV Fehler ${res.status}`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Bestenliste Scraper v22 (ui-column-title Fix)\n');

  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  });
  const page = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0',
    locale: 'de-CH',
  }).then(ctx => ctx.newPage());

  const result = { updated: new Date().toISOString().split('T')[0], disciplines:{} };

  for (let i = 0; i < DISCIPLINES.length; i++) {
    const disc = DISCIPLINES[i];
    console.log(`📋 ${disc.key} (${disc.indoor?'Indoor':'Outdoor'} ${disc.year})`);
    try {
      const rows  = await scrapeDiscipline(page, disc);
      const fiona = rows.find(r => r.isFiona);
      const top1  = rows[0];
      result.disciplines[disc.key] = {
        discipline:disc.key, year:disc.year, scraped:new Date().toISOString(),
        fiona: fiona ? {
          rank:fiona.rank, result:fiona.result, wind:fiona.wind||null, date:fiona.date,
          gapToFirst: top1 && top1.name!==fiona.name ? calcGap(fiona.result, top1.result) : null,
        } : null,
        top15: rows.slice(0,15), total: rows.length,
      };
      if (fiona)            console.log(`   ✅ Fiona: Rang ${fiona.rank} · ${fiona.result}`);
      else if (rows.length) console.log(`   ⚠️  Fiona nicht in Top ${rows.length} (PB ${rows[0].result}–${rows[rows.length-1].result})`);
      else                  console.log(`   ❌ 0 Einträge`);
    } catch(e) {
      console.log(`   ❌ ${e.message}`);
      result.disciplines[disc.key] = { error:e.message, fiona:null, top15:[], total:0 };
    }
    console.log('');
  }

  await browser.close();
  fs.writeFileSync('bestenliste.json', JSON.stringify(result, null, 2));
  console.log('💾 bestenliste.json gespeichert');
  if (UPLOAD && CF_ACCOUNT_ID) await uploadKV(result);
  console.log('\n✅ Fertig!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
