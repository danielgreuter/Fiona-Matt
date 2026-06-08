#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Idempotenter Patch fuer das Team-LIE Zoom-Modal (openLIEZoom):
  1) Im Team-Vergleichs-Chart pro Balken zusaetzlich die LEISTUNG
     (Zeit/Weite) unter den WA-Punkten anzeigen.
  2) Neuer Abschnitt "Top 5" der gewaehlten Athlet:in in der gewaehlten
     Disziplin (tabellarisch: Datum, Leistung+Wind, Wettkampf/Ort/Platz).
     Datenquelle: saResultsData (Fionas Einzelresultate). Fuer andere
     Athlet:innen gibt es keine Detaildaten -> Hinweis.

Marker: 'lieFillTop5'  -> mehrfaches Ausfuehren ist gefahrlos.
"""
import sys, io, re

PATH = "index.html"
MARKER = "lieFillTop5"

with io.open(PATH, "r", encoding="utf-8") as f:
    html = f.read()

if MARKER in html:
    print("Bereits gepatcht (lieFillTop5 vorhanden) - nichts zu tun.")
    sys.exit(0)

orig = html

# ---------------------------------------------------------------------------
# 1) CSS: Balken-Wert gestapelt (Punkte + Leistung) + Top-5 Tabellen-Styles
# ---------------------------------------------------------------------------
css_row_old = ".lz-bar-row{display:grid;grid-template-columns:100px 1fr 42px;align-items:center;gap:8px;font-size:11px}"
css_row_new = ".lz-bar-row{display:grid;grid-template-columns:92px 1fr 56px;align-items:center;gap:8px;font-size:11px}"
assert html.count(css_row_old) == 1, "Anker css_row nicht eindeutig"
html = html.replace(css_row_old, css_row_new)

css_val_old = ".lz-bar-val{font-family:'DM Mono',monospace;font-weight:800;color:var(--text);text-align:right}"
css_val_new = (
    ".lz-bar-val{display:flex;flex-direction:column;align-items:flex-end;line-height:1.1}\n"
    ".lz-bar-val .v{font-family:'DM Mono',monospace;font-weight:800;color:var(--text);font-size:12px}\n"
    ".lz-bar-val .r{font-family:'DM Mono',monospace;font-weight:600;color:var(--text-dim);font-size:9px;margin-top:1px}\n"
    ".lz-t5{display:flex;flex-direction:column;gap:5px;margin-top:6px}\n"
    ".lz-t5-row{display:grid;grid-template-columns:58px 78px 1fr;gap:8px;align-items:start;padding:7px 9px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;font-size:11px}\n"
    ".lz-t5-row.best{border-color:var(--gold);background:rgba(212,175,55,.08)}\n"
    ".lz-t5-date{color:var(--text-dim);font-weight:600;white-space:nowrap}\n"
    ".lz-t5-perf{font-family:'DM Mono',monospace;font-weight:800;color:var(--text);white-space:nowrap}\n"
    ".lz-t5-comp{color:var(--text-dim);line-height:1.3;min-width:0}\n"
    ".lz-t5-comp b{color:var(--text);font-weight:700;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
)
assert html.count(css_val_old) == 1, "Anker css_val nicht eindeutig"
html = html.replace(css_val_old, css_val_new)

# ---------------------------------------------------------------------------
# 2) Balken-Wert-Template: Punkte + Leistung
# ---------------------------------------------------------------------------
bar_old = "'<div class=\"lz-bar-val\">'+c.score+'</div>'+"
bar_new = "'<div class=\"lz-bar-val\"><span class=\"v\">'+c.score+'</span>'+(c.result?'<span class=\"r\">'+c.result+'</span>':'')+'</div>'+"
assert html.count(bar_old) == 1, "Anker bar_old nicht eindeutig"
html = html.replace(bar_old, bar_new)

# ---------------------------------------------------------------------------
# 3) Helfer-Funktionen vor openLIEZoom einfuegen
# ---------------------------------------------------------------------------
helpers = r"""var _lieT5Name=null,_lieT5Disc=null;
function lieDiscKey(s){return String(s||'').toLowerCase().replace(/\s+/g,'').replace('metres','m').replace('metre','m');}
function lieIsField(s){var n=String(s||'').toLowerCase();return n.indexOf('jump')>=0||n.indexOf('weit')>=0||n.indexOf('hoch')>=0||n.indexOf('put')>=0||n.indexOf('kugel')>=0||n.indexOf('throw')>=0||n.indexOf('diskus')>=0||n.indexOf('discus')>=0||n.indexOf('speer')>=0||n.indexOf('javelin')>=0;}
function lieTop5Rows(discName){
  var SR=(typeof saResultsData!=='undefined'&&saResultsData&&saResultsData.results)?saResultsData.results:null;
  if(!SR) return null;
  var key=lieDiscKey(discName);
  var field=lieIsField(discName);
  var rows=SR.filter(function(r){return lieDiscKey(r.discipline)===key;});
  rows.sort(function(a,b){
    var av=(a.numResult!=null)?a.numResult:parseFloat(String(a.result).replace(',','.'));
    var bv=(b.numResult!=null)?b.numResult:parseFloat(String(b.result).replace(',','.'));
    if(isNaN(av))return 1; if(isNaN(bv))return -1;
    return field?(bv-av):(av-bv);
  });
  return rows.slice(0,5);
}
function lieTop5Html(name, discName){
  var title='Top 5 \u00b7 '+lieDiscLabel(discName);
  if(name!=='Fiona Matt'){
    return '<div class="rz-top5-title">'+title+'</div>'+
      '<div style="font-size:11px;color:var(--text-dim);padding:8px 4px">Einzelresultate sind aktuell nur f\u00fcr Fiona Matt verf\u00fcgbar.</div>';
  }
  var rows=lieTop5Rows(discName);
  if(rows===null){
    return '<div class="rz-top5-title">'+title+'</div>'+
      '<div style="font-size:11px;color:var(--text-dim);padding:8px 4px">\u23f3 Lade Resultate\u2026</div>';
  }
  if(!rows.length){
    return '<div class="rz-top5-title">'+title+'</div>'+
      '<div style="font-size:11px;color:var(--text-dim);padding:8px 4px">Keine Einzelresultate in dieser Disziplin.</div>';
  }
  var field=lieIsField(discName);
  var body=rows.map(function(r,i){
    var wind='';
    if(!field&&r.wind!==''&&r.wind!=null){
      var w=parseFloat(String(r.wind).replace(',','.'));
      if(!isNaN(w)){var ws=(w>0?'+':'')+w.toFixed(1);wind=' <span style="font-size:9px;color:'+(r.windAssisted?'var(--red)':'var(--text-dim)')+'">('+ws+')</span>';}
    }
    var place=r.place?('<span style="font-size:9px;color:var(--text-dim)"> \u00b7 '+r.place+'</span>'):'';
    var venue=r.venue?(' \u00b7 '+r.venue):'';
    var comp=r.competition?r.competition:'\u2014';
    return '<div class="lz-t5-row'+(i===0?' best':'')+'">'+
      '<div class="lz-t5-date">'+(r.date||'\u2014')+'</div>'+
      '<div class="lz-t5-perf">'+(r.result||'\u2014')+wind+'</div>'+
      '<div class="lz-t5-comp"><b>'+comp+'</b><span>'+venue.replace(/^ \u00b7 /,'')+place+'</span></div>'+
    '</div>';
  }).join('');
  return '<div class="rz-top5-title">'+title+(field?' (Bestweiten)':' (Bestzeiten)')+'</div>'+
    '<div class="lz-t5">'+body+'</div>';
}
function lieFillTop5(){
  var box=document.getElementById('lie-top5-box');
  if(box&&_lieT5Name) box.innerHTML=lieTop5Html(_lieT5Name,_lieT5Disc);
}
function openLIEZoom(name, clickedDisc){"""
open_old = "function openLIEZoom(name, clickedDisc){"
assert html.count(open_old) == 1, "Anker openLIEZoom nicht eindeutig"
html = html.replace(open_old, helpers, 1)

# ---------------------------------------------------------------------------
# 4) top5Html berechnen + Merker setzen (vor card-Aufbau)
# ---------------------------------------------------------------------------
card_old = "  var card=document.getElementById('lie-zoom-card');"
card_new = (
    "  _lieT5Name=name; _lieT5Disc=clicked?clicked.name:'';\n"
    "  var top5Html=lieTop5Html(name, clicked?clicked.name:'');\n\n"
    "  var card=document.getElementById('lie-zoom-card');"
)
assert html.count(card_old) == 1, "Anker card nicht eindeutig"
html = html.replace(card_old, card_new)

# ---------------------------------------------------------------------------
# 5) Top-5-Box in die Modal-HTML einfuegen (vor "Alle Disziplinen")
# ---------------------------------------------------------------------------
disc_old = "    '<div class=\"rz-top5\"><div class=\"rz-top5-title\">Alle Disziplinen</div>'+discListHtml+'</div>'+"
disc_new = (
    "    '<div class=\"rz-top5\" id=\"lie-top5-box\">'+top5Html+'</div>'+\n"
    "    '<div class=\"rz-top5\"><div class=\"rz-top5-title\">Alle Disziplinen</div>'+discListHtml+'</div>'+"
)
assert html.count(disc_old) == 1, "Anker disc nicht eindeutig"
html = html.replace(disc_old, disc_new)

# ---------------------------------------------------------------------------
# 6) Bei Fiona Resultate nachladen, falls noch nicht vorhanden
# ---------------------------------------------------------------------------
open_add_old = "  document.getElementById('lie-zoom-overlay').classList.add('open');"
open_add_new = (
    "  document.getElementById('lie-zoom-overlay').classList.add('open');\n"
    "  if(isFiona && (typeof saResultsData==='undefined' || !saResultsData || !saResultsData.results)){\n"
    "    if(typeof loadSAResults==='function'){ try{ Promise.resolve(loadSAResults()).then(lieFillTop5).catch(lieFillTop5); }catch(_e){} }\n"
    "  }"
)
assert html.count(open_add_old) == 1, "Anker open_add nicht eindeutig"
html = html.replace(open_add_old, open_add_new)

# ---------------------------------------------------------------------------
if html == orig:
    print("FEHLER: keine Aenderung vorgenommen.")
    sys.exit(1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(html)

print("OK - Patch angewendet:")
print("  - Leistung pro Balken im Team-Chart")
print("  - Top-5-Abschnitt (Fiona) im Team-LIE Modal")
