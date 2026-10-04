/* Pure adapters shared by UI and regression tests. Source objects remain intact. */
(function(root) {
  const aliases = {'60 Metres':'60m','100 Metres':'100m','200 Metres':'200m','Long Jump':'Long Jump','Weitsprung':'Long Jump','LJ':'Long Jump','Speer':'Javelin Throw','Diskus':'Discus Throw','Kugel':'Shot Put','Hoch':'High Jump','100mH':'100m Hurdles','60mH':'60m Hurdles','100 Metres Hurdles':'100m Hurdles','60 Metres Hurdles':'60m Hurdles'};
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
    const rows = (Array.isArray(live)?live:live?.results||[]).filter(r=>discipline(r.discipline||r.name)===disc && number(r.score)>0)
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

  function teamRanking(data,roster,gender='Alle',disc='Alle') {
    const names=[...new Set([...roster.map(a=>a.name),...Object.keys(data||{})])];
    const rows=[];
    for(const name of names){
      const meta=roster.find(a=>a.name===name)||{name};
      if(gender!=='Alle'&&meta.gender!==gender)continue;
      const best=(data?.[name]?.discs||[]).slice().sort((a,b)=>(number(b.score)||0)-(number(a.score)||0)).slice(0,2);
      for(const d of best)if(disc==='Alle'||discipline(d.name||d.discipline)===disc)rows.push({...d,athleteName:name,meta,updated:data[name].updated});
      if(!best.length&&disc==='Alle')rows.push({athleteName:name,meta,name:'—',result:'—',score:null});
    }
    rows.sort((a,b)=>(number(b.score)||0)-(number(a.score)||0)||a.athleteName.localeCompare(b.athleteName));
    let rank=0,previous;
    rows.forEach((r,i)=>{const score=number(r.score);if(score>0){if(score!==previous)rank=i+1;r.rank=rank;previous=score;}else r.rank=null;});
    return rows;
  }
  function matchTeamPerformance(row,data){
    const mark=x=>String(x??'').trim().split(/\s+/)[0].replace(',','.').replace(/[^0-9:.]+$/,'');
    const same=r=>discipline(r.discipline||r.name)===discipline(row.name||row.discipline)&&mark(r.result||r.mark)===mark(row.result||row.mark)&&(!(number(row.score)>0&&number(r.score)>0)||number(row.score)===number(r.score));
    const results=(data?.results||[]).filter(same).sort((a,b)=>dateKey(a.date).localeCompare(dateKey(b.date)));
    if(results.length)return {...results[0],matchType:'result'};
    const pb=(data?.pbs||[]).find(same);return pb?{...pb,matchType:'pb'}:null;
  }
  function raceLabel(value){
    const raw=String(value??'').trim();if(!raw)return '—';
    const codes={h:'Vorlauf',v:'Vorlauf',r:'Serie',qf:'Viertelfinale',sf:'Halbfinale',f:'Finale'};
    const m=raw.match(/^(\d+)\s*(qf|sf|h|v|r|f)(\d*)$/i);
    if(m)return codes[m[2].toLowerCase()]+' · Rang '+Number(m[1])+(m[3]?' · Lauf '+Number(m[3]):'');
    const text=raw.match(/^(\d+)\.\s*(Lauf|Runde|Vorlauf|Halbfinale|Finale?)\s*(\d*)$/i);
    if(text){const phase=/^final/i.test(text[2])?'Finale':text[2];return /^(Lauf|Runde)$/i.test(phase)?phase+(text[3]?' '+Number(text[3]):'')+' · Rang '+Number(text[1]):phase+' · Rang '+Number(text[1])+(text[3]?' · Lauf '+Number(text[3]):'');}
    return /^\d+\.?$/.test(raw)?'Rang '+parseInt(raw,10):raw;
  }
  function resultTableRows(results){
    const field=r=>/Jump|Throw|Put|Hoch|Speer|Kugel|Diskus/.test(discipline(r.discipline));
    return (results||[]).slice().sort((a,b)=>{
      const date=dateKey(b.dateISO||b.date).localeCompare(dateKey(a.dateISO||a.date));if(date)return date;
      if(discipline(a.discipline)!==discipline(b.discipline))return 0;
      const av=number(a.numResult??a.result),bv=number(b.numResult??b.result);
      if(!Number.isFinite(av))return Number.isFinite(bv)?1:0;if(!Number.isFinite(bv))return -1;
      return field(a)?bv-av:av-bv;
    });
  }
  function chartResults(results,disc,year='Alle'){
    const phase=r=>{const m=String(r.place||'').match(/^\d+\s*(qf|sf|h|f|r|v)/i);return m?({h:0,v:0,r:0,qf:1,sf:2,f:3}[m[1].toLowerCase()]):null;};
    return (results||[]).filter(r=>discipline(r.discipline)===disc&&Number.isFinite(number(r.numResult??r.result))&&dateKey(r.dateISO||r.date)&&!r.windAssisted&&(!Number.isFinite(number(r.wind))||number(r.wind)<=2)&&(year==='Alle'||dateKey(r.dateISO||r.date).startsWith(String(year)))).slice().sort((a,b)=>{
      const byDate=dateKey(a.dateISO||a.date).localeCompare(dateKey(b.dateISO||b.date));if(byDate)return byDate;
      if((a.competition||'')!==(b.competition||''))return 0;const ap=phase(a),bp=phase(b);return ap!=null&&bp!=null?ap-bp:0;
    });
  }
  const api = {discipline,number,dateKey,isCompetition,trainingEvents,scoreRows,ranking,teamRanking,matchTeamPerformance,chartResults,raceLabel,resultTableRows};
  api.normalizeResults = data => ({...data,results:data.results.map(raw=>{
    const dateISO=dateKey(raw.dateISO||raw.date);
    return {...raw,discipline:discipline(raw.discipline),numResult:number(raw.numResult??raw.result),dateISO,year:raw.year||dateISO.slice(0,4)};
  })});
  root.FionaModels = api;
  if (typeof module!=='undefined') module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
