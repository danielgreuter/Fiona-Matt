#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Idempotenter Patch: Wind pro Top5-Eintrag im Resultate-Zoom anzeigen.
Klein hinter der Zeit; windunterstuetzt (>2.0 m/s) rot.
Datenfeld a.wind kommt vom Scraper v55 (action=sa-results).

Marker: 'rzT5Wind' -> mehrfaches Ausfuehren ist gefahrlos.
"""
import sys, io

PATH = "index.html"
MARKER = "rzT5Wind"

with io.open(PATH, "r", encoding="utf-8") as f:
    html = f.read()

if MARKER in html:
    print("Bereits gepatcht (rzT5Wind vorhanden) - nichts zu tun.")
    sys.exit(0)

orig = html

old = """      rows+='<div class="rz-t5-row'+(isFiona?' fiona':'')+'">'+
        '<div class="rz-t5-rank">'+a.rank+'.</div>'+
        '<div class="rz-t5-name">'+a.name+(isFiona?' 🇱🇮':'')+'</div>'+
        '<div class="rz-t5-club">'+( a.club||'')+'</div>'+
        '<div class="rz-t5-time">'+a.result+'</div>'+
      '</div>';"""
new = """      var rzT5Wind='';
      if(a.wind!=null&&!isNaN(a.wind)){
        var aw=(a.wind>=0?'+':'')+Number(a.wind).toFixed(1);
        var wcol=(a.windAssisted||a.wind>2.0)?'var(--red)':'var(--text-dim)';
        rzT5Wind=' <span style="font-size:9px;font-weight:600;color:'+wcol+'">'+aw+'</span>';
      }
      rows+='<div class="rz-t5-row'+(isFiona?' fiona':'')+'">'+
        '<div class="rz-t5-rank">'+a.rank+'.</div>'+
        '<div class="rz-t5-name">'+a.name+(isFiona?' 🇱🇮':'')+'</div>'+
        '<div class="rz-t5-club">'+( a.club||'')+'</div>'+
        '<div class="rz-t5-time">'+a.result+rzT5Wind+'</div>'+
      '</div>';"""
n = html.count(old)
assert n == 1, "Anker rz-t5-row nicht eindeutig (count=%d)" % n
html = html.replace(old, new)

if html == orig:
    print("FEHLER: keine Aenderung vorgenommen.")
    sys.exit(1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(html)

print("OK - Wind in Top5 des Resultate-Zooms aktiv.")
