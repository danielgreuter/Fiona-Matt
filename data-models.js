/* Pure adapters shared by UI and regression tests. Source objects remain intact. */
(function(root) {
  const aliases = {'60 Metres':'60m','100 Metres':'100m','200 Metres':'200m','Long Jump':'Long Jump','Weitsprung':'Long Jump','LJ':'Long Jump'};
  const months = {jan:1,feb:2,mar:3,mär:3,apr:4,may:5,mai:5,jun:6,jul:7,aug:8,sep:9,oct:10,okt:10,nov:11,dec:12,dez:12};
  const discipline = value => {
    if (aliases[value]) return aliases[value];
    const s=String(value||'').replace(/\s*\((?:Indoor|Short Track)\)/gi,'').replace(/\s+(?:Indoor|Short Track|Halle)$/i,'').trim();
    return aliases[s]||s.replace(/\s+Metres?/gi,'m').replace(/\s+m$/,'m');
  };
  const number = value => value === '' || value == null ? NaN : Number(String(value).replace(',','.'));
  function dateKey(value) {
    if (!value) return '';
    const text = typeof value === 'object' ? value.dateTime || value.date || '' : String(value);
    let parts = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (parts) return validDate(+parts[1],+parts[2],+parts[3]);
    parts = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (parts) return validDate(+parts[3],+parts[2],+parts[1]);
    parts = text.match(/^(\d{1,2})\s+([A-Za-zäÄ]+)\s+(\d{4})$/);
    if (parts) return validDate(+parts[3],months[parts[2].toLowerCase()],+parts[1]);
    parts = text.match(/^([A-Za-zäÄ]+)\s*'(\d{2})[a-z]?$/);
    if (parts) return validDate(2000+Number(parts[2]),months[parts[1].toLowerCase()],1);
    return '';
  }
  function validDate(year,month,day) {
    const d = new Date(Date.UTC(year,month-1,day));
    return d.getUTCFullYear()===year && d.getUTCMonth()+1===month && d.getUTCDate()===day ? d.toISOString().slice(0,10) : '';
  }
  const isCompetition = e => typeof e.isWettkampf === 'boolean' ? e.isWettkampf : /^WK[:\s]/i.test(e.name || e.title || e.summary || '');
  function trainingEvents(events) {
    const unique = new Map();
    for (const e of events.filter(e=>!isCompetition(e))) {
      const key = (e.name||e.title||e.summary||'').trim()+'|'+(dateKey(e.date||e.start)||e.date||'');
      const content = x=>String(x.comment||x.description||x.details||'').length;
      if (!unique.has(key) || content(e)>content(unique.get(key))) unique.set(key,e);
    }
    return [...unique.values()].sort((a,b)=>dateKey(a.date||a.start).localeCompare(dateKey(b.date||b.start)));
  }
  function scoreRows(live,history,disc) {
    const rows = (live||[]).filter(r=>discipline(r.discipline||r.name)===disc && number(r.score)>0)
      .map(r=>({...r,score:number(r.score),dateISO:dateKey(r.date),origin:'World Athletics'}));
    for (const h of history||[]) {
      const dateISO = dateKey(h.label);
      // Same points in another month remain a distinct observation.
      if (!rows.some(r=>r.dateISO.slice(0,7)===dateISO.slice(0,7)&&r.score===number(h.val))) {
        rows.push({date:h.label,dateISO,score:number(h.val),result:'',origin:'Historischer V1-Stand'});
      }
    }
    return rows.filter(r=>r.score>0).sort((a,b)=>a.dateISO.localeCompare(b.dateISO));
  }
  function ranking(data,historical,disc,year) {
    const candidates = [data?.disciplines?.[disc+'_'+year],data?.disciplines?.[disc]];
    const live = candidates.find(r=>r&&String(r.year)===String(year)&&Array.isArray(r.top15));
    const rows = (live?.top15 || historical.top10Static?.[disc]?.[year] || []).map(r=>({...r}));
    const fiona = live?.fiona || historical.rankingData?.[disc]?.[year];
    if (fiona && !rows.some(r=>r.name==='Fiona Matt'||r.isFiona||r.fiona)) rows.push({...fiona,name:'Fiona Matt',club:historical.club});
    rows.sort((a,b)=>(number(a.rank)||Infinity)-(number(b.rank)||Infinity));
    const index = rows.findIndex(r=>r.name==='Fiona Matt'||r.isFiona||r.fiona);
    const ahead = index>0 && number(rows[index-1].rank)===number(rows[index].rank)-1 ? rows[index-1] : null;
    const behind = index>=0 && rows[index+1] && number(rows[index+1].rank)===number(rows[index].rank)+1 ? rows[index+1] : null;
    const gap = other => other && Number.isFinite(number(other.result)) && Number.isFinite(number(fiona?.result)) ? Math.abs(number(fiona.result)-number(other.result)).toFixed(2) : null;
    return {rows,fiona,ahead,behind,gapAhead:gap(ahead),gapBehind:gap(behind),historical:!live,year,disc};
  }
  const api = {discipline,number,dateKey,isCompetition,trainingEvents,scoreRows,ranking};
  api.normalizeResults = data => ({...data,results:data.results.map(raw=>{
    const dateISO=dateKey(raw.dateISO||raw.date);
    return {...raw,discipline:discipline(raw.discipline),numResult:number(raw.numResult??raw.result),dateISO,year:raw.year||dateISO.slice(0,4)};
  })});
  root.FionaModels = api;
  if (typeof module!=='undefined') module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
