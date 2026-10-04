(() => {
  const root=document.querySelector('#dakarWeather'),refresh=document.querySelector('#refreshWeather');
  const key='fiona-dakar-weather-v1',ttl=30*60*1000;
  const url='https://api.open-meteo.com/v1/forecast?latitude=14.7167&longitude=-17.4677&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&timezone=Africa%2FDakar&forecast_days=1';
  const describe=c=>c===0?'Klar':c===1?'Überwiegend klar':c===2?'Teilweise bewölkt':c===3?'Bedeckt':[45,48].includes(c)?'Nebel':[51,53,55,56,57].includes(c)?'Nieselregen':[61,63,65,66,67].includes(c)?'Regen':[71,73,75,77].includes(c)?'Schnee':[80,81,82].includes(c)?'Regenschauer':[85,86].includes(c)?'Schneeschauer':[95,96,99].includes(c)?'Gewitter':'Wetterdaten';
  const valid=data=>!!data?.current?.time&&Number.isFinite(Date.parse(data.current.time+'Z'))&&typeof data.current.temperature_2m==='number'&&Number.isFinite(data.current.temperature_2m);
  const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
  function icon(code,large=false){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');svg.classList.add(large?'weather-detail-symbol':'weather-symbol');svg.setAttribute('aria-hidden','true');
    const sun='<circle cx="12" cy="12" r="5" fill="#e8b44c"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" stroke="#e8b44c" stroke-width="2" stroke-linecap="round"/>';
    const cloud='<path d="M9 23a5 5 0 1 1 0-10 7 7 0 0 1 13-1 5 5 0 0 1 2 11Z" fill="#c5d5eb" stroke="#5c7eac" stroke-width="1.5"/>';
    const rain='<path d="m11 26-1 3m7-3-1 3m7-3-1 3" stroke="#4585c7" stroke-width="2" stroke-linecap="round"/>';
    svg.innerHTML=code===0?sun:code<=2?sun+cloud:cloud+((code>=51&&code<=67||code>=80&&code<=82)?rain:code>=95?'<path d="m18 22-4 5h4l-2 5 7-8h-4l2-2Z" fill="#e8b44c"/>':[71,73,75,77,85,86].includes(code)?'<text x="13" y="31" font-size="12" fill="#4585c7">❄</text>':[45,48].includes(code)?'<path d="M7 27h18m-16 4h14" stroke="#5c7eac"/>':'');return svg;
  }
  function render(record,cached=false,error=false){
    const c=record.data.current,condition=describe(c.weather_code);root.replaceChildren();
    const stand=new Intl.DateTimeFormat('de-CH',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Africa/Dakar'}).format(new Date(c.time+'Z'));
    const stamp='Stand '+stand+' · Ortszeit Dakar'+(cached?' · gespeichert':'')+(error?' · Aktualisierung nicht erreichbar':'');
    const summary=el('button','','weather-summary');summary.type='button';summary.setAttribute('aria-label','Wetter in Dakar: '+condition+', '+Math.round(c.temperature_2m)+' Grad. Details öffnen');summary.append(icon(c.weather_code),el('span','Dakar'),el('strong',Math.round(c.temperature_2m)+'°'),el('span',condition,'weather-condition'),el('span','Wind '+(Number.isFinite(c.wind_speed_10m)?Math.round(c.wind_speed_10m)+' km/h':'—'),'weather-wind'));
    summary.onclick=()=>{const dialog=document.querySelector('#resultDetail'),body=document.querySelector('#detailContent');body.replaceChildren(el('h2','Wetter in Dakar'),icon(c.weather_code,true),el('p',Math.round(c.temperature_2m)+' °C · '+condition));const grid=el('div','','weather-values');for(const [label,v,unit]of [['Gefühlt',c.apparent_temperature,'°C'],['Luftfeuchte',c.relative_humidity_2m,'%'],['Wind',c.wind_speed_10m,'km/h']]){const cell=el('div','');cell.append(el('span',label),el('strong',Number.isFinite(v)?Math.round(v)+' '+unit:'—'));grid.append(cell);}body.append(grid,el('p',stamp,'data-note'));const source=el('a','Wetterdaten: Open-Meteo · Modellwerte','weather-attribution');source.href='https://open-meteo.com/';source.target='_blank';source.rel='noopener noreferrer';body.append(source);dialog.showModal();};
    root.append(summary);const note=el('p',stand+' Dakar'+(cached?' · gespeichert':'')+(error?' · Aktualisierung nicht erreichbar':'')+' · ','data-note');const source=el('a','Open-Meteo · Modellwerte');source.href='https://open-meteo.com/';source.target='_blank';source.rel='noopener noreferrer';note.append(source);root.append(note);
  }
  async function load(force=false){
    refresh.disabled=true;let cached;try{cached=JSON.parse(localStorage.getItem(key));}catch{}
    try{
      if(!force&&valid(cached?.data)&&Date.now()-cached.loadedAt<ttl){render(cached,true);return;}
      const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(!valid(data))throw Error('Unbekannte Wetterdaten');const record={data,loadedAt:Date.now()};try{localStorage.setItem(key,JSON.stringify(record));}catch{}render(record);
    }catch{if(valid(cached?.data))render(cached,true,true);else root.replaceChildren(el('p','Wetter momentan nicht erreichbar. Bitte später aktualisieren.','data-note'));}
    finally{refresh.disabled=false;}
  }
  refresh.onclick=()=>load(true);load();setInterval(()=>load(true),ttl);
})();
