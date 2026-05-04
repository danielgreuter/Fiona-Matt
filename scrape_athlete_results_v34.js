// scrape_athlete_results_v34.js
// Erkundet alabus-Seiten für persönliche Athleten-Resultate

const { chromium } = require('playwright');

const ATHLETE_CON = 'a21aa-jcx7vr-jy2cprqv-1-jy4ejg9t-4tf';
const ALABUS = 'https://alabus.swiss-athletics.ch/satweb/faces';

const CANDIDATES = [
  `${ALABUS}/athleteResults.xhtml?con=${ATHLETE_CON}&lang=de`,
  `${ALABUS}/athleteresults.xhtml?con=${ATHLETE_CON}&lang=de`,
  `${ALABUS}/bestlistathlete.xhtml?con=${ATHLETE_CON}&lang=de&bltype=0&top=200`,
  `${ALABUS}/bestlistathlete.xhtml?con=${ATHLETE_CON}&lang=de&bltype=0&top=200&blyear=2025&blcat=5c4o3k5m-d686mo-j986g2ie-1-j986g45y-bn&disci=5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79&indoor=true`,
  `${ALABUS}/bestlistathlete.xhtml?con=${ATHLETE_CON}&lang=de&bltype=0&top=200&blcat=5c4o3k5m-d686mo-j986g2ie-1-j986g45y-bn&disci=5c4o3k5m-d686mo-j986g2ie-1-j986g3pt-79&indoor=true`,
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();

  for (const url of CANDIDATES) {
    console.log(`\n🔍 ${url.replace(ATHLETE_CON,'CON').substring(0,120)}`);
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(2000);

      const info = await page.evaluate(() => {
        const trs = [...document.querySelectorAll('table tr')];
        const title = document.title;
        const h1 = document.querySelector('h1,h2')?.textContent?.trim() || '';
        return {
          status: document.readyState,
          title, h1,
          tableRows: trs.length,
          hasFiona: document.body.textContent.includes('Fiona'),
          sample: trs.slice(0,4).map(r => r.textContent.trim().replace(/\s+/g,' ').substring(0,100)),
          dropdowns: [...document.querySelectorAll('[id*="bestlist"] label, [id*="bestlist"] .ui-selectonemenu-label')]
            .map(e => e.textContent.trim()).filter(Boolean),
        };
      });

      console.log(`  HTTP: ${resp?.status()} | Rows: ${info.tableRows} | Fiona: ${info.hasFiona}`);
      console.log(`  Title: ${info.title} | H1: ${info.h1}`);
      if (info.dropdowns.length) console.log(`  Dropdowns: ${info.dropdowns.join(', ')}`);
      info.sample.forEach((r,i) => { if(r) console.log(`  row[${i}]: ${r}`); });

      if (info.hasFiona) {
        console.log('  ✅ FIONA GEFUNDEN!');
        await page.screenshot({ path: `debug_found_${CANDIDATES.indexOf(url)}.png` });
      }
    } catch(e) {
      console.log(`  ❌ ${e.message.split('\n')[0]}`);
    }
  }

  await browser.close();
}

main().catch(e => console.error('❌', e.message));
