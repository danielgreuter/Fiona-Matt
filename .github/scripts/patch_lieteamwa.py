#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Idempotenter Patch fuer das Team-LIE Zoom-Modal:
  - Top-5-Tabelle jetzt fuer ALLE LIE-Athlet:innen (nicht nur Fiona).
    Nicht-Fiona-Resultate kommen ueber den Worker (action=athlete&slug=...),
    werden pro Person in localStorage gecached (1 Tag) und in dieselbe
    Top-5-Tabelle gerendert wie bei Fiona.
  - Robusteres Disziplin-Matching (Weitsprung<->Long Jump, Huerden, Zeiten
    mit mm:ss etc.), damit Feld- und deutsch/englisch benannte Disziplinen
    korrekt zugeordnet werden.

Voraussetzung: Worker stellt action=athlete bereit (separat deployt).
Marker: 'lieFetchAthlete' -> mehrfaches Ausfuehren ist gefahrlos.
"""
import sys, io

PATH = "index.html"
MARKER = "lieFetchAthlete"

with io.open(PATH, "r", encoding="utf-8") as f:
    html = f.read()

if MARKER in html:
    print("Bereits gepatcht (lieFetchAthlete vorhanden) - nichts zu tun.")
    sys.exit(0)

orig = html

def repl(old, new, label):
    global html
    n = html.count(old)
    assert n == 1, "Anker '%s' nicht eindeutig (count=%d)" % (label, n)
    html = html.replace(old, new)

# ---------------------------------------------------------------------------
# 1) Slug-Merker deklarieren
# ---------------------------------------------------------------------------
repl(
    "var _lieT5Name=null,_lieT5Disc=null;",
    "var _lieT5Name=null,_lieT5Disc=null,_lieT5Slug=null;",
    "slug-var",
)

# ---------------------------------------------------------------------------
# 2) Robusteres lieDiscKey (deutsch/englisch, Feld, Huerden)
# ---------------------------------------------------------------------------
disckey_old = "function lieDiscKey(s){return String(s||'').toLowerCase().replace(/\\s+/g,'').replace('metres','m').replace('metre','m');}"
disckey_new = (
    "function lieDiscKey(s){var n=String(s||'').toLowerCase().replace(/\\s+/g,'').replace('metres','m').replace('metre','m');"
    "if(n.indexOf('weit')>=0||n.indexOf('longjump')>=0)return 'lj';"
    "if(n.indexOf('hoch')>=0||n.indexOf('highjump')>=0)return 'hj';"
    "if(n.indexOf('drei')>=0||n.indexOf('triplejump')>=0)return 'tj';"
    "if(n.indexOf('stab')>=0||n.indexOf('polevault')>=0)return 'pv';"
    "if(n.indexOf('kugel')>=0||n.indexOf('shotput')>=0)return 'sp';"
    "if(n.indexOf('diskus')>=0||n.indexOf('discus')>=0)return 'dt';"
    "if(n.indexOf('speer')>=0||n.indexOf('javelin')>=0)return 'jt';"
    "var m=n.match(/(\\d+)m(h)?/);if(m)return m[1]+'m'+(m[2]||'');return n;}"
)
repl(disckey_old, disckey_new, "lieDiscKey")

# ---------------------------------------------------------------------------
# 3) Neue Helfer (Mark-Parser, Cache, Fetch, Athleten-Rows) vor lieTop5Html
# ---------------------------------------------------------------------------
helpers = (
    "function lieParseMark(s){s=String(s||'').replace(',','.').trim();if(!s)return null;"
    "if(s.indexOf(':')>=0){var p=s.split(':');var mm=parseFloat(p[0]),ss=parseFloat(p[1]);"
    "if(isNaN(mm)||isNaN(ss))return null;return mm*60+ss;}var f=parseFloat(s);return isNaN(f)?null:f;}\n"
    "function lieAthCache(slug){try{var raw=localStorage.getItem('lie_ath_'+slug);if(!raw)return null;"
    "var o=JSON.parse(raw);if(!o||!o.t||(Date.now()-o.t>864e5))return null;return o.d;}catch(e){return null;}}\n"
    "function lieFetchAthlete(slug){return fetch(PROXY_URL+'?action=athlete&slug='+encodeURIComponent(slug))"
    ".then(function(r){return r.json();}).then(function(d){if(d&&d.results){"
    "try{localStorage.setItem('lie_ath_'+slug,JSON.stringify({t:Date.now(),d:d}));}catch(e){}}return d;});}\n"
    "function lieTop5RowsAthlete(discName){var c=_lieT5Slug?lieAthCache(_lieT5Slug):null;"
    "if(!c||!c.results)return null;var key=lieDiscKey(discName);var field=lieIsField(discName);"
    "var rows=c.results.filter(function(r){return lieDiscKey(r.discipline)===key;});"
    "rows.sort(function(a,b){var av=lieParseMark(a.result),bv=lieParseMark(b.result);"
    "if(av==null)return 1;if(bv==null)return -1;return field?(bv-av):(av-bv);});return rows.slice(0,5);}\n"
    "function lieTop5Html(name, discName){"
)
repl("function lieTop5Html(name, discName){", helpers, "lieTop5Html-anchor")

# ---------------------------------------------------------------------------
# 4) Datenquelle in lieTop5Html: Fiona -> SA, sonst -> Athleten-Cache
# ---------------------------------------------------------------------------
branch_old = (
    "  if(name!=='Fiona Matt'){\n"
    "    return '<div class=\"rz-top5-title\">'+title+'</div>'+\n"
    "      '<div style=\"font-size:11px;color:var(--text-dim);padding:8px 4px\">Einzelresultate sind aktuell nur f\\u00fcr Fiona Matt verf\\u00fcgbar.</div>';\n"
    "  }\n"
    "  var rows=lieTop5Rows(discName);"
)
branch_new = "  var rows=(name==='Fiona Matt')?lieTop5Rows(discName):lieTop5RowsAthlete(discName);"
repl(branch_old, branch_new, "fiona-branch")

# ---------------------------------------------------------------------------
# 5) Wind-Assist-Faerbung auch fuer WA-Rows (kein windAssisted-Feld)
# ---------------------------------------------------------------------------
wind_old = "color:'+(r.windAssisted?'var(--red)':'var(--text-dim)')+'\">('+ws+')</span>';}"
wind_new = "color:'+((r.windAssisted||w>2.0)?'var(--red)':'var(--text-dim)')+'\">('+ws+')</span>';}"
repl(wind_old, wind_new, "wind-color")

# ---------------------------------------------------------------------------
# 6) Slug in openLIEZoom setzen
# ---------------------------------------------------------------------------
repl(
    "  _lieT5Name=name; _lieT5Disc=clicked?clicked.name:'';",
    "  _lieT5Name=name; _lieT5Disc=clicked?clicked.name:''; _lieT5Slug=(meta&&meta.url)?meta.url:((d&&d.url)?d.url:'');",
    "slug-set",
)

# ---------------------------------------------------------------------------
# 7) Async-Nachladen: Fiona -> SA, sonst -> Worker
# ---------------------------------------------------------------------------
trig_old = (
    "  document.getElementById('lie-zoom-overlay').classList.add('open');\n"
    "  if(isFiona && (typeof saResultsData==='undefined' || !saResultsData || !saResultsData.results)){\n"
    "    if(typeof loadSAResults==='function'){ try{ Promise.resolve(loadSAResults()).then(lieFillTop5).catch(lieFillTop5); }catch(_e){} }\n"
    "  }"
)
trig_new = (
    "  document.getElementById('lie-zoom-overlay').classList.add('open');\n"
    "  if(isFiona){\n"
    "    if(!(typeof saResultsData!=='undefined'&&saResultsData&&saResultsData.results)&&typeof loadSAResults==='function'){\n"
    "      try{ Promise.resolve(loadSAResults()).then(lieFillTop5).catch(lieFillTop5); }catch(_e){}\n"
    "    }\n"
    "  } else if(_lieT5Slug){\n"
    "    if(!lieAthCache(_lieT5Slug)){\n"
    "      try{ lieFetchAthlete(_lieT5Slug).then(lieFillTop5).catch(lieFillTop5); }catch(_e){}\n"
    "    }\n"
    "  }"
)
repl(trig_old, trig_new, "async-trigger")

# ---------------------------------------------------------------------------
if html == orig:
    print("FEHLER: keine Aenderung vorgenommen.")
    sys.exit(1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(html)

print("OK - Patch angewendet:")
print("  - Top-5 fuer alle LIE-Athlet:innen (Worker action=athlete)")
print("  - robustes Disziplin-Matching")
