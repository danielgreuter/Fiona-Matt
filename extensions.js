(() => {
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;};
  const panels=document.querySelector('#sourcePanels');
  const records={};
  function row(parent,label,value,note='') {
    const n=el('div',null,'result');const main=el('div',null,'result-main');
    main.append(el('strong',label),el('span',note));n.append(main,el('strong',value));parent.append(n);
  }
  function render(record){
    records[record.action]=record;
    const card=el('section',null,'card span-12');card.append(el('h2',record.title));
    card.append(el('p',record.status==='live'?'Quelle erreichbar · abgerufen '+new Date(record.loadedAt).toLocaleString('de-CH'):record.status==='cache'?'Gespeicherter Stand · '+new Date(record.loadedAt).toLocaleString('de-CH'):'Quelle momentan nicht erreichbar','data-note'));
    const d=record.data;
    if(record.action==='bestenliste'&&d){
      for(const [disc,rank] of Object.entries(d.disciplines)){
        card.append(el('h3',disc+' · '+(rank.year||'Saison laut Quelle')));
        const list=[...(rank.top15||[])];
        if(rank.fiona&&!list.some(r=>r.name==='Fiona Matt'||r.isFiona))list.push({...rank.fiona,name:'Fiona Matt'});
        for(const r of list)row(card,(r.rank||'—')+'. '+r.name,r.result,[r.club,r.wind!=null?'Wind '+r.wind:'',r.location,r.date].filter(Boolean).join(' · '));
      }
    }else if(record.action==='lieteam'&&d){
      for(const [name,a] of Object.entries(d)){
        const box=el('details');box.append(el('summary',name));
        for(const disc of a.discs||[])row(box,disc.name,disc.result,disc.score!=null?disc.score+' WA-Punkte':'');
        card.append(box);
      }
    }else if(d){
      const list=Array.isArray(d)?d:d.pbs||d.events||[];
      for(const r of list){
        row(card,r.discipline||r.title||r.summary||r.name||r.competition||'Termin',r.result||r.mark||r.date||r.start?.dateTime||r.start?.date||r.start||'—',[r.date,r.venue,typeof r.location==='string'?r.location:'',r.score!=null?r.score+' WA-Punkte':'',r.isWettkampf===false?'Training':''].filter(Boolean).join(' · '));
      }
    }
    if(d){const raw=el('details');raw.append(el('summary','Vollständige Quelldaten'),el('pre',JSON.stringify(d,null,2)));card.append(raw);}
    else card.append(el('p','Alle bisherigen Ansichten und gespeicherten Informationen bleiben über „Bisherige App“ erreichbar.'));
    panels.append(card);
  }
  window.FionaSources.loadAll(render);
  window.addEventListener('fiona-results',event=>{
    const data=event.detail;const results=data.results||[];
    const legal=r=>!r.windAssisted&&(!Number.isFinite(parseFloat(String(r.wind).replace(',','.')))||parseFloat(String(r.wind).replace(',','.'))<=2);
    const sprint=results.filter(r=>r.discipline==='100m'&&legal(r)&&Number.isFinite(r.numResult));
    const last=sprint.slice().sort((a,b)=>String(b.dateISO).localeCompare(String(a.dateISO))).slice(0,5);
    const top=sprint.slice().sort((a,b)=>a.numResult-b.numResult).slice(0,5);
    const section=el('section',null,'card span-12');section.append(el('h2','100 m · Performance Center'));
    if(last.length){const mean=last.reduce((s,r)=>s+r.numResult,0)/last.length;row(section,'Letzte '+last.length+' reguläre Läufe · Mittelwert',mean.toFixed(2)+' s');row(section,'Spanne der letzten Läufe',(Math.max(...last.map(r=>r.numResult))-Math.min(...last.map(r=>r.numResult))).toFixed(2)+' s');}
    section.append(el('h3','Top 5 · reguläre Zeiten'));
    top.forEach(r=>row(section,r.date+' · '+r.venue,r.result+' s','Wind '+(r.wind||'nicht angegeben')));
    const assisted=results.filter(r=>r.discipline==='100m'&&!legal(r)).sort((a,b)=>a.numResult-b.numResult);
    if(assisted.length){section.append(el('h3','Windunterstützt · separat'));assisted.forEach(r=>row(section,r.date+' · '+r.venue,r.result+' s','Wind '+r.wind));}
    section.append(el('h3','PB-Historie · 100 m'));let best=Infinity;
    sprint.slice().sort((a,b)=>String(a.dateISO).localeCompare(String(b.dateISO))).forEach(r=>{if(r.numResult<best){best=r.numResult;row(section,r.date,r.result+' s',r.venue);}});
    document.querySelector('#view-analysis .grid').append(section);
    const detail=document.querySelector('#resultDetail');
    document.querySelector('#closeDetail').onclick=()=>detail.close();
    document.addEventListener('click',e=>{const target=e.target.closest('.result[data-result-index]');if(!target)return;const r=results[Number(target.dataset.resultIndex)];if(!r)return;const box=document.querySelector('#detailContent');box.replaceChildren(el('h2',(r.disciplineLabel||r.discipline)+' · '+r.result));for(const [key,value]of Object.entries(r))if(value!=null&&value!=='')row(box,key,typeof value==='object'?JSON.stringify(value):value);detail.showModal();});
    const bind=()=>document.querySelectorAll('#latestResults .result,#allResults .result').forEach(node=>{const r=results.find(r=>node.textContent.includes(r.competition)&&node.textContent.includes(r.date)&&node.textContent.includes(r.result)&&node.textContent.includes(r.disciplineLabel||r.discipline));if(r){node.dataset.resultIndex=results.indexOf(r);node.tabIndex=0;node.setAttribute('role','button');node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();node.click();}};}});
    new MutationObserver(bind).observe(document.querySelector('#allResults'),{childList:true});
    new MutationObserver(bind).observe(document.querySelector('#latestResults'),{childList:true});
    setTimeout(bind,0);
  });
})();
