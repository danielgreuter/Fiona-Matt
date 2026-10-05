(() => {
  const M=window.FionaModels,H=window.FIONA_HISTORICAL;
  const sources={};
  let calendarRefresh=null;
  let saResults=[];
  const teamProfiles={},teamPending={};
  let teamLoading=false,profileMetadata={},rosterOpen=false;
  const state={rankDisc:'100m',rankYear:'2026',waDisc:'100m',waYear:'Alle',teamDisc:'Alle',teamGender:'Alle',calendarSource:'Fiona',calendarSearch:'',calendarPeriod:'Alle',weekOffset:0};
  const $=s=>document.querySelector(s);
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;return e;};
  const button=(label,callback,cls='tab')=>{const b=node('button',label,cls);b.type='button';b.onclick=callback;return b;};
  function select(label,values,value,change){const wrap=node('label',null,'control');wrap.append(node('span',label));const s=node('select',null,'select');for(const [v,l] of values.map(x=>Array.isArray(x)?x:[x,x])){const o=node('option',l);o.value=v;s.append(o);}s.value=value;s.onchange=()=>change(s.value);wrap.append(s);return wrap;}
  const discs=[['60m','60 m'],['100m','100 m'],['150m','150 m'],['200m','200 m'],['Long Jump','Weitsprung']];
  const value=(r)=>r?.result||r?.mark||'—';
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vaduz',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const safeLink=(label,url)=>{const a=node('a',label,'tab');try{const u=new URL(url);if(u.protocol!=='https:')return node('span',label);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';}catch{return node('span',label);}return a;};
  const card=(title,sub)=>{const c=node('section',null,'card');c.append(node('h2',title));if(sub)c.append(node('p',sub,'card-sub'));return c;};
  function status(parent,action){const r=sources[action];const refresh=button('↻ Aktualisieren',async()=>{if(action==='calendar')await refreshCalendar();else await window.FionaSources.loadOne(action,{force:true});});refresh.disabled=action==='calendar'&&!!calendarRefresh;parent.append(refresh);if(action==='calendar'&&calendarRefresh)parent.append(node('p','Kalender wird aktualisiert …','data-note')); parent.append(node('p',!r?'Quelle wird geladen …':r.status==='live'?'Quelle erreichbar · Abruf '+new Date(r.loadedAt).toLocaleString('de-CH'):r.status==='cache'?'Gespeicherter Abruf '+new Date(r.loadedAt).toLocaleString('de-CH')+' · Live-Quelle nicht erreichbar':'Live-Quelle nicht erreichbar · kein aktueller Abruf','data-note'));}
  function table(parent,headers,rows){const wrap=node('div',null,'table-wrap');const t=node('table',null,'data-table');const head=node('thead');const tr=node('tr');headers.forEach(h=>tr.append(node('th',h)));head.append(tr);t.append(head);const body=node('tbody');for(const item of rows){const r=node('tr');if(item.fiona)r.className='fiona-row';for(const cell of item.cells){const td=node('td');if(cell instanceof Element)td.append(cell);else td.textContent=String(cell??'—');r.append(td);}body.append(r);}t.append(body);wrap.append(t);parent.append(wrap);}
  function dateLabel(e){return e.date||e.start?.dateTime||e.start?.date||'';}
  function details(parent,record){const d=node('details');d.append(node('summary','Vollständige Details'),node('pre',JSON.stringify(record,null,2)));parent.append(d);}
  function openDetail(title){const dialog=$('#resultDetail');const body=$('#detailContent');body.classList.remove('team-result-detail');body.replaceChildren(node('h2',title));$('#closeDetail').onclick=()=>dialog.close();dialog.showModal();return body;}
  function renderRankings(){
    const root=$('#rankingsContent'),c=card('Schweiz / Liechtenstein · U18 Frauen','Historische Listen bleiben separat von aktuellen Saisonlisten.');
    const controls=node('div',null,'filters');controls.append(select('Disziplin',discs,state.rankDisc,v=>{state.rankDisc=v;renderRankings();}),select('Saison',['2026','2025','2024'],state.rankYear,v=>{state.rankYear=v;renderRankings();}));c.append(controls);status(c,'bestenliste');
    const rank=M.ranking(sources.bestenliste?.data,H.athlete,state.rankDisc,state.rankYear);
    if(rank.historical)c.append(node('p','Historischer eingebetteter V1-Stand · kein aktueller Rangnachweis','badge info'));
    if(rank.fiona)c.append(node('h3','Fiona · Rang '+(rank.fiona.rank||'nicht verfügbar')+' · '+value(rank.fiona)));
    if(rank.gapAhead)c.append(node('p','Abstand zu '+rank.ahead.name+' (Rang '+rank.ahead.rank+'): '+rank.gapAhead+(state.rankDisc==='Long Jump'?' m':' s')));
    if(rank.gapBehind)c.append(node('p','Vorsprung gegenüber '+rank.behind.name+': '+rank.gapBehind+(state.rankDisc==='Long Jump'?' m':' s')));
    if(rank.rows.length)table(c,['Rang','Athletin / Verein','Jahrgang','Leistung','Wind','Ort / Datum'],rank.rows.map(r=>{const isFiona=M.isFionaName(r.name)||r.isFiona||r.fiona;const person=node('div',null,'ranking-person');person.append(node('strong',r.name,'ranking-name'));if(r.club)person.append(node('span',r.club,'ranking-club'));const born=M.birthYear(r.born||r.birthDate||r.birthYear)||(isFiona?M.birthYear(window.FIONA_APP_CONFIG.athlete.birthDate):'');return{fiona:isFiona,cells:[r.rank,person,born||'—',value(r),r.wind??'—',[r.location||r.venue,r.date||r.comp_date].filter(Boolean).join(' · ')]};}));
    else c.append(node('p','Für diese Kombination sind keine Rangdaten vorhanden.'));
    root.replaceChildren(c);
  }
  function drawScoreChart(parent,rows,large=false){
    if(!rows.length){parent.append(node('p','Keine WA-Punkte für diesen Zeitraum.'));return;}
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),width=760,height=large?360:250,pad=45;
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','WA-Punkte im Zeitverlauf; höhere Werte stehen für mehr Punkte');svg.classList.add('score-chart');
    const ys=rows.map(r=>r.score),min=Math.min(...ys)-15,max=Math.max(...ys)+15;
    const times=rows.map(r=>Date.parse(r.dateISO+'T00:00:00Z'));const lo=Math.min(...times),hi=Math.max(...times);
    const x=i=>pad+(hi===lo?0.5:(times[i]-lo)/(hi-lo))*(width-2*pad),y=v=>height-pad-(v-min)/(max-min)*(height-2*pad);
    for(const v of [min,(min+max)/2,max]){const line=document.createElementNS(ns,'line');for(const [key,val] of Object.entries({x1:pad,x2:width-pad,y1:y(v),y2:y(v),stroke:'#e3e8f2'}))line.setAttribute(key,val);svg.append(line);const text=document.createElementNS(ns,'text');text.setAttribute('x',2);text.setAttribute('y',y(v)+4);text.setAttribute('fill','#66758c');text.textContent=Math.round(v);svg.append(text);}
    const path=document.createElementNS(ns,'path');path.setAttribute('d',rows.map((r,i)=>`${i?'L':'M'}${x(i)},${y(r.score)}`).join(' '));path.setAttribute('stroke','#2563eb');path.setAttribute('fill','none');path.setAttribute('stroke-width','3');svg.append(path);
    const bestIndex=rows.findIndex(r=>r.score===Math.max(...ys));const best=rows[bestIndex];const bestLabel=document.createElementNS(ns,'text');bestLabel.setAttribute('x',Math.min(width-pad,Math.max(pad,x(bestIndex))));bestLabel.setAttribute('y',Math.max(20,y(best.score)-15));bestLabel.setAttribute('text-anchor',x(bestIndex)>width/2?'end':'start');bestLabel.setAttribute('fill','#1e3a8a');bestLabel.setAttribute('font-weight','700');bestLabel.textContent=best.score+' Punkte · '+resultLabel({...best,discipline:state.waDisc});svg.append(bestLabel);
    rows.forEach((r,i)=>{const dot=document.createElementNS(ns,'circle');for(const [k,v] of Object.entries({cx:x(i),cy:y(r.score),r:5,fill:r.origin==='World Athletics'?'#2563eb':'#dc2626'}))dot.setAttribute(k,v);const title=document.createElementNS(ns,'title');title.textContent=r.date+' · '+resultLabel({...r,discipline:state.waDisc})+' · '+r.score+' Punkte · Wind '+windLabel(r)+' · '+r.origin;dot.append(title);dot.setAttribute('tabindex','0');dot.setAttribute('role','button');dot.setAttribute('aria-label',title.textContent);dot.onclick=()=>waResultDetail({...r,discipline:state.waDisc});dot.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();dot.onclick();}};svg.append(dot);});
    for(const i of [...new Set([0,Math.floor((rows.length-1)/2),rows.length-1])]){const label=document.createElementNS(ns,'text');label.setAttribute('x',x(i));label.setAttribute('y',height-10);label.setAttribute('text-anchor',i===0?'start':i===rows.length-1?'end':'middle');label.setAttribute('fill','#66758c');label.textContent=rows[i].dateISO;svg.append(label);}
    parent.append(svg);parent.append(node('p',rows[0].date+' → '+rows[rows.length-1].date+' · Abgerufene WA-Einzelresultate · Punkt antippen für Zeit und Wind','data-note'));
  }
  function waBrand(parent){const a=safeLink('','https://worldathletics.org/');a.className='wa-source-brand';const img=node('img');img.src='./assets/world-athletics-logo.svg';img.alt='World Athletics';img.width=180;img.height=40;a.append(img,node('span','Datenquelle'));parent.append(a);}
  const waResults=()=>{const data=sources.results?.data;return Array.isArray(data)?data:data?.results||[];};
  function windLabel(r){
    if(/\(i\)|indoor|short track/i.test([r.discipline,r.venue].join(' '))||r.indoor===true)return 'Halle';
    if(r.wind==null||String(r.wind).trim()==='')return 'nicht angegeben';
    const w=M.number(r.wind);return Number.isFinite(w)?(w>0?'+':'')+w.toFixed(1)+' m/s'+(w>2?' · windunterstützt':''):String(r.wind);
  }
  function resultLabel(r){const v=value(r);return v==='—'?v:v+(/Jump|Weitsprung|Throw|Put|Hoch|Speer|Kugel|Diskus/.test(r.discipline||r.name||'')?' m':' s');}
  function waResultDetail(r){const body=openDetail(state.waDisc+' · '+resultLabel(r));table(body,['Merkmal','Wert'],[['Datum',r.date],['Leistung',resultLabel(r)],['WA-Punkte',r.score>0?r.score:'nicht geliefert'],['Wind',windLabel(r)],['Lauf / Rang',M.raceLabel(r.place)],['Wettkampf',r.competition||'—'],['Ort',r.venue||'—'],['Quelle',r.origin||'World Athletics']].map(cells=>({cells})));waBrand(body);}
  function renderWA(){
    const root=$('#waContent'),c=card('WA-Punkte & Entwicklung','Leistungswerte pro Resultat · Zeit, Wind und Wettkampf im direkten Vergleich.');waBrand(c);
    const controls=node('div',null,'filters');controls.append(select('Disziplin',discs,state.waDisc,v=>{state.waDisc=v;renderWA();}),select('Zeitraum',['Alle','2026','2025','2024'],state.waYear,v=>{state.waYear=v;renderWA();}));c.append(controls);status(c,'results');
    const live=waResults(),latest=live.map(r=>M.dateKey(r.date)).filter(Boolean).sort().at(-1);
    if(latest)c.append(node('p','Neuester Einzelresultat-Eintrag der WA-Quelle: '+latest+' · Ein erfolgreicher Abruf bestätigt keinen vollständigen Saisonbestand.','data-note'));
    const raw=M.scoreRows(live,[],state.waDisc);
    const rows=raw.filter(r=>r.dateISO&&(state.waYear==='Alle'||r.dateISO.startsWith(state.waYear)));
    const filtered=live.filter(r=>M.discipline(r.discipline||r.name)===state.waDisc&&(state.waYear==='Alle'||M.dateKey(r.date).startsWith(state.waYear))).map(r=>({...r,origin:'World Athletics'}));
    const showTable=(parent,list)=>table(parent,['Datum','Zeit / Leistung','Lauf / Rang','WA-Punkte','Wind','Wettkampf / Ort'],list.map(r=>({cells:[r.date,button(resultLabel(r),()=>waResultDetail(r),'athlete-link'),M.raceLabel(r.place),r.score>0?r.score:'—',windLabel(r),[r.competition,r.venue].filter(Boolean).join(' · ')||'—']})));
    c.append(button('Chart vergrössern',()=>{const body=openDetail(state.waDisc+' · WA-Punkte');waBrand(body);drawScoreChart(body,rows,true);showTable(body,M.resultTableRows(filtered));}));drawScoreChart(c,rows);
    c.append(node('h3','Beste 5 Resultate nach WA-Punkten'));
    const top=filtered.filter(r=>M.number(r.score)>0).sort((a,b)=>b.score-a.score||M.dateKey(b.date).localeCompare(M.dateKey(a.date))).slice(0,5);
    if(top.length)showTable(c,top);else c.append(node('p','Keine WA-Einzelresultate mit Punkten für diesen Filter verfügbar.'));
    c.append(node('h3','Alle WA-Einzelresultate · '+state.waDisc));
    if(filtered.length)showTable(c,M.resultTableRows(filtered));else c.append(node('p','Keine Einzelresultate von der Quelle geliefert.'));
    const newer=saResults.filter(r=>M.discipline(r.discipline)===state.waDisc&&M.dateKey(r.dateISO||r.date)> (latest||'')&&(state.waYear==='Alle'||M.dateKey(r.dateISO||r.date).startsWith(state.waYear))).sort((a,b)=>M.dateKey(b.dateISO||b.date).localeCompare(M.dateKey(a.dateISO||a.date)));
    if(newer.length){c.append(node('h3','Neuere Resultate · Swiss Athletics'));c.append(node('p','Diese Resultate sind neuer als die WA-Einzelresultat-Liste. WA-Punkte werden für sie von der WA-Quelle bisher nicht geliefert.','data-note'));showTable(c,M.resultTableRows(newer).map(r=>({...r,score:null,origin:'Swiss Athletics'})));c.append(safeLink('Swiss-Athletics-Quelle','https://www.swiss-athletics.ch/'));}
    c.append(node('p','Punkte werden unverändert aus der Quelle übernommen. Fehlende Punkte oder Windwerte werden nicht geschätzt. Der Chart enthält ausschliesslich abgerufene WA-Einzelresultate.','data-note'));
    const pbs=sources.results?.data?.pbs||sources['wa-pbs']?.data?.pbs;
    if(pbs?.length){c.append(node('h3','Abgerufene Bestleistungen · World Athletics'));table(c,['Disziplin','Leistung','Punkte','Datum','Wind'],pbs.map(r=>({cells:[r.discipline,resultLabel(r),r.score>0?r.score:'—',r.date,windLabel(r)]})));c.append(node('p','Die PB-Liste ist eine separate Quellenliste. Ein PB-Eintrag ohne gelieferten Wind ist kein Nachweis eines regulären Resultats.','data-note'));}
    root.replaceChildren(c);
  }
  const teamMeta=name=>H.team.find(a=>a.name===name)||{name};
  function teamRows(){return M.teamRanking(sources.lieteam?.data,H.team,state.teamGender,state.teamDisc);}
  async function getTeamProfile(meta,force=false){
    if(!meta.url)return null;const key=meta.url;
    if(teamPending[key])return teamPending[key];
    if(!force&&teamProfiles[key]?.status==='live')return teamProfiles[key];
    teamPending[key]=(async()=>{
      let cached;try{cached=JSON.parse(localStorage.getItem('lie_ath_'+key));}catch{}
      if(!force&&cached?.d&&Date.now()-cached.t<6*3600000){return teamProfiles[key]={data:cached.d,status:'cache',loadedAt:cached.t};}
      try{const response=await fetch('https://fiona-proxy.daniel-greuter.workers.dev?action=athlete&slug='+encodeURIComponent(key),{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(!Array.isArray(data.results))throw Error('Unbekanntes Datenformat');const t=Date.now();try{localStorage.setItem('lie_ath_'+key,JSON.stringify({t,d:data}));}catch{}return teamProfiles[key]={data,status:'live',loadedAt:t};}
      catch{return teamProfiles[key]={data:cached?.d,status:cached?'cache':'unavailable',loadedAt:cached?.t};}
    })();try{return await teamPending[key];}finally{delete teamPending[key];}
  }
  async function loadTeamProfiles(force=false){
    if(teamLoading)return;teamLoading=true;renderTeam();
    try{for(let i=0;i<H.team.length;i+=3){await Promise.allSettled(H.team.slice(i,i+3).map(a=>getTeamProfile(a,force)));renderTeam();}}finally{teamLoading=false;renderTeam();}
  }
  const countryNames={SUI:'Schweiz',LIE:'Liechtenstein',AUT:'Österreich',GER:'Deutschland',ITA:'Italien',SLO:'Slowenien',SEN:'Senegal',MON:'Monaco',FRA:'Frankreich',GIB:'Gibraltar',MKD:'Nordmazedonien',CZE:'Tschechien',SVK:'Slowakei',CRO:'Kroatien',HUN:'Ungarn',ESP:'Spanien',GBR:'Grossbritannien',PER:'Peru'};
  const teamDiscLabel=d=>({'Javelin Throw':'Speer','Discus Throw':'Diskus','Shot Put':'Kugel','High Jump':'Hochsprung','Long Jump':'Weitsprung','100m Hurdles':'100 m Hürden','60m Hurdles':'60 m Hürden'}[M.discipline(d)]||M.discipline(d));
  function teamMatch(r){
    const match=M.matchTeamPerformance(r,teamProfiles[r.meta.url]?.data);if(!match||match.venue||r.athleteName!=='Fiona Matt')return match;
    const mark=x=>String(x||'').split(/\s+/)[0].replace(',','.');const supplementary=saResults.find(s=>M.discipline(s.discipline)===M.discipline(r.name||r.discipline)&&M.dateKey(s.dateISO||s.date)===M.dateKey(match.date)&&mark(s.result)===mark(value(r)));
    return supplementary?{...match,venue:supplementary.venue,competition:supplementary.competition,wind:supplementary.wind,indoor:supplementary.indoor,venueSource:'Swiss Athletics'}:match;
  }
  async function teamResultDetail(r){
    const root=openDetail(r.athleteName+' · '+teamDiscLabel(r.name||r.discipline));root.classList.add('team-result-detail');const hero=node('div',null,'result-detail-hero');hero.append(node('h3',value(r),'team-detail-mark'));root.append(hero,node('p',r.meta.club||'','card-sub'));waBrand(root);
    const loading=node('p','Lade Wettkampfdetails …','data-note');root.append(loading);await getTeamProfile(r.meta);if(!hero.isConnected||!$('#resultDetail').open)return;loading.remove();const match=teamMatch(r),record=teamProfiles[r.meta.url];
    if(match){const context=teamContext(r);root.append(context);if(match.variantConfirmed)root.append(node('p','Gelieferte Disziplin: '+match.discipline,'data-note'));}
    table(root,['Merkmal','Wert'],[['Leistung',value(r)],['WA-Punkte',M.number(r.score)>0?r.score:'nicht geliefert'],['Datum',match?.date||'nicht geliefert'],['Lauf / Rang',M.raceLabel(match?.place)],['Wind',match?windLabel(match):'nicht geliefert'],['Wettkampf',match?.competition||'nicht geliefert'],['Ort',match?.venue||'nicht geliefert']].map(cells=>({cells})));
    root.append(node('p',match?.venueSource?'Leistung/Punkte: World Athletics · Ort/Wind: passendes Swiss-Athletics-Resultat.':record?.status==='cache'?'World Athletics · gespeicherter Profilabruf.':'World Athletics · abgerufenes Profil.','data-note'));if(!match)root.append(node('p','Kein passender Einzelresultat-Nachweis geliefert. Fehlende Angaben werden nicht ergänzt.','data-note'));
    if(r.meta.url)root.append(safeLink('World-Athletics-Profil','https://worldathletics.org/athletes/liechtenstein/'+r.meta.url));details(root,{teamResult:r,matchedResult:match||null});
  }
  function teamContext(r){
    const record=teamProfiles[r.meta.url],match=teamMatch(r);
    const context=node('div',null,'team-meet');
    if(!record){context.append(node('span','Wettkampfdetails werden beim Öffnen geladen.'));return context;}
    if(!match){context.append(node('span',record.status==='unavailable'?'Wettkampfdetails nicht erreichbar':'Kein passender Einzelresultat-Nachweis geliefert'));return context;}
    const country=match.country||match.venue?.match(/\(([A-Z]{3})\)/)?.[1]||'';
    const emblem=eventEmblem({...match,country});if(emblem)context.append(emblem);
    const info=node('div');info.append(node('span',[match.date,match.competition].filter(Boolean).join(' · ')||'Datum / Wettkampf nicht geliefert'));
    if(match.venue)info.append(node('span',(country&&country!=='SUI'?(countryNames[country]||country)+' · ':'')+match.venue));
    else info.append(node('span','Wettkampfort nicht geliefert'));
    if(record.status==='cache')info.append(node('span','Gespeicherter Profilabruf · '+new Date(record.loadedAt).toLocaleDateString('de-CH')));
    info.title=info.textContent;context.append(info);return context;
  }
  function profileBirth(meta){return teamProfiles[meta.url]?.data?.birthDate||profileMetadata[meta.url]?.birthDate||'';}
  function birthLabel(born){const iso=M.dateKey(born);return iso?iso.split('-').reverse().join('.'):/^\d{4}$/.test(born)?'Jahrgang '+born+' · genaues Datum nicht veröffentlicht':'nicht veröffentlicht';}
  function profileFacts(root,meta){const born=profileBirth(meta),year=Number(today().slice(0,4));const facts=node('div',null,'team-profile-facts');facts.append(node('span','Geboren: '+birthLabel(born)),node('span','Verein: '+(meta.club||'nicht geliefert')),node('span','Alterskategorie '+year+': '+M.ageCategory(born,year)));root.append(facts);}
  async function athleteDetail(name,disc='100m'){
    const meta=teamMeta(name),root=openDetail(name+' · Athletenprofil');root.classList.add('team-result-detail');waBrand(root);profileFacts(root,meta);
    const progress=node('p','Lade alle Bestleistungen …','data-note');root.append(progress);const record=await getTeamProfile(meta);if(!progress.isConnected||!$('#resultDetail').open)return;const individual=record?.data;
    progress.textContent=record?.status==='live'?'World Athletics · abgerufenes Profil':record?.status==='cache'?'World Athletics · gespeicherter Profilabruf':'Profil momentan nicht erreichbar.';
    const pbs=individual?.pbs||individual?.personalBests||[];
    root.append(node('h3','Alle Bestleistungen · '+pbs.length+' Disziplinen'));
    if(pbs.length){table(root,['Disziplin','Bestleistung / Datum'],pbs.map(r=>{const cell=node('div');cell.append(node('strong',value(r)),node('span',r.date||'Datum nicht geliefert','pb-date'));const matched=(individual.results||[]).find(x=>x.discipline===r.discipline&&M.dateKey(x.date)===M.dateKey(r.date)&&value(x).split(' ')[0]===value(r).split(' ')[0]);if(matched?.wind)cell.append(node('span','Wind: '+windLabel(matched),'pb-date'));if(M.number(r.score)>0)cell.append(node('span',r.score+' WA-Punkte','pb-date'));if(r.records?.length)cell.append(node('span',r.records.join(' · '),'pb-date'));const label=teamDiscLabel(r.discipline).replace(/^Javelin Throw/,'Speer').replace(/^Discus Throw/,'Diskus').replace(/^Shot Put/,'Kugel').replace(/^High Jump/,'Hochsprung').replace(/^Long Jump/,'Weitsprung').replace(/Hurdles/,'Hürden')+(/Short Track|Indoor/i.test(r.discipline)?' · Halle':'');return {cells:[label,cell]};}));}
    else root.append(node('p','Keine Bestleistungsübersicht geliefert.'));
    root.append(node('p','Alle vom WA-Profil gelieferten Disziplinen, inklusive Halle, früherer Altersklassen, Hürdenhöhen und Wurfgewichte. Die Quelle kann unvollständig sein. Alterskategorie nach Jahrgang, nicht nach dem heutigen Geburtstag.','data-note'));
    if(individual?.results){const field=/Jump|Throw|Put/.test(disc),rows=individual.results.filter(r=>M.discipline(r.discipline)===disc).sort((a,b)=>{const av=M.number(value(a)),bv=M.number(value(b));return field?bv-av:av-bv;}).slice(0,5);const recent=node('details');recent.append(node('summary','Top 5 · '+teamDiscLabel(disc)+' · nach Leistung'));table(recent,['Datum','Resultat','Wind','Ort'],rows.map(r=>({cells:[r.date,value(r),windLabel(r),r.venue||r.competition||'nicht geliefert']})));root.append(recent);}
    if(meta.url)root.append(safeLink('World-Athletics-Profil','https://worldathletics.org/athletes/liechtenstein/'+meta.url));if(profileMetadata[meta.url])root.append(node('p','Geburtsangabe: WA-Profil · geprüft '+profileMetadata[meta.url].checkedAt,'data-note'));if(individual)details(root,individual);
  }
  function renderTeam(){
    if(!window.document)return;
    const root=$('#teamContent'),c=card('Team LIE · Leistungsranking','Pro Athlet:in die zwei Disziplinen mit den höchsten gelieferten WA-Punkten. Alle Leistungen werden gemeinsam nach Punkten rangiert.');waBrand(c);
    const controls=node('div',null,'filters');controls.append(select('Disziplin',[['Alle','Alle · Top 2 pro Athlet:in'],...new Set([...discs.map(d=>d[0]),...Object.values(sources.lieteam?.data||{}).flatMap(a=>(a.discs||[]).map(d=>M.discipline(d.name||d.discipline)))])],state.teamDisc,v=>{state.teamDisc=v;renderTeam();}),select('Kategorie',[['Alle','Alle'],['f','Frauen'],['m','Männer']],state.teamGender,v=>{state.teamGender=v;renderTeam();}));c.append(controls);status(c,'lieteam');c.append(button(teamLoading?'Wettkampfdetails werden geladen …':'Wettkampfdetails aktualisieren',()=>loadTeamProfiles(true)));
    const rows=teamRows(),max=Math.max(1,...rows.map(r=>M.number(r.score)||0));
    for(const r of rows){
      const box=node('article',null,'team-ranking-row'+(r.athleteName==='Fiona Matt'?' fiona-row':''));box.append(node('span',r.rank||'—','team-rank'));
      const info=node('div',null,'team-ranking-info');info.append(button(r.athleteName,()=>athleteDetail(r.athleteName,M.discipline(r.name||r.discipline)),'athlete-link'),node('span',r.meta.club||'','card-sub'));
      const performance=node('div',null,'team-ranking-performance');performance.append(button(teamDiscLabel(r.name||r.discipline)+(/Short Track|Indoor/i.test(r.name||r.discipline||'')?' (Halle)':'')+' · '+value(r)+' ↗',()=>teamResultDetail(r),'team-result-button'),teamContext(r));info.append(performance);
      const points=node('strong',M.number(r.score)>0?r.score+' Punkte':'keine Punkte','team-points');box.append(info,points);
      const bar=node('div',null,'comparison-track'),fill=node('span');fill.style.width=Math.max(0,(M.number(r.score)||0)/max*100)+'%';bar.append(fill);box.append(bar);c.append(box);
    }
    if(!rows.length)c.append(node('p','Keine Teamdaten für diesen Filter verfügbar.'));
    c.append(node('p','Gleiche Punktzahl = gleicher Rang. Ohne Punkte wird kein Rang vergeben. Werden weniger als zwei Disziplinen geliefert, zeigen wir nur die vorhandenen. WA-Leistungspunkte vergleichen einzelne Leistungen, nicht das offizielle World Ranking.','data-note'));
    const roster=node('details',null,'team-roster');roster.open=rosterOpen;roster.ontoggle=()=>{if(roster.isConnected)rosterOpen=roster.open;};roster.append(node('summary','Athlet:innen & Profile'));for(const a of H.team){const line=node('article',null,'team-profile-card'+(a.isMe?' fiona-row':''));line.append(button(a.name,()=>athleteDetail(a.name),'athlete-link'));profileFacts(line,a);const pbs=teamProfiles[a.url]?.data?.pbs;line.append(button('Alle Bestleistungen'+(pbs?' · '+pbs.length+' Disziplinen':'')+' ↗',()=>athleteDetail(a.name),'team-profile-open'));roster.append(line);}c.append(roster);root.replaceChildren(c);
  }
  function eventEmblem(e){
    const cantons='ZH BE LU UR SZ OW NW GL ZG FR SO BS BL SH AR AI SG GR AG TG TI VD VS NE GE JU'.split(' ');
    let code=String(e.canton||'').toUpperCase();const loc=[e.venue,e.venueCity,e.location].filter(x=>typeof x==='string').join(' ').toLowerCase();
    if(!code){for(const [city,canton]of [['zürich','ZH'],['zurich','ZH'],['lausanne','VD'],['luzern','LU'],['aarau','AG'],['meilen','ZH'],['cham','ZG'],['schaffhausen','SH'],['macolin','BE'],['basel','BS'],['thun','BE'],['magglingen','BE'],['langenthal','BE'],['bellinzona','TI'],['freiburg','FR'],['fribourg','FR'],['freienbach','SZ'],['frauenfeld','TG'],['st. gallen','SG'],['winterthur','ZH'],['kreuzlingen','TG'],['bulle','FR'],['zug','ZG'],['zofingen','AG'],['uster','ZH'],['düdingen','FR'],['delémont','JU'],['rapperswil','SG'],['arbon','TG']])if(loc.includes(city)){code=canton;break;}}
    let src='',alt='';if(cantons.includes(code)){const local={BE:'bern',VD:'vaud',SG:'st-gallen',ZH:'zurich',ZG:'zug',TG:'thurgau',TI:'ticino',FR:'fribourg'};src=local[code]?'./assets/'+local[code]+'-coat.svg':'https://fiona-proxy.daniel-greuter.workers.dev?action=wappen&v=3&c='+code;alt='Kantonswappen '+code;}
    else {const country=String(e.country||[e.venue,e.venueCity,e.location].filter(x=>typeof x==='string').join(' ').match(/\(([A-Z]{3})\)/)?.[1]||'').toUpperCase();if(['LIE','LI'].includes(country)||/schaan|vaduz|mauren|liechtenstein/.test(loc)){src='./assets/liechtenstein-flag.webp';alt='Liechtenstein';}else if(country==='SEN'||loc.includes('dakar')){src='./assets/senegal-flag.svg';alt='Senegal';}else {const local={AUT:'austria',SLO:'slovenia',PER:'peru',ITA:'italy',MKD:'north-macedonia'};if(local[country]){src='./assets/'+local[country]+'-flag.svg';alt='Flagge '+(countryNames[country]||country);}else {const iso={GER:'de',FRA:'fr',MON:'mc',GIB:'gi',CZE:'cz',SVK:'sk',CRO:'hr',HUN:'hu',ESP:'es',GBR:'gb',SUI:'ch'}[country];if(iso){src='https://flagcdn.com/'+iso+'.svg';alt='Flagge '+(countryNames[country]||country);}}}}
    if(!src)return null;const img=node('img',null,'event-emblem');img.src=src;img.alt=alt;img.width=28;img.height=32;img.loading='lazy';img.onerror=()=>{img.hidden=true;};return img;
  }
  function eventRow(parent,e,editable=false){
    const box=node('article',null,'calendar-event');const heading=node('div',null,'event-heading');const emblem=eventEmblem(e);if(emblem)heading.append(emblem);const title=node('div');title.append(node('div',dateLabel(e),'event-date'),node('h3',e.name||e.title||e.summary||'Termin'));heading.append(title);box.append(heading);const location=e.venue||(typeof e.location==='string'?e.location:'');if(location)box.append(node('p',location));
    const comment=e.comment||e.description||e.details||e.note;if(comment)box.append(node('p',comment,'event-comment'));
    const tags=[...(M.isCompetition(e)?e.disciplines||[]:[]),e.fionaStarting?'Fiona startet':'',e.deadline?'Meldeschluss: '+e.deadline:'',e.time||e.startTime||''].filter(Boolean);if(tags.length)box.append(node('p',tags.join(' · '),'data-note'));
    const actions=node('div',null,'tabs');actions.append(button('Details',()=>{const root=openDetail(e.name||e.title||'Termin');eventRow(root,e,false);details(root,e);}));if(editable&&e.id!=null)actions.append(button('Bearbeiten',()=>eventEditor(e)),button('Löschen',()=>deleteEvent(e)));box.append(actions);parent.append(box);
  }
  function renderCalendar(){
    const root=$('#calendarContent'),c=card('Wettkämpfe','Fionas Kalender und Schweizer Veranstaltungen bleiben getrennt.');const controls=node('div',null,'filters');controls.append(select('Quelle',['Fiona','Schweiz'],state.calendarSource,v=>{state.calendarSource=v;renderCalendar();}),select('Zeitraum',['Kommende','Alle','Vergangene'],state.calendarPeriod,v=>{state.calendarPeriod=v;renderCalendar();}));
    const search=node('input',null,'select');search.type='search';search.placeholder='Ort oder Wettkampf suchen';search.setAttribute('aria-label','Ort oder Wettkampf suchen');search.value=state.calendarSearch;search.onchange=()=>{state.calendarSearch=search.value;renderCalendar();};controls.append(search,button('Wettkampf hinzufügen',()=>eventEditor()));c.append(controls);
    const action=state.calendarSource==='Fiona'?'calendar':'chcalendar';status(c,action);
    let events=state.calendarSource==='Fiona'?(sources.calendar?.data||H.athlete.upcoming||[]):(sources.chcalendar?.data?.events||[]);
    if(state.calendarSource==='Fiona'&&sources.calendar?.data)events=events.filter(M.isCompetition);
    if(state.calendarSource==='Fiona'&&!sources.calendar?.data)c.append(node('p','Historischer V1-Kalender · Termine und Teilnahmestatus können überholt sein.','data-note'));
    events=events.filter(e=>{const d=M.dateKey(e.date||e.start);return state.calendarPeriod==='Alle'||d&&(state.calendarPeriod==='Kommende'?d>=today():d<today());}).filter(e=>JSON.stringify(e).toLocaleLowerCase('de').includes(state.calendarSearch.toLocaleLowerCase('de'))).slice().sort((a,b)=>M.dateKey(a.date||a.start).localeCompare(M.dateKey(b.date||b.start)));
    const future=events.filter(e=>M.dateKey(e.date||e.start)>=today());c.append(node('p',events.length+' Wettkämpfe in dieser Ansicht · '+future.length+' kommende. Der Kalender zeigt den gelieferten Quellenstand.','data-note'));
    const liveEditable=state.calendarSource==='Fiona'&&sources.calendar?.status==='live';for(const e of events)eventRow(c,e,liveEditable);if(!events.length)c.append(node('p','Keine Wettkämpfe für diesen Filter.'));root.replaceChildren(c);
  }
  async function mutation(action,body){
    const response=await fetch('https://fiona-proxy.daniel-greuter.workers.dev?action='+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('HTTP '+response.status);const result=await response.json();if(!result.ok)throw Error(result.error||'Speichern fehlgeschlagen');
    // Reload only after confirmed save. Failed writes never alter displayed source data.
    await refreshCalendar();return result;
  }
  function eventEditor(event){
    const root=openDetail(event?'Wettkampf bearbeiten':'Wettkampf hinzufügen');const form=node('form',null,'event-form');const fields={};
    for(const [key,label,type,initial]of [['date','Datum','date',M.dateKey(event?.date)],['name','Wettkampf','text',event?.name],['venue','Ort','text',event?.venue],['disciplines','Disziplinen, durch Komma getrennt','text',(event?.disciplines||[]).join(', ')],['deadline','Meldeschluss','text',event?.deadline]]){const l=node('label',null,'control');l.append(node('span',label));const input=node('input',null,'select');input.type=type;input.value=initial||'';input.required=key==='date'||key==='name';fields[key]=input;l.append(input);form.append(l);}
    const check=node('input');check.type='checkbox';check.checked=!!event?.fionaStarting;const label=node('label','Fiona startet ');label.append(check);form.append(label);const status=node('p',null,'data-note');const submit=node('button','Speichern','tab');submit.type='submit';form.append(submit,status);root.append(form);
    form.onsubmit=async e=>{e.preventDefault();const iso=fields.date.value;if(!M.dateKey(iso)||!fields.name.value.trim()){status.textContent='Gültiges Datum und Wettkampfname sind erforderlich.';return;}const parts=iso.split('-');const body={date:parts.reverse().join('.'),name:fields.name.value.trim(),venue:fields.venue.value.trim(),disciplines:fields.disciplines.value.split(',').map(s=>s.trim()).filter(Boolean),deadline:fields.deadline.value.trim(),fionaStarting:check.checked};if(event)body.id=event.id;submit.disabled=true;status.textContent='Speichere …';try{await mutation(event?'calendar-update':'calendar-add',body);status.textContent='Gespeichert.';$('#resultDetail').close();}catch(error){status.textContent='Nicht gespeichert: '+error.message;submit.disabled=false;}};
  }
  function deleteEvent(event){const root=openDetail('Wettkampf löschen?');root.append(node('p',event.name+' · '+event.date));const status=node('p',null,'data-note');const confirm=button('Diesen Wettkampf löschen',async()=>{confirm.disabled=true;try{await mutation('calendar-delete',{id:event.id});$('#resultDetail').close();}catch(error){status.textContent='Nicht gelöscht: '+error.message;confirm.disabled=false;}});root.append(confirm,status);}
  function renderTraining(){
    const root=$('#liveTraining');root.replaceChildren();status(root,'calendar');
    const controls=node('div',null,'tabs');controls.append(button('← Vorige Woche',()=>{state.weekOffset--;renderTraining();}),button('Diese Woche',()=>{state.weekOffset=0;renderTraining();}),button('Nächste Woche →',()=>{state.weekOffset++;renderTraining();}));root.append(controls);
    const now=new Date(today()+'T12:00:00Z');const day=(now.getUTCDay()+6)%7;now.setUTCDate(now.getUTCDate()-day+state.weekOffset*7);const start=now.toISOString().slice(0,10);now.setUTCDate(now.getUTCDate()+6);const end=now.toISOString().slice(0,10);root.append(node('h3',start+' — '+end));
    const events=M.trainingEvents(sources.calendar?.data||[]).filter(e=>{const d=M.dateKey(e.date||e.start);return d>=start&&d<=end;});
    for(const e of events){const text=(e.name+' '+(e.comment||e.description||'')).toLowerCase();const type=/wicket/.test(text)?'Wickets':/max.?v|velocity|max.?speed/.test(text)?'Max Velocity':/accel|beschleunig|block/.test(text)?'Acceleration':/speed endurance|schnelligkeitsausdauer/.test(text)?'Speed Endurance':/kraft|gym|strength/.test(text)?'Kraft':/recovery|erholung|pause/.test(text)?'Recovery':'Training';const badge=node('p',type+' · aus Kalendertext erkannt','badge info');root.append(badge);eventRow(root,e);}
    if(!events.length)root.append(node('p','Keine Kalendereinträge für diese Woche verfügbar. Die Grundstruktur steht darunter.'));
  }

  async function refreshCalendar(){
    if(calendarRefresh)return calendarRefresh;
    calendarRefresh=window.FionaSources.loadOne('calendar',{force:true});
    renderTraining();renderCalendar();
    try{return await calendarRefresh;}finally{calendarRefresh=null;renderTraining();renderCalendar();}
  }
  const calendarVisible=()=>['training','calendar'].some(view=>$('#view-'+view).classList.contains('active'));
  const calendarStale=()=>!sources.calendar || sources.calendar.status!=='live' || Date.now()-Date.parse(sources.calendar.loadedAt)>60000;
  window.addEventListener('fiona-view',event=>{
    if(event.detail.view==='team')loadTeamProfiles();
    if(['training','calendar'].includes(event.detail.view))refreshCalendar();
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&calendarVisible()&&calendarStale())refreshCalendar();});
  window.addEventListener('pageshow',event=>{if(event.persisted&&calendarVisible())refreshCalendar();});
  window.addEventListener('online',()=>{if(calendarVisible())refreshCalendar();});
  setInterval(()=>{if(document.visibilityState==='visible'&&calendarVisible())refreshCalendar();},300000);
  window.addEventListener('fiona-results',event=>{saResults=event.detail.results||[];renderWA();renderTeam();});
  window.addEventListener('fiona-source',event=>{sources[event.detail.action]=event.detail;renderRankings();renderWA();renderTeam();renderCalendar();renderTraining();});
  renderRankings();renderWA();renderTeam();renderCalendar();renderTraining();
  if($('#view-team').classList.contains('active'))loadTeamProfiles();
  fetch('./team-profile-metadata.json').then(r=>r.ok?r.json():{}).then(data=>{profileMetadata=data||{};renderTeam();}).catch(()=>{});
  window.FionaMigrationUI={openAthleteProfile:athleteDetail,state,sources,renderRankings,renderWA,renderTeam,renderCalendar,renderTraining};
})();
