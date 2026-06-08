#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Idempotenter Patch: Zoom-in-Modal fuer das Tab "Team LIE".
Klick auf eine Athlet:innen-Zeile -> Modal mit allen Details
(Name, Verein, Bestleistung, WA-Punkte, alle Disziplinen) plus
Balken-Chart mit allen Leistungen aller LIE-Athlet:innen in dieser Disziplin.
"""
import sys, io, re

PATH = "index.html"
MARKER = "openLIEZoom"

with io.open(PATH, "r", encoding="utf-8") as f:
    html = f.read()

if MARKER in html:
    print("Bereits gepatcht (openLIEZoom vorhanden) - nichts zu tun.")
    sys.exit(0)

# ---------------------------------------------------------------------------
# 1) Zeilen klickbar machen
# ---------------------------------------------------------------------------
OLD_ROW = ('html += `<div style="display:flex;align-items:center;gap:10px;'
           'padding:8px 0;border-bottom:1px solid var(--border);${r.isFiona?')
NEW_ROW = ('html += `<div onclick="openLIEZoom(\'${r.athlete}\',\'${r.disc}\')" '
           'style="cursor:pointer;display:flex;align-items:center;gap:10px;'
           'padding:8px 0;border-bottom:1px solid var(--border);${r.isFiona?')

if OLD_ROW not in html:
    print("FEHLER: Ranking-Zeilen-Template nicht gefunden.")
    sys.exit(1)
html = html.replace(OLD_ROW, NEW_ROW, 1)

# ---------------------------------------------------------------------------
# 2) CSS + Overlay + Script vor </body> einfuegen
# ---------------------------------------------------------------------------
BLOCK = r"""
<!-- ===== Team-LIE Zoom-Modal (openLIEZoom) ===== -->
<style>
.lz-chart{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.lz-bar-row{display:grid;grid-template-columns:100px 1fr 42px;align-items:center;gap:8px;font-size:11px}
.lz-bar-row.me .lz-bar-name{color:var(--blue);font-weight:800}
.lz-bar-name{font-weight:600;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lz-bar-track{height:14px;background:var(--surface2);border:1px solid var(--border);border-radius:999px;overflow:hidden}
.lz-bar-fill{height:100%;border-radius:999px;transition:width .4s ease}
.lz-bar-val{font-family:'DM Mono',monospace;font-weight:800;color:var(--text);text-align:right}
</style>
<div class="rz-overlay" id="lie-zoom-overlay" onclick="if(event.target===this)closeLIEZoom()">
  <div class="rz-card" id="lie-zoom-card"></div>
</div>
<script>
function lieDiscPill(name){
  var n=(name||'').toLowerCase();
  if(n.indexOf('100')>=0&&n.indexOf('metre')>=0) return 'rz-disc-100m';
  if(n.indexOf('60')>=0&&n.indexOf('metre')>=0) return 'rz-disc-60m';
  if(n.indexOf('200')>=0&&n.indexOf('metre')>=0) return 'rz-disc-200m';
  if(n.indexOf('long jump')>=0||n.indexOf('weit')>=0) return 'rz-disc-lj';
  if(n.indexOf('80')>=0&&n.indexOf('metre')>=0) return 'rz-disc-80m';
  return 'rz-disc-other';
}
function lieDiscLabel(name){
  if(!name) return '\u2014';
  return String(name)
    .replace('Metres','m').replace('Metre','m')
    .replace('Long Jump','Weitsprung')
    .replace('High Jump','Hochsprung')
    .replace('Shot Put','Kugel')
    .replace('Discus Throw','Diskus')
    .replace('Javelin Throw','Speer')
    .replace('Hurdles','H\u00fcrden');
}
function openLIEZoom(name, clickedDisc){
  var ATH=(typeof LIE_ATHLETES!=='undefined')?LIE_ATHLETES:[];
  var DATA=(typeof lieData!=='undefined')?lieData:{};
  var meta=ATH.find(function(a){return a.name===name;})||{};
  var d=(DATA&&DATA[name])?DATA[name]:null;
  var discs=(d&&d.discs)?d.discs.filter(function(x){return x.name&&x.name!=='\u2014';}):[];
  var clicked=discs.find(function(x){return x.name===clickedDisc;});
  if(!clicked&&discs.length) clicked=discs.slice().sort(function(a,b){return (b.score||0)-(a.score||0);})[0];
  var isFiona=name==='Fiona Matt';

  // Alle Disziplinen (nach Punkten)
  var discList=discs.slice().sort(function(a,b){return (b.score||0)-(a.score||0);});
  var discListHtml=discList.map(function(x){
    var hot=clicked&&x.name===clicked.name;
    return '<div class="dz-row'+(hot?' best':'')+'" style="grid-template-columns:1fr 72px 54px">'+
      '<div class="dz-loc" style="white-space:normal">'+lieDiscLabel(x.name)+'</div>'+
      '<div class="dz-time">'+(x.result||'\u2014')+'</div>'+
      '<div style="text-align:right;font-weight:800;font-family:\'DM Mono\',monospace;color:'+(hot?'var(--gold)':'var(--blue)')+'">'+(x.score!=null?x.score:'\u2014')+'</div>'+
    '</div>';
  }).join('')||'<div style="font-size:12px;color:var(--text-dim);padding:10px 4px">Keine Disziplindaten.</div>';

  // Team-Vergleich in der geklickten Disziplin
  var chartHtml='';
  if(clicked){
    var comp=[];
    ATH.forEach(function(a){
      var ad=(DATA&&DATA[a.name])?DATA[a.name]:null;
      if(!ad||!ad.discs) return;
      var dd=ad.discs.find(function(x){return x.name===clicked.name;});
      if(dd&&dd.score!=null) comp.push({name:a.name,score:dd.score,result:dd.result,isClicked:a.name===name});
    });
    comp.sort(function(a,b){return b.score-a.score;});
    var maxS=comp.length?comp[0].score:1;
    var bars=comp.map(function(c,i){
      var pct=Math.max(8,Math.round(c.score/maxS*100));
      var parts=c.name.split(' ');
      var label=(parts[0]?parts[0].charAt(0)+'. ':'')+parts.slice(1).join(' ');
      var cIsFi=c.name==='Fiona Matt';
      return '<div class="lz-bar-row'+(c.isClicked?' me':'')+'">'+
        '<div class="lz-bar-name">'+(i+1)+'. '+label+(cIsFi?' \ud83c\uddf1\ud83c\uddee':'')+'</div>'+
        '<div class="lz-bar-track"><div class="lz-bar-fill" style="width:'+pct+'%;background:'+(c.isClicked?'var(--blue)':'var(--border-strong,#94a3b8)')+'"></div></div>'+
        '<div class="lz-bar-val">'+c.score+'</div>'+
      '</div>';
    }).join('');
    chartHtml='<div class="rz-top5-title">Team LIE \u00b7 '+lieDiscLabel(clicked.name)+' \u00b7 WA Punkte</div>'+
      '<div class="lz-chart">'+bars+'</div>';
  }

  var url=(d&&d.url)?('https://worldathletics.org/athletes/liechtenstein/'+d.url)
        :(meta.url?('https://worldathletics.org/athletes/liechtenstein/'+meta.url):null);

  var card=document.getElementById('lie-zoom-card');
  card.innerHTML=
    '<button class="rz-close-btn" onclick="closeLIEZoom()">\u2715</button>'+
    '<div class="rz-header">'+
      '<span class="rz-disc-pill '+lieDiscPill(clicked?clicked.name:'')+'">'+lieDiscLabel(clicked?clicked.name:'\u2014')+'</span>'+
      '<span class="rz-tag">Team LIE</span>'+
      '<span class="rz-tag">World Athletics</span>'+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:18px;font-weight:900;color:'+(isFiona?'var(--blue)':'var(--text)')+';line-height:1.1">'+name+(isFiona?' \ud83c\uddf1\ud83c\uddee':'')+'</div>'+
        '<div style="font-size:12px;color:var(--text-dim);margin-top:2px">'+(meta.club||'')+(meta.gender?(' \u00b7 '+(meta.gender==='f'?'Frauen':'M\u00e4nner')):'')+'</div>'+
      '</div>'+
      (clicked?('<div style="text-align:right"><div style="font-size:34px;font-weight:900;color:var(--blue);line-height:1;font-family:\'DM Mono\',monospace">'+clicked.score+'</div><div style="font-size:9px;color:var(--text-dim);font-weight:700;letter-spacing:1px">WA PKT.</div></div>'):'')+
    '</div>'+
    (clicked?('<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:10px;color:var(--text-dim);font-weight:700;letter-spacing:.5px;text-transform:uppercase">Bestleistung</div><div style="font-size:20px;font-weight:800;color:var(--text);font-family:\'DM Mono\',monospace;margin-top:2px">'+(clicked.result||'\u2014')+'</div></div><span class="rz-disc-pill '+lieDiscPill(clicked.name)+'">'+lieDiscLabel(clicked.name)+'</span></div>'):'')+
    '<div class="rz-top5"><div class="rz-top5-title">Alle Disziplinen</div>'+discListHtml+'</div>'+
    (chartHtml?('<div class="rz-top5">'+chartHtml+'</div>'):'')+
    (d&&d.updated?('<div style="font-size:9px;color:var(--text-dim);margin-top:10px">WA Stand: '+d.updated+'</div>'):'')+
    (url?('<a href="'+url+'" target="_blank" style="display:block;text-align:center;margin-top:12px;font-size:12px;color:var(--blue);text-decoration:none;font-weight:700">World Athletics Profil \u2197</a>'):'');

  document.getElementById('lie-zoom-overlay').classList.add('open');
}
function closeLIEZoom(){var o=document.getElementById('lie-zoom-overlay');if(o)o.classList.remove('open');}
</script>
<!-- ===== /Team-LIE Zoom-Modal ===== -->
"""

if "</body>" not in html:
    print("FEHLER: </body> nicht gefunden.")
    sys.exit(1)
html = html.replace("</body>", BLOCK + "\n</body>", 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(html)

# Kontrolle
if MARKER in html and 'onclick="openLIEZoom(' in html and 'id="lie-zoom-overlay"' in html:
    print("OK - Team-LIE Zoom-Modal eingebaut.")
else:
    print("FEHLER: Kontrolle fehlgeschlagen.")
    sys.exit(1)
