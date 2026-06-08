#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Idempotenter Patch fuer das Team-LIE Zoom-Modal:
  1) Entfernt den Team-LIE Vergleichs-Chart unten (kein Mehrwert).
  2) "Alle Disziplinen" -> "Beste Disziplinen": max. 5 beste Disziplinen
     der Person mit WA-Score + Wert, aus den pbs-Daten von action=athlete
     (mehr als die bisher 2 aus lieteam). Fuer Fiona wird dafuer zusaetzlich
     ihre WA-pbs geladen (Top-5-Resultate bleiben aus den SA-Daten).
  3) Top-5-Tabelle neu im 2-Zeilen-Layout (Leistung links, Datum rechts,
     Wettkampf/Ort/Platz darunter) -> kein Ueberlappen mehr. Wind wird,
     falls vorhanden, immer angezeigt (in m/s, windunterstuetzt rot).

Marker: 'lieDiscListHtml' -> mehrfaches Ausfuehren ist gefahrlos.
"""
import sys, io

PATH = "index.html"
MARKER = "lieDiscListHtml"

with io.open(PATH, "r", encoding="utf-8") as f:
    html = f.read()

if MARKER in html:
    print("Bereits gepatcht (lieDiscListHtml vorhanden) - nichts zu tun.")
    sys.exit(0)

orig = html

def repl(old, new, label):
    global html
    n = html.count(old)
    assert n == 1, "Anker '%s' nicht eindeutig (count=%d)" % (label, n)
    html = html.replace(old, new)

# ---------------------------------------------------------------------------
# 1) Top-5 CSS: 2-Zeilen-Layout statt enger 3-Spalten-Grid
# ---------------------------------------------------------------------------
css_old = (
    ".lz-t5{display:flex;flex-direction:column;gap:5px;margin-top:6px}\n"
    ".lz-t5-row{display:grid;grid-template-columns:58px 78px 1fr;gap:8px;align-items:start;padding:7px 9px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;font-size:11px}\n"
    ".lz-t5-row.best{border-color:var(--gold);background:rgba(212,175,55,.08)}\n"
    ".lz-t5-date{color:var(--text-dim);font-weight:600;white-space:nowrap}\n"
    ".lz-t5-perf{font-family:'DM Mono',monospace;font-weight:800;color:var(--text);white-space:nowrap}\n"
    ".lz-t5-comp{color:var(--text-dim);line-height:1.3;min-width:0}\n"
    ".lz-t5-comp b{color:var(--text);font-weight:700;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
)
css_new = (
    ".lz-t5{display:flex;flex-direction:column;gap:6px;margin-top:6px}\n"
    ".lz-t5-row{padding:8px 11px;background:var(--surface2);border:1px solid var(--border);border-radius:10px}\n"
    ".lz-t5-row.best{border-color:var(--gold);background:rgba(212,175,55,.08)}\n"
    ".lz-t5-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}\n"
    ".lz-t5-perf{font-family:'DM Mono',monospace;font-weight:800;color:var(--text);font-size:13px;white-space:nowrap}\n"
    ".lz-t5-wind{font-size:9px;font-weight:600;margin-left:5px}\n"
    ".lz-t5-date{color:var(--text-dim);font-weight:600;font-size:10px;white-space:nowrap;flex-shrink:0}\n"
    ".lz-t5-comp{color:var(--text-dim);font-size:10px;line-height:1.35;margin-top:3px}\n"
    ".lz-t5-comp b{color:var(--text);font-weight:700}"
)
repl(css_old, css_new, "lz-t5-css")

# ---------------------------------------------------------------------------
# 2) Top-5 Row-Template: 2-Zeilen-Layout, Wind immer wenn vorhanden
# ---------------------------------------------------------------------------
body_old = (
    "  var body=rows.map(function(r,i){\n"
    "    var wind='';\n"
    "    if(!field&&r.wind!==''&&r.wind!=null){\n"
    "      var w=parseFloat(String(r.wind).replace(',','.'));\n"
    "      if(!isNaN(w)){var ws=(w>0?'+':'')+w.toFixed(1);wind=' <span style=\"font-size:9px;color:'+((r.windAssisted||w>2.0)?'var(--red)':'var(--text-dim)')+'\">('+ws+')</span>';}\n"
    "    }\n"
    "    var place=r.place?('<span style=\"font-size:9px;color:var(--text-dim)\"> \\u00b7 '+r.place+'</span>'):'';\n"
    "    var venue=r.venue?(' \\u00b7 '+r.venue):'';\n"
    "    var comp=r.competition?r.competition:'\\u2014';\n"
    "    return '<div class=\"lz-t5-row'+(i===0?' best':'')+'\">'+\n"
    "      '<div class=\"lz-t5-date\">'+(r.date||'\\u2014')+'</div>'+\n"
    "      '<div class=\"lz-t5-perf\">'+(r.result||'\\u2014')+wind+'</div>'+\n"
    "      '<div class=\"lz-t5-comp\"><b>'+comp+'</b><span>'+venue.replace(/^ \\u00b7 /,'')+place+'</span></div>'+\n"
    "    '</div>';\n"
    "  }).join('');"
)
body_new = (
    "  var body=rows.map(function(r,i){\n"
    "    var wind='';\n"
    "    if(r.wind!==''&&r.wind!=null){\n"
    "      var w=parseFloat(String(r.wind).replace(',','.'));\n"
    "      if(!isNaN(w)){var ws=(w>0?'+':'')+w.toFixed(1);wind='<span class=\"lz-t5-wind\" style=\"color:'+((r.windAssisted||w>2.0)?'var(--red)':'var(--text-dim)')+'\">('+ws+' m/s)</span>';}\n"
    "    }\n"
    "    var place=r.place?(' \\u00b7 '+r.place):'';\n"
    "    var venue=r.venue?(' \\u00b7 '+r.venue):'';\n"
    "    var comp=r.competition?r.competition:'\\u2014';\n"
    "    return '<div class=\"lz-t5-row'+(i===0?' best':'')+'\">'+\n"
    "      '<div class=\"lz-t5-head\">'+\n"
    "        '<div class=\"lz-t5-perf\">'+(r.result||'\\u2014')+wind+'</div>'+\n"
    "        '<div class=\"lz-t5-date\">'+(r.date||'\\u2014')+'</div>'+\n"
    "      '</div>'+\n"
    "      '<div class=\"lz-t5-comp\"><b>'+comp+'</b>'+venue+place+'</div>'+\n"
    "    '</div>';\n"
    "  }).join('');"
)
repl(body_old, body_new, "lz-t5-body")

# ---------------------------------------------------------------------------
# 3) Neue Funktion lieDiscListHtml() vor openLIEZoom (Disziplinen aus pbs)
# ---------------------------------------------------------------------------
discfn = (
    "function lieDiscListHtml(){\n"
    "  var c=_lieT5Slug?lieAthCache(_lieT5Slug):null;\n"
    "  var items=null;\n"
    "  if(c&&c.pbs&&c.pbs.length){\n"
    "    items=c.pbs.slice(0,5).map(function(p){return {label:lieDiscLabel(p.discipline),result:p.mark,score:p.score,key:lieDiscKey(p.discipline)};});\n"
    "  } else {\n"
    "    var DATA=(typeof lieData!=='undefined')?lieData:{};\n"
    "    var d=(DATA&&DATA[_lieT5Name])?DATA[_lieT5Name]:null;\n"
    "    var discs=(d&&d.discs)?d.discs.filter(function(x){return x.name&&x.name!=='\\u2014';}):[];\n"
    "    items=discs.slice().sort(function(a,b){return (b.score||0)-(a.score||0);}).slice(0,5).map(function(x){return {label:lieDiscLabel(x.name),result:x.result,score:x.score,key:lieDiscKey(x.name)};});\n"
    "  }\n"
    "  var ck=lieDiscKey(_lieT5Disc);\n"
    "  var rows=items.map(function(it){\n"
    "    var hot=it.key===ck;\n"
    "    return '<div class=\"dz-row'+(hot?' best':'')+'\" style=\"grid-template-columns:1fr 78px 54px\">'+\n"
    "      '<div class=\"dz-loc\" style=\"white-space:normal\">'+it.label+'</div>'+\n"
    "      '<div class=\"dz-time\">'+(it.result||'\\u2014')+'</div>'+\n"
    "      '<div style=\"text-align:right;font-weight:800;font-family:\\'DM Mono\\',monospace;color:'+(hot?'var(--gold)':'var(--blue)')+'\">'+(it.score!=null?it.score:'\\u2014')+'</div>'+\n"
    "    '</div>';\n"
    "  }).join('')||'<div style=\"font-size:12px;color:var(--text-dim);padding:10px 4px\">Keine Disziplindaten.</div>';\n"
    "  return '<div class=\"rz-top5-title\">Beste Disziplinen</div>'+rows;\n"
    "}\n"
    "function openLIEZoom(name, clickedDisc){"
)
repl("function openLIEZoom(name, clickedDisc){", discfn, "openLIEZoom-anchor")

# ---------------------------------------------------------------------------
# 4) Disziplin-Liste im Modal: neue Funktion + eigene Box-ID
# ---------------------------------------------------------------------------
repl(
    "    '<div class=\"rz-top5\"><div class=\"rz-top5-title\">Alle Disziplinen</div>'+discListHtml+'</div>'+",
    "    '<div class=\"rz-top5\" id=\"lie-disc-box\">'+lieDiscListHtml()+'</div>'+",
    "disc-box",
)

# ---------------------------------------------------------------------------
# 5) Team-LIE Vergleichs-Chart aus dem Modal entfernen
# ---------------------------------------------------------------------------
repl(
    "    (chartHtml?('<div class=\"rz-top5\">'+chartHtml+'</div>'):'')+\n",
    "",
    "chart-render",
)

# ---------------------------------------------------------------------------
# 6) Refill auch fuer Disziplin-Box
# ---------------------------------------------------------------------------
repl(
    "function lieFillTop5(){\n"
    "  var box=document.getElementById('lie-top5-box');\n"
    "  if(box&&_lieT5Name) box.innerHTML=lieTop5Html(_lieT5Name,_lieT5Disc);\n"
    "}",
    "function lieFillTop5(){\n"
    "  var box=document.getElementById('lie-top5-box');\n"
    "  if(box&&_lieT5Name) box.innerHTML=lieTop5Html(_lieT5Name,_lieT5Disc);\n"
    "  var db=document.getElementById('lie-disc-box');\n"
    "  if(db&&_lieT5Name) db.innerHTML=lieDiscListHtml();\n"
    "}",
    "lieFillTop5",
)

# ---------------------------------------------------------------------------
# 7) Fiona: zusaetzlich WA-pbs laden (fuer Disziplin-Liste)
# ---------------------------------------------------------------------------
repl(
    "  if(isFiona){\n"
    "    if(!(typeof saResultsData!=='undefined'&&saResultsData&&saResultsData.results)&&typeof loadSAResults==='function'){\n"
    "      try{ Promise.resolve(loadSAResults()).then(lieFillTop5).catch(lieFillTop5); }catch(_e){}\n"
    "    }\n"
    "  } else if(_lieT5Slug){",
    "  if(isFiona){\n"
    "    if(!(typeof saResultsData!=='undefined'&&saResultsData&&saResultsData.results)&&typeof loadSAResults==='function'){\n"
    "      try{ Promise.resolve(loadSAResults()).then(lieFillTop5).catch(lieFillTop5); }catch(_e){}\n"
    "    }\n"
    "    if(_lieT5Slug && !lieAthCache(_lieT5Slug)){\n"
    "      try{ lieFetchAthlete(_lieT5Slug).then(lieFillTop5).catch(lieFillTop5); }catch(_e){}\n"
    "    }\n"
    "  } else if(_lieT5Slug){",
    "fiona-pbs",
)

# ---------------------------------------------------------------------------
if html == orig:
    print("FEHLER: keine Aenderung vorgenommen.")
    sys.exit(1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(html)

print("OK - Patch angewendet:")
print("  - Team-Chart entfernt")
print("  - Beste Disziplinen (max 5, WA-Score + Wert) aus pbs")
print("  - Top-5 Layout entzerrt + Wind in m/s")
