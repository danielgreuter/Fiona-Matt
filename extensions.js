(() => {
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;};
  const panels=document.querySelector('#sourcePanels');
  const records={};
  let resultObserver;
  function row(parent,label,value,note='',performance=null) {
    const n=el('div',null,'result');const main=el('div',null,'result-main');
    const heading=el('strong',label);const emblem=performance&&window.FionaMigrationUI?.eventEmblem(performance);if(emblem){emblem.classList.add('result-location-emblem');heading.prepend(emblem);}main.append(heading,el('span',note));n.append(main,el('strong',value));parent.append(n);
  }
  function render(record){
    records[record.action]=record;
    const card=el('section',null,'card span-12');card.append(el('h2',record.title));
    card.append(el('p',record.status==='live'?'Quelle erreichbar · abgerufen '+new Date(record.loadedAt).toLocaleString('de-CH'):record.status==='cache'?'Gespeicherter Stand · '+new Date(record.loadedAt).toLocaleString('de-CH'):'Quelle momentan nicht erreichbar','data-note'));
    const d=record.data;
    if(d){const count=Array.isArray(d)?d.length:Array.isArray(d.results)?d.results.length:Array.isArray(d.events)?d.events.length:Array.isArray(d.pbs)?d.pbs.length:record.action==='lieteam'?Object.keys(d).length:Object.keys(d.disciplines||{}).length;card.append(el('p',count+' Einträge / Bereiche verfügbar'));}
    if(d){const raw=el('details');raw.append(el('summary','Vollständige Quelldaten'),el('pre',JSON.stringify(d,null,2)));card.append(raw);}
    else card.append(el('p','Alle bisherigen Ansichten und gespeicherten Informationen bleiben über „Bisherige App“ erreichbar.'));
    card.dataset.source=record.action;
    const previous=[...panels.children].find(c=>c.dataset.source===record.action);
    if(previous)previous.replaceWith(card);else panels.append(card);
  }
  window.addEventListener("fiona-source",event=>render(event.detail));
  window.FionaSources.loadAll(()=>{});
  window.addEventListener('fiona-results',event=>{
    const data=event.detail;const results=data.results||[];
    const legal=r=>!r.windAssisted&&(!Number.isFinite(parseFloat(String(r.wind).replace(',','.')))||parseFloat(String(r.wind).replace(',','.'))<=2);
    const sprint=results.filter(r=>r.discipline==='100m'&&legal(r)&&Number.isFinite(r.numResult));
    const last=sprint.slice().sort((a,b)=>String(b.dateISO).localeCompare(String(a.dateISO))).slice(0,5);
    const top=sprint.slice().sort((a,b)=>a.numResult-b.numResult).slice(0,5);
    const section=el('section',null,'card span-12');section.append(el('h2','100 m · Performance Center'));
    if(last.length){const mean=last.reduce((s,r)=>s+r.numResult,0)/last.length;row(section,'Letzte '+last.length+' reguläre Läufe · Mittelwert',mean.toFixed(2)+' s');row(section,'Spanne der letzten Läufe',(Math.max(...last.map(r=>r.numResult))-Math.min(...last.map(r=>r.numResult))).toFixed(2)+' s');}
    section.append(el('h3','Top 5 · reguläre Zeiten'));
    top.forEach(r=>row(section,r.date+' · '+r.venue,r.result+' s','Wind '+(r.wind||'nicht angegeben'),r));
    const assisted=results.filter(r=>r.discipline==='100m'&&!legal(r)).sort((a,b)=>a.numResult-b.numResult);
    if(assisted.length){section.append(el('h3','Windunterstützt · separat'));assisted.forEach(r=>row(section,r.date+' · '+r.venue,r.result+' s','Wind '+r.wind,r));}
    section.append(el('h3','PB-Historie · 100 m'));let best=Infinity;
    sprint.slice().sort((a,b)=>String(a.dateISO).localeCompare(String(b.dateISO))).forEach(r=>{if(r.numResult<best){best=r.numResult;row(section,r.date,r.result+' s',r.venue,r);}});
    section.id='performanceCenter';const previous=document.querySelector('#performanceCenter');if(previous)previous.replaceWith(section);else document.querySelector('#view-analysis .grid').append(section);
    const detail=document.querySelector('#resultDetail');
    document.querySelector('#closeDetail').onclick=()=>detail.close();
    document.onclick=e=>{
      const target=e.target.closest('.result[data-result-index]');if(!target)return;
      const r=results[Number(target.dataset.resultIndex)];if(!r)return;
      const box=document.querySelector('#detailContent');box.replaceChildren();
      const hero=el('div',null,'result-detail-hero');hero.append(el('span',r.disciplineLabel||r.discipline,'badge info'),el('h2',r.result,'detail-performance'),el('p',r.competition||'Wettkampf','detail-competition'),el('p',[r.date,r.venue].filter(Boolean).join(' · '),'card-sub'));box.append(hero);
      const facts=el('div',null,'detail-facts');
      for(const [label,value]of [['Wind',r.indoor?'Halle':r.wind!=null&&r.wind!==''?r.wind+' m/s':'nicht geliefert'],['Lauf / Rang',window.FionaModels.raceLabel(r.place)],['WA-Punkte',r.score||r.waScore||'nicht geliefert'],['Quelle',r.source==='world-athletics'?'World Athletics':'Swiss Athletics']]){const cell=el('div');cell.append(el('span',label),el('strong',value));facts.append(cell);}box.append(facts);
      if(r.windAssisted)box.append(el('p','Windunterstützt · separat von regulären Bestleistungen','data-note'));
      if(r.top5?.length){const isOwn=entry=>{const name=String(entry.name||'').toLowerCase().trim().split(/\s+/);return name.includes('fiona')&&name.includes('matt');};const competitionRows=r.top5.slice();const hasFiona=competitionRows.some(isOwn);if(!hasFiona)competitionRows.push({name:'Fiona Matt',club:window.FIONA_APP_CONFIG.athlete.club,rank:r.fionaRank??window.FionaModels.raceLabel(r.place),result:r.result,wind:r.wind});box.append(el('h3',hasFiona?'Wettkampf · Top 5':'Wettkampf · Top 5 & Fiona')); const wrap=el('div',null,'table-wrap'),table=el('table',null,'data-table'),head=el('thead'),hr=el('tr');for(const label of ['Rang','Athlet:in / Verein','Leistung','Wind'])hr.append(el('th',label));head.append(hr);table.append(head);const body=el('tbody');for(const entry of competitionRows){const isFiona=isOwn(entry);const tr=el('tr',null,isFiona?'fiona-result-row':'');if(isFiona)tr.setAttribute('aria-label','Fiona Matt · eigenes Resultat');for(const value of [entry.rank??'—',[entry.name,entry.club].filter(Boolean).join(' · '),entry.result,entry.wind!=null?entry.wind+' m/s':'—'])tr.append(el('td',value));body.append(tr);}table.append(body);wrap.append(table);box.append(wrap);}
      const raw=el('details');raw.append(el('summary','Vollständige Quelldaten'),el('pre',JSON.stringify(r,null,2)));box.append(raw);detail.showModal();
    };
    const bind=()=>document.querySelectorAll('#latestResults .result,#allResults .result').forEach(node=>{if(node.dataset.resultIndex!=null){node.tabIndex=0;node.setAttribute('role','button');node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();node.click();}};}});
    if(resultObserver)resultObserver.disconnect();resultObserver=new MutationObserver(bind);resultObserver.observe(document.querySelector('#allResults'),{childList:true});
    resultObserver.observe(document.querySelector('#latestResults'),{childList:true});
    setTimeout(bind,0);
  });
})();
