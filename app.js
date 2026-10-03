
(() => {
  const C = window.FIONA_APP_CONFIG;
  const state = { data:null, discipline:"Alle", year:"Alle", chartYear:"Alle" };

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const fmtDate = iso => new Intl.DateTimeFormat("de-CH",{day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(iso));
  const daysBetween=(a,b)=>Math.ceil((b-a)/86400000);

  function legal(r){
    const w = parseFloat(r.wind);
    return !r.windAssisted && (Number.isNaN(w) || w <= 2.0);
  }
  function byDateDesc(a,b){ return new Date(b.dateISO)-new Date(a.dateISO); }
  function sprintResults(discipline){
    return (state.data?.results||[]).filter(r=>r.discipline===discipline && legal(r) && Number.isFinite(r.numResult));
  }
  function bestOf(discipline, year=null){
    let arr=sprintResults(discipline);
    if(year) arr=arr.filter(r=>r.year===year);
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
        const res=await fetch(url,{cache:"no-store"});
        if(!res.ok) throw new Error("HTTP "+res.status);
        const data=await res.json();
        if(!data || !Array.isArray(data.results)) throw new Error("Ungültiges Datenformat");
        state.data=data;
        $("#syncStatus").textContent=url.startsWith("http")?"Live-Daten":"Lokale Daten";
        renderAll();
        return;
      }catch(e){ lastError=e; }
    }
    $("#syncStatus").textContent="Datenfehler";
    $("#dataWarning").textContent="Athletikdaten konnten nicht geladen werden.";
    console.error(lastError);
  }

  function renderCountdown(){
    const target=new Date(C.target.date);
    const now=new Date();
    const days=Math.max(0,daysBetween(now,target));
    $("#countdown").innerHTML=`${days} <small>Tage</small>`;
    const start=new Date("2026-09-01T00:00:00+02:00");
    const pct=Math.max(0,Math.min(100,((now-start)/(target-start))*100));
    $("#progressBar").style.width=pct.toFixed(1)+"%";
    $("#progressText").textContent=Math.round(pct)+"%";
  }

  function renderDataFreshness(){
    const scraped=state.data?.scraped ? new Date(state.data.scraped) : null;
    if(!scraped) return;
    const age=daysBetween(scraped,new Date());
    $("#dataWarning").textContent=`Datenquelle: Swiss Athletics · Stand ${fmtDate(scraped)} · ${age} Tage alt`;
    $("#dataWarning").className="data-note";
    if(age<=3){
      $("#dataWarning").textContent=`Datenquelle: Swiss Athletics · aktuell per ${fmtDate(scraped)}`;
    }
  }

  function renderMetrics(){
    const pb60=bestOf("60m");
    const pb100=bestOf("100m");
    const sb100=bestOf("100m",2026);
    const pb200=bestOf("200m");
    const metrics=[
      ["60 m PB",pb60?pb60.result:"—",pb60?fmtDate(pb60.dateISO):"keine Daten"],
      ["100 m PB",pb100?pb100.result:"—",pb100?(`${pb100.wind?pb100.wind+" m/s · ":""}${fmtDate(pb100.dateISO)}`):"keine Daten"],
      ["100 m SB 2026",sb100?sb100.result:"—",sb100?fmtDate(sb100.dateISO):"noch kein Resultat"],
      ["200 m PB",pb200?pb200.result:"—",pb200?fmtDate(pb200.dateISO):"keine Daten"]
    ];
    $("#metrics").innerHTML=metrics.map(m=>`
      <div class="metric"><div class="metric-label">${m[0]}</div><div class="metric-value">${m[1]}</div><div class="metric-note">${m[2]}</div></div>
    `).join("");
  }

  function chartData(year="Alle"){
    let arr=sprintResults("100m").filter(r=>r.dateISO);
    if(year!=="Alle") arr=arr.filter(r=>String(r.year)===String(year));
    return arr.sort((a,b)=>new Date(a.dateISO)-new Date(b.dateISO));
  }

  function renderChart(container, year="Alle"){
    const el=$(container), data=chartData(year);
    if(!data.length){ el.innerHTML='<div class="empty">Keine 100-m-Daten für diesen Zeitraum.</div>'; return; }
    const W=760,H=250,p={l:42,r:18,t:18,b:34};
    const xs=data.map(r=>new Date(r.dateISO).getTime());
    const ys=data.map(r=>r.numResult);
    const xmin=Math.min(...xs), xmax=Math.max(...xs);
    const ymin=Math.min(...ys)-.08, ymax=Math.max(...ys)+.08;
    const x=v=>p.l+(xmax===xmin?(W-p.l-p.r)/2:(v-xmin)/(xmax-xmin)*(W-p.l-p.r));
    const y=v=>p.t+(v-ymin)/(ymax-ymin)*(H-p.t-p.b);
    const path=data.map((r,i)=>`${i?"L":"M"} ${x(new Date(r.dateISO).getTime()).toFixed(1)} ${y(r.numResult).toFixed(1)}`).join(" ");
    const ticks=[ymin,(ymin+ymax)/2,ymax];
    el.innerHTML=`
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="100 Meter Entwicklung">
        <defs><linearGradient id="lineGradient" x1="0" x2="1"><stop offset="0%" stop-color="#6ee7ff"/><stop offset="100%" stop-color="#8b5cf6"/></linearGradient></defs>
        ${ticks.map(t=>`<line class="chart-grid" x1="${p.l}" x2="${W-p.r}" y1="${y(t)}" y2="${y(t)}"/><text class="chart-axis" x="2" y="${y(t)+3}">${t.toFixed(2)}</text>`).join("")}
        <path class="chart-line" d="${path}"/>
        ${data.map(r=>`<circle class="chart-dot ${r.numResult===Math.min(...ys)?"best":""}" cx="${x(new Date(r.dateISO).getTime())}" cy="${y(r.numResult)}" r="5"><title>${r.result}s · ${r.date} · Wind ${r.wind||"n/a"}</title></circle>`).join("")}
        <text class="chart-axis" x="${p.l}" y="${H-8}">${data[0].date}</text>
        <text class="chart-axis" text-anchor="end" x="${W-p.r}" y="${H-8}">${data[data.length-1].date}</text>
      </svg>`;
  }

  function renderChartTabs(){
    const years=[...new Set(sprintResults("100m").map(r=>r.year))].sort((a,b)=>b-a).slice(0,4);
    const vals=["Alle",...years];
    $("#chartTabs").innerHTML=vals.map(v=>`<button class="tab ${String(v)===String(state.chartYear)?"active":""}" data-chart-year="${v}">${v}</button>`).join("");
    $$("[data-chart-year]").forEach(b=>b.onclick=()=>{state.chartYear=b.dataset.chartYear;renderChartTabs();renderChart("#progressChart",state.chartYear)});
  }

  function resultHtml(r){
    return `<div class="result">
      <div class="result-time">${r.result}<small> s</small></div>
      <div class="result-main"><strong>${r.disciplineLabel||r.discipline} · ${r.competition}</strong><span>${r.venue||"—"}${r.wind!==""&&r.wind!=null?" · Wind "+r.wind:""} · ${r.place||""}</span></div>
      <div class="result-date">${r.date}</div>
    </div>`;
  }

  function renderLatest(){
    const arr=(state.data?.results||[]).slice().sort(byDateDesc).slice(0,6);
    $("#latestResults").innerHTML=arr.map(resultHtml).join("")||'<div class="empty">Keine Resultate.</div>';
  }

  function renderTraining(){
    const html=C.trainingWeek.map(t=>`<div class="training"><div class="training-day">${t.day}</div><div><strong>${t.title}</strong><span>${t.detail}</span></div><div class="training-type">${t.type}</div></div>`).join("");
    $("#trainingWeek").innerHTML=html;
    $("#trainingFull").innerHTML=html;
  }

  function renderMilestones(){
    $("#milestones").innerHTML=C.milestones.map(m=>`<div class="event"><strong>${m.title}</strong><span>${fmtDate(m.date)} · ${m.detail}</span></div>`).join("");
  }

  function renderFilters(){
    const all=state.data?.results||[];
    const disciplines=["Alle",...new Set(all.map(r=>r.disciplineLabel||r.discipline))];
    const years=["Alle",...new Set(all.map(r=>r.year).filter(Boolean))].sort((a,b)=>String(b).localeCompare(String(a)));
    $("#disciplineFilter").innerHTML=disciplines.map(x=>`<option ${x===state.discipline?"selected":""}>${x}</option>`).join("");
    $("#yearFilter").innerHTML=years.map(x=>`<option ${String(x)===String(state.year)?"selected":""}>${x}</option>`).join("");
    $("#disciplineFilter").onchange=e=>{state.discipline=e.target.value;renderAllResults()};
    $("#yearFilter").onchange=e=>{state.year=e.target.value;renderAllResults()};
  }

  function renderAllResults(){
    let arr=(state.data?.results||[]).slice().sort(byDateDesc);
    if(state.discipline!=="Alle") arr=arr.filter(r=>(r.disciplineLabel||r.discipline)===state.discipline);
    if(state.year!=="Alle") arr=arr.filter(r=>String(r.year)===String(state.year));
    $("#allResults").innerHTML=arr.slice(0,80).map(resultHtml).join("")||'<div class="empty">Keine Resultate für diesen Filter.</div>';
  }

  function renderSeasonComparison(){
    const years=[2024,2025,2026];
    $("#seasonComparison").innerHTML=years.map(y=>{
      const b=bestOf("100m",y);
      return `<div class="metric"><div class="metric-label">${y} · 100 m</div><div class="metric-value">${b?b.result:"—"}</div><div class="metric-note">${b?((b.wind||"—")+" m/s · "+b.venue):"kein gültiges Resultat"}</div></div>`;
    }).join("");
  }

  function nav(){
    $$(".nav-btn").forEach(btn=>btn.onclick=()=>showView(btn.dataset.view));
    $$("[data-goto]").forEach(btn=>btn.onclick=()=>showView(btn.dataset.goto));
  }
  function showView(name){
    $$(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));
    $$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function renderAll(){
    renderCountdown();renderDataFreshness();renderMetrics();renderChartTabs();
    renderChart("#progressChart",state.chartYear);renderChart("#analysisChart","Alle");
    renderLatest();renderTraining();renderMilestones();renderFilters();renderAllResults();renderSeasonComparison();
  }

  nav();
  renderCountdown();
  setInterval(renderCountdown,60000);
  if("serviceWorker" in navigator){ navigator.serviceWorker.register("./sw.js").catch(()=>{}); }
  load();
})();