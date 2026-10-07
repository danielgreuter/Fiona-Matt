
(() => {
  const C = window.FIONA_APP_CONFIG;
  const state = { data:null, discipline:"Alle", year:"Alle", chartYear:"Alle", chartDisc:"100m", metricKey:"100-pb" };

  const $ = s => document.querySelector(s);
  let saData=null,waExtra=[];
  const $$ = s => [...document.querySelectorAll(s)];
  const esc=v=>String(v??" ").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));
  const fmtDate = iso => !iso || !Number.isFinite(new Date(iso).getTime()) ? "Datum fehlt" : new Intl.DateTimeFormat("de-CH",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"UTC"}).format(new Date(iso));
  const daysBetween=(a,b)=>Math.ceil((b-a)/86400000);

  function legal(r){
    const w = parseFloat(String(r.wind).replace(",", "."));
    return !r.windAssisted && (Number.isNaN(w) || w <= 2.0);
  }
  function byDateDesc(a,b){ return new Date(b.dateISO)-new Date(a.dateISO); }
  function sprintResults(discipline){
    return (state.data?.results||[]).filter(r=>r.discipline===discipline && legal(r) && Number.isFinite(r.numResult));
  }
  function bestOf(discipline, year=null){
    let arr=sprintResults(discipline);
    if(year) arr=arr.filter(r=>String(r.year)===String(year));
    return arr.sort((a,b)=>a.numResult-b.numResult)[0]||null;
  }

  async function load(){
    const sources=[
      "https://fiona-proxy.daniel-greuter.workers.dev?action=sa-results",
      "./athlete_results.json"
    ];
    let lastError=null;
    for(const url of sources){
      try{
        const res=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(15000)});
        if(!res.ok) throw new Error("HTTP "+res.status);
        const raw=await res.json();
        const data=Array.isArray(raw?.results)?window.FionaModels.normalizeResults(raw):raw;
        if(!data || !Array.isArray(data.results)) throw new Error("Ungültiges Datenformat");
        saData=data;state.data=withExtraResults(data);
        if(url.startsWith("http")){try{localStorage.setItem("fiona-v2-sa-results",JSON.stringify(data));}catch{}}
        window.dispatchEvent(new CustomEvent("fiona-results",{detail:state.data}));
        $("#syncStatus").textContent=url.startsWith("http")?"Live-Daten":"Lokale Daten";
        $("#syncStatus").closest(".status-pill").dataset.mode=url.startsWith("http")?"live":"cache";
        renderAll();
        return;
      }catch(e){
        lastError=e;
        if(url.startsWith("http")){
          try{const data=JSON.parse(localStorage.getItem("fiona-v2-sa-results"));if(Array.isArray(data?.results)){saData=window.FionaModels.normalizeResults(data);state.data=withExtraResults(saData);window.dispatchEvent(new CustomEvent("fiona-results",{detail:state.data}));$("#syncStatus").textContent="Gespeicherte Daten";$("#syncStatus").closest(".status-pill").dataset.mode="cache";renderAll();return;}}catch{}
        }
      }
    }
    $("#syncStatus").textContent="Datenfehler";$("#syncStatus").closest(".status-pill").dataset.mode="error";
    $("#dataWarning").textContent="Athletikdaten konnten nicht geladen werden.";
    console.error(lastError);
  }

  function renderCountdown(){
    const now=new Date();
    const localDay=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Vaduz",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
    const difference=Math.round((Date.parse(C.target.date.slice(0,10))-Date.parse(localDay))/86400000);
    $("#countdown").innerHTML=difference>0?`${difference} <small>Tage</small>`:difference===0?`Race Day`:`Abgeschlossen`;
    $("#raceDayStatus").textContent=difference>7?"Bis zum Wettkampftag":difference>0?"Wettkampfwoche":difference===0?"Heute · 100 m":"Wettkampftag vergangen";
    for(const [id,timeZone] of [["#dakarClock","Africa/Dakar"],["#homeClock","Europe/Vaduz"]]){
      $(id).textContent=new Intl.DateTimeFormat("de-CH",{timeZone,hour:"2-digit",minute:"2-digit"}).format(now);
    }
  }

  function renderDataFreshness(){
    const scraped=state.data?.scraped ? new Date(state.data.scraped) : null;
    if(!scraped || !Number.isFinite(scraped.getTime())) {$("#dataWarning").textContent="Datenstand nicht angegeben · Aktualität unbestätigt";return;}
    const age=daysBetween(scraped,new Date());
    $("#dataWarning").textContent=`Datenquelle: Swiss Athletics · Stand ${fmtDate(scraped)} · ${age} Tage alt`;
    $("#dataWarning").className=age>3?"data-note is-stale":"data-note";
    if(age<=3){
      $("#dataWarning").textContent=`Datenquelle: Swiss Athletics · aktuell per ${fmtDate(scraped)}`;
    }
  }

  function renderMetrics(){
    const metrics=[['60-pb','60m','60 m PB',bestOf('60m')],['100-pb','100m','100 m PB',bestOf('100m')],['150-pb','150m','150 m PB',bestOf('150m')],['200-pb','200m','200 m PB',bestOf('200m')]];
    $('#metrics').innerHTML=metrics.map(([key,disc,label,r])=>`<button type="button" class="metric ${state.metricKey===key?'selected':''}" data-metric="${key}" data-disc="${disc}" aria-pressed="${state.metricKey===key}"><div class="metric-label">${label}</div><div class="metric-value">${esc(r?.result||'—')}</div><div class="metric-note">${r?esc(fmtDate(r.dateISO)):'keine Daten'}</div></button>`).join('');
    $$('[data-metric]').forEach(b=>b.onclick=()=>{state.metricKey=b.dataset.metric;state.chartDisc=b.dataset.disc;state.chartYear='Alle';renderMetrics();renderChartTabs();renderChart('#progressChart',state.chartYear,state.chartDisc);});
  }
  function withExtraResults(data){
    const extra=waExtra.filter(r=>!data.results.some(s=>window.FionaModels.discipline(s.discipline)===r.discipline&&s.dateISO===r.dateISO&&String(s.result)===String(r.result)));
    return {...data,results:[...data.results,...extra]};
  }
  window.addEventListener('fiona-source',event=>{if(event.detail.action!=='results'||!event.detail.data)return;const raw=event.detail.data;const rows=Array.isArray(raw)?raw:raw.results||[];waExtra=window.FionaModels.normalizeResults({results:rows.filter(r=>window.FionaModels.discipline(r.discipline)==='150m').map(r=>({...r,source:'world-athletics',sourceStatus:event.detail.status,disciplineLabel:'150m'}))}).results;if(saData){state.data=withExtraResults(saData);window.dispatchEvent(new CustomEvent('fiona-results',{detail:state.data}));renderAll();}});

  function chartData(year='Alle',disc='100m'){
    return window.FionaModels.chartResults(state.data?.results,disc,year);
  }
  function openChartDetail(disc,year){
    const dialog=$('#resultDetail'),body=$('#detailContent');body.innerHTML=`<h2>${esc(disc.replace('m',' m'))} · Entwicklung</h2><p class="card-sub">Reguläre Resultate · ${esc(year==='Alle'?'alle Jahre':year)}</p><div class="chart chart-large" id="zoomProgressChart"></div><h3>Resultate der Kurve</h3><p class="data-note">Neueste Wettkampftage zuerst · Am selben Tag die schnellste Zeit zuerst.</p>`;
    renderChart('#zoomProgressChart',year,disc,false);
    const rows=chartData(year,disc);const ordered=window.FionaModels.resultTableRows(rows);
    const wrap=document.createElement('div');wrap.className='table-wrap';wrap.innerHTML=`<table class="data-table chart-results-table"><thead><tr>${['Datum','Leistung','Lauf / Rang','Wind','Wettkampf / Ort'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${ordered.map(r=>`<tr><td>${esc(r.date)}</td><td><strong>${esc(r.result)}</strong></td><td>${esc(window.FionaModels.raceLabel(r.place))}</td><td>${r.indoor?'Halle':r.wind!=null&&r.wind!==''?esc(r.wind)+' m/s':'nicht geliefert'}</td><td>${esc([r.competition,r.venue].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table>`;body.append(wrap);
    body.insertAdjacentHTML('beforeend',`<p class="data-note">${rows.length} Resultate · Windunterstützte Läufe sind in der regulären Kurve ausgeschlossen. Quellen: Swiss Athletics${disc==='150m'?' / World Athletics':''}.</p>`);dialog.showModal();
  }

  function renderChart(container, year="Alle",disc="100m",interactive=true){
    const el=$(container), data=chartData(year,disc);
    if(container==="#progressChart")$("#progressChartTitle").textContent=disc.replace("m","-m")+"-Entwicklung";
    if(!data.length){ el.removeAttribute('role');el.removeAttribute('tabindex');el.removeAttribute('aria-label');el.onclick=null;el.onkeydown=null;el.innerHTML=`<div class="empty">Keine ${esc(disc)}-Daten für diesen Zeitraum.</div>`; return; }
    const W=760,H=container==="#zoomProgressChart"?340:250,p={l:42,r:18,t:18,b:34};
    const xs=data.map(r=>new Date(r.dateISO).getTime());
    const ys=data.map(r=>r.numResult);
    const xmin=Math.min(...xs), xmax=Math.max(...xs);
    const ymin=Math.min(...ys)-.08, ymax=Math.max(...ys)+.08;
    const x=v=>p.l+(xmax===xmin?(W-p.l-p.r)/2:(v-xmin)/(xmax-xmin)*(W-p.l-p.r));
    const y=v=>p.t+(v-ymin)/(ymax-ymin)*(H-p.t-p.b);
    const path=data.map((r,i)=>`${i?"L":"M"} ${x(new Date(r.dateISO).getTime()).toFixed(1)} ${y(r.numResult).toFixed(1)}`).join(" ");
    const ticks=[ymin,(ymin+ymax)/2,ymax];
    el.innerHTML=`
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(disc)} Entwicklung">
        <defs><linearGradient id="lineGradient" x1="0" x2="1"><stop offset="0%" stop-color="#2563eb"/><stop offset="100%" stop-color="#dc2626"/></linearGradient></defs>
        ${ticks.map(t=>`<line class="chart-grid" x1="${p.l}" x2="${W-p.r}" y1="${y(t)}" y2="${y(t)}"/><text class="chart-axis" x="2" y="${y(t)+3}">${t.toFixed(2)}</text>`).join("")}
        <path class="chart-line" d="${path}"/>
        ${data.map(r=>`<circle class="chart-dot ${r.numResult===Math.min(...ys)?"best":""}" cx="${x(new Date(r.dateISO).getTime())}" cy="${y(r.numResult)}" r="5"><title>${esc(r.result)}s · ${esc(r.date)} · Wind ${esc(r.wind??"n/a")} · ${esc(window.FionaModels.raceLabel(r.place))}</title></circle>`).join("")}
        <text class="chart-axis" x="${p.l}" y="${H-8}">${esc(data[0].date)}</text>
        <text class="chart-axis" text-anchor="end" x="${W-p.r}" y="${H-8}">${esc(data[data.length-1].date)}</text>
      </svg>`;
    if(interactive){el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-label',disc+'-Entwicklung vergrössern und Resultate anzeigen');el.onclick=()=>openChartDetail(disc,year);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openChartDetail(disc,year);}};el.insertAdjacentHTML('beforeend','<span class="chart-open-hint">Kurve antippen · Zoom & Resultate ↗</span>');}
  }

  function renderChartTabs(){
    const years=[...new Set(sprintResults(state.chartDisc).map(r=>r.year))].sort((a,b)=>b-a).slice(0,4);
    const vals=["Alle",...years];
    $("#chartTabs").innerHTML=vals.map(v=>`<button class="tab ${String(v)===String(state.chartYear)?"active":""}" data-chart-year="${v}">${v}</button>`).join("");
    $$("[data-chart-year]").forEach(b=>b.onclick=()=>{state.chartYear=b.dataset.chartYear;renderChartTabs();renderChart("#progressChart",state.chartYear,state.chartDisc)});
  }

  function resultHtml(raw){
    const esc=v=>String(v??" ").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]));
    const r=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,typeof v==="string"?esc(v):v]));
    return `<div class="result result-card fiona-result" data-result-index="${state.data.results.indexOf(raw)}">
      <div class="result-time">${r.result}</div>
      <div class="result-main"><div class="result-heading"><strong class="result-discipline">${r.disciplineLabel||r.discipline}</strong><span class="result-date">${r.date}</span></div><strong class="result-competition">${r.competition||'Wettkampf'}</strong><span class="result-meta">${r.venue||'Ort nicht geliefert'}${r.wind!==""&&r.wind!=null?" · Wind "+r.wind+" m/s":""}${raw.source==="world-athletics"?" · World Athletics":""}</span>${r.place?'<span class="result-rank">'+esc(window.FionaModels.raceLabel(raw.place))+'</span>':''}</div><span class="result-chevron" aria-hidden="true">›</span>
    </div>`;
  }

  function renderLatest(){
    const arr=(state.data?.results||[]).slice().sort(byDateDesc).slice(0,6);
    $("#latestResults").innerHTML=arr.map(resultHtml).join("")||'<div class="empty">Keine Resultate.</div>';
    decorateResultLocations('#latestResults',arr);
  }

  function decorateResultLocations(container,results){
    $$(container+' .result').forEach((row,i)=>{
      const emblem=window.FionaMigrationUI?.eventEmblem(results[i]);
      if(emblem){emblem.classList.add('result-location-emblem');row.querySelector('.result-meta').prepend(emblem);}
    });
  }

  function renderTraining(){
    const html=C.trainingWeek.map(t=>`<div class="training"><div class="training-day">${t.day}</div><div><strong>${t.flag?`<img class="training-flag" src="${esc(t.flag)}" alt="${esc(t.country)}" width="18" height="14">`:""}${esc(t.title)}</strong><span>${esc(t.detail)}</span></div><div class="training-type">${t.type}</div></div>`).join("");
    $("#trainingWeek").innerHTML=html;
    $("#trainingFull").innerHTML=html;
  }

  function renderMilestones(){
    $("#milestones").innerHTML=C.milestones.map(m=>`<div class="event milestone-event"><img class="milestone-emblem" src="${esc(m.emblem)}" alt="${esc(m.emblemAlt)}" width="26" height="30" loading="lazy"><div><strong>${esc(m.title)}</strong><span>${fmtDate(m.date)} · ${esc(m.detail)}</span>${m.status?`<span class="milestone-status">Status: ${esc(m.status)}</span>`:''}${m.source?`<a class="milestone-source" href="${esc(m.source)}" target="_blank" rel="noopener noreferrer">Quelle ↗</a>`:''}</div></div>`).join("");
  }

  function renderFilters(){
    const all=state.data?.results||[];
    const disciplines=["Alle",...new Set(all.map(r=>r.disciplineLabel||r.discipline))];
    const years=["Alle",...new Set(all.map(r=>r.year).filter(Boolean))].sort((a,b)=>String(b).localeCompare(String(a)));
    $("#disciplineFilter").innerHTML=disciplines.map(x=>`<option ${x===state.discipline?"selected":""}>${esc(x)}</option>`).join("");
    $("#yearFilter").innerHTML=years.map(x=>`<option ${String(x)===String(state.year)?"selected":""}>${esc(x)}</option>`).join("");
    $("#disciplineFilter").onchange=e=>{state.discipline=e.target.value;renderAllResults()};
    $("#yearFilter").onchange=e=>{state.year=e.target.value;renderAllResults()};
  }

  function renderAllResults(){
    let arr=(state.data?.results||[]).slice().sort(byDateDesc);
    if(state.discipline!=="Alle") arr=arr.filter(r=>(r.disciplineLabel||r.discipline)===state.discipline);
    if(state.year!=="Alle") arr=arr.filter(r=>String(r.year)===String(state.year));
    $("#allResults").innerHTML=arr.map(resultHtml).join("")||'<div class="empty">Keine Resultate für diesen Filter.</div>';
    decorateResultLocations('#allResults',arr);
  }

  function renderSeasonComparison(){
    const years=[2024,2025,2026];
    $("#seasonComparison").innerHTML=years.map(y=>{
      const b=bestOf("100m",y);
      return `<div class="metric"><div class="metric-label">${y} · 100 m</div><div class="metric-value">${b?esc(b.result):"—"}</div><div class="metric-note">${b?esc((b.wind||"—")+" m/s · "+b.venue):"kein gültiges Resultat"}</div></div>`;
    }).join("");
  }

  function nav(){
    $$(".nav-btn").forEach(btn=>btn.onclick=()=>showView(btn.dataset.view));
    $$("[data-goto]").forEach(btn=>btn.onclick=()=>showView(btn.dataset.goto));
  }
  function showView(name){
    if(!document.getElementById("view-"+name)) return;
    history.replaceState(null,"","#"+name);
    window.dispatchEvent(new CustomEvent("fiona-view",{detail:{view:name}}));
    $$(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));
    $$(".nav-btn").forEach(b=>{b.classList.toggle("active",b.dataset.view===name);if(b.dataset.view===name)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});
    $$("[data-goto]").forEach(b=>{if(b.dataset.goto===name)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function renderAll(){
    renderCountdown();renderDataFreshness();renderMetrics();renderChartTabs();
    renderChart("#progressChart",state.chartYear,state.chartDisc);renderChart("#analysisChart","Alle");
    renderLatest();renderTraining();renderMilestones();renderFilters();renderAllResults();renderSeasonComparison();
  }

  nav();
  if(location.hash) showView(location.hash.slice(1));
  window.addEventListener("hashchange",()=>showView(location.hash.slice(1)||"home"));
  renderCountdown();
  setInterval(renderCountdown,60000);
  if("serviceWorker" in navigator){ navigator.serviceWorker.register("./sw.js").catch(()=>{}); }
  load();
})();