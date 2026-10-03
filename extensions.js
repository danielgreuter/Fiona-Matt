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
    top.forEach(r=>row(section,r.date+' · '+r.venue,r.result+' s','Wind '+(r.wind||'nicht angegeben')));
    const assisted=results.filter(r=>r.discipline==='100m'&&!legal(r)).sort((a,b)=>a.numResult-b.numResult);
    if(assisted.length){section.append(el('h3','Windunterstützt · separat'));assisted.forEach(r=>row(section,r.date+' · '+r.venue,r.result+' s','Wind '+r.wind));}
    section.append(el('h3','PB-Historie · 100 m'));let best=Infinity;
    sprint.slice().sort((a,b)=>String(a.dateISO).localeCompare(String(b.dateISO))).forEach(r=>{if(r.numResult<best){best=r.numResult;row(section,r.date,r.result+' s',r.venue);}});
    document.querySelector('#view-analysis .grid').append(section);
    const detail=document.querySelector('#resultDetail');
    document.querySelector('#closeDetail').onclick=()=>detail.close();
    document.addEventListener('click',e=>{
      const target=e.target.closest('.result[data-result-index]');if(!target)return;
      const r=results[Number(target.dataset.resultIndex)];if(!r)return;
      const box=document.querySelector('#detailContent');box.replaceChildren(el('h2',(r.disciplineLabel||r.discipline)+' · '+r.result));
      const labels={date:'Datum',venue:'Ort',competition:'Wettkampf',place:'Lauf / Rang',fionaRank:'Gesamtrang Fiona',wind:'Wind (m/s)',indoor:'Indoor',source:'Quelle',year:'Saison',score:'WA-Punkte',waScore:'WA-Punkte',windAssisted:'Windunterstützt'};
      for(const [key,label]of Object.entries(labels))if(r[key]!=null&&r[key]!=='')row(box,label,r[key]);
      if(r.top5?.length){box.append(el('h3','Laportal · Top 5'));for(const entry of r.top5)row(box,(entry.rank||'—')+'. '+entry.name,entry.result,[entry.club,entry.wind!=null?'Wind '+entry.wind:''].filter(Boolean).join(' · '));}
      const raw=el('details');raw.append(el('summary','Vollständige Quelldaten'),el('pre',JSON.stringify(r,null,2)));box.append(raw);detail.showModal();
    });
    const bind=()=>document.querySelectorAll('#latestResults .result,#allResults .result').forEach(node=>{if(node.dataset.resultIndex!=null){node.tabIndex=0;node.setAttribute('role','button');node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();node.click();}};}});
    new MutationObserver(bind).observe(document.querySelector('#allResults'),{childList:true});
    new MutationObserver(bind).observe(document.querySelector('#latestResults'),{childList:true});
    setTimeout(bind,0);
  });
})();
