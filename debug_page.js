#!/usr/bin/env node
// Debug v4: Dump des Full-POST HTML nach Resultaten durchsuchen

const BASE_URL = 'https://alabus.swiss-athletics.ch/satweb/faces/bestlist.xhtml';

function extractViewState(text) {
  const m = text.match(/javax\.faces\.ViewState[^>]*value="([^"]+)"/s)
         || text.match(/<update id="javax\.faces\.ViewState"><!\[CDATA\[([^\]]+)\]\]>/);
  return m ? m[1] : null;
}
function extractOptionValue(html, labelText) {
  const re = new RegExp(`<option[^>]*value="([^"]*)"[^>]*>\\s*${labelText.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*</option>`);
  const m = html.match(re);
  return m ? m[1] : null;
}
function extractWindowGuid(html) {
  const m = html.match(/name="aeswindowguid"[^>]*value="([^"]+)"/);
  return m ? m[1] : '';
}

(async () => {
  // 1. Session holen
  const r0 = await fetch(`${BASE_URL}?lang=de`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
  });
  const html0 = await r0.text();
  const sessionCookie = (r0.headers.get('set-cookie')||'').match(/JSESSIONID=[^;]+/)?.[0] || '';
  const viewState = extractViewState(html0);
  const windowGuid = extractWindowGuid(html0);
  const catVal  = extractOptionValue(html0, 'U18 Frauen');
  const discVal = extractOptionValue(html0, '100 m');
  const typeVal = extractOptionValue(html0, 'Ein Resultat pro Athlet');

  console.log(`VS=${viewState?.slice(0,20)} GUID=${windowGuid?.slice(0,20)} cat=${catVal?.slice(0,20)} disc=${discVal?.slice(0,20)}`);

  const headers = {
    'User-Agent': 'Mozilla/5.0',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cookie': sessionCookie,
    'Referer': `${BASE_URL}?lang=de`,
  };

  // 2. Full Form POST mit allen Feldern
  const body = new URLSearchParams({
    'form_anonym': 'form_anonym',
    'form_anonym:bestlistYear': '2026',
    'form_anonym:bestlistSeason': 'false',
    'form_anonym:bestlistCategory': catVal,
    'form_anonym:bestlistDiscipline': discVal,
    'form_anonym:bestlistType': typeVal || '1',
    'form_anonym:bestlistTops': '30',
    'javax.faces.ViewState': viewState,
    'aeswindowguid': windowGuid,
  });

  const r1 = await fetch(`${BASE_URL}?lang=de`, { method:'POST', headers, body: body.toString() });
  const html1 = await r1.text();

  console.log(`\nFull POST: ${html1.length} Zeichen`);

  // Suche nach bekannten Athleten-Namen oder Zeitmuster
  const hasLeonie = html1.includes('Leonie');
  const hasTime   = /12\.\d{2}/.test(html1);
  const hasDataRi = /data-ri/.test(html1);
  const hasTr     = /<tr/.test(html1);
  console.log(`Leonie: ${hasLeonie} | Zeit 12.xx: ${hasTime} | data-ri: ${hasDataRi} | <tr>: ${hasTr}`);

  // Dump: Zeichen 20000–28000 (wo Resultate sein müssten)
  console.log('\n=== HTML[20000:28000] ===');
  console.log(html1.substring(20000, 28000));

})();
