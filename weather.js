(() => {
  const root=document.querySelector('#dakarWeather'),refresh=document.querySelector('#refreshWeather');
  const key='fiona-dakar-weather-v1',ttl=30*60*1000;
  const url='https://api.open-meteo.com/v1/forecast?latitude=14.7167&longitude=-17.4677&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&timezone=Africa%2FDakar&forecast_days=1';
  const describe=c=>c===0?'Klar':c===1?'Überwiegend klar':c===2?'Teilweise bewölkt':c===3?'Bedeckt':[45,48].includes(c)?'Nebel':[51,53,55,56,57].includes(c)?'Nieselregen':[61,63,65,66,67].includes(c)?'Regen':[71,73,75,77].includes(c)?'Schnee':[80,81,82].includes(c)?'Regenschauer':[85,86].includes(c)?'Schneeschauer':[95,96,99].includes(c)?'Gewitter':'Wetterdaten';
  const valid=data=>!!data?.current?.time&&Number.isFinite(Date.parse(data.current.time+'Z'))&&typeof data.current.temperature_2m==='number'&&Number.isFinite(data.current.temperature_2m);
  const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
  function render(record,cached=false,error=false){
    const c=record.data.current;root.replaceChildren();const main=el('div','','weather-main');main.append(el('strong',Math.round(c.temperature_2m)+'°','weather-temperature'),el('span',describe(c.weather_code)));root.append(main);
    const grid=el('div','','weather-values');for(const [label,v,unit]of [['Gefühlt',c.apparent_temperature,'°C'],['Luftfeuchte',c.relative_humidity_2m,'%'],['Wind',c.wind_speed_10m,'km/h']]){const cell=el('div','');cell.append(el('span',label),el('strong',Number.isFinite(v)?Math.round(v)+' '+unit:'—'));grid.append(cell);}root.append(grid);
    const stand=new Intl.DateTimeFormat('de-CH',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Africa/Dakar'}).format(new Date(c.time+'Z'));
    root.append(el('p','Stand '+stand+' · Ortszeit Dakar'+(cached?' · gespeichert':'')+(error?' · Aktualisierung nicht erreichbar':''),'data-note'));
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
