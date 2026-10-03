/* Preserve complete source payloads; one unavailable source must not block others. */
window.FionaSources = (() => {
  const base = 'https://fiona-proxy.daniel-greuter.workers.dev';
  const definitions = [
    ['bestenliste', 'Swiss Athletics · U18 Rankings', d => !!d?.disciplines],
    ['wa-pbs', 'World Athletics · Bestleistungen', d => Array.isArray(d?.pbs)],
    ['results', 'World Athletics · Resultate / Punkte', d => Array.isArray(d) || Array.isArray(d?.results)],
    ['lieteam', 'Team Liechtenstein', d => d && Object.values(d).some(a => Array.isArray(a?.discs))],
    ['calendar', 'Fionas Wettkampf- & Trainingskalender', Array.isArray],
    ['chcalendar', 'Schweizer Wettkampfkalender', d => Array.isArray(d?.events)],
    ['upcoming', 'Kommende Wettkämpfe', d => Array.isArray(d) || Array.isArray(d?.events)]
  ];
  async function load([action, title, validate], force=false) {
    const key = 'fiona-v2-source:' + action;
    try {
      const response = await fetch(base + '?action=' + action + (action==='results' && force ? '&force=1' : ''), {cache:'no-store', signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (!validate(data)) throw new Error('Unbekanntes Datenformat');
      const record = {action,title,data,loadedAt:new Date().toISOString(),status:'live'};
      try { localStorage.setItem(key,JSON.stringify(record)); } catch {}
      window.dispatchEvent(new CustomEvent("fiona-source",{detail:record}));
      return record;
    } catch (error) {
      try {
        const cached = JSON.parse(localStorage.getItem(key));
        if (cached && validate(cached.data)) {
          const record={...cached,status:'cache',error:error.message};
          window.dispatchEvent(new CustomEvent('fiona-source',{detail:record}));
          return record;
        }
      } catch {}
      const record={action,title,status:'unavailable',error:error.message};
      window.dispatchEvent(new CustomEvent('fiona-source',{detail:record}));
      return record;
    }
  }
  return {
    definitions,
    loadOne:async (action,options={}) => {
      const def=definitions.find(d=>d[0]===action);
      if (!def) throw new Error('Unbekannte Quelle');
      return load(def,!!options.force);
    },
    loadAll:async (callback=()=>{}) => Promise.allSettled(definitions.map(async def => callback(await load(def))))
  };
})();
