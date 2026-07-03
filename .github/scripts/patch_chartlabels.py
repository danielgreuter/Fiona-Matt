#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Idempotenter Patch fuer drawLineChart (alle Uebersicht-/Zoom-Charts):
  1) Nur noch das PB-Label anzeigen. Der Marker fuer das letzte Resultat
     bleibt als Punkt erhalten, aber ohne Zahl (steht eh in der Fusszeile)
     -> keine ueberlappenden Zahlen mehr, wenn PB nahe am Ende liegt.
  2) Label-Position an die Chart-Raender klemmen, damit z.B. "PB 1009"
     am rechten Rand nicht mehr abgeschnitten wird.

Marker: 'chartLabelClamp' -> mehrfaches Ausfuehren ist gefahrlos.
"""
import sys, io

PATH = "index.html"
MARKER = "chartLabelClamp"

with io.open(PATH, "r", encoding="utf-8") as f:
    html = f.read()

if MARKER in html:
    print("Bereits gepatcht (chartLabelClamp vorhanden) - nichts zu tun.")
    sys.exit(0)

orig = html

# ---------------------------------------------------------------------------
# 1) mkr: Label-X an Raender klemmen (Textbreite ~ 6.2px pro Zeichen bei fs10/800)
# ---------------------------------------------------------------------------
old_mkr = """  const mkr = (pt, label, col) =>
    '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="6" fill="white" stroke="' + col + '" stroke-width="2.5"/>' +
    '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="2.6" fill="' + col + '"/>' +
    '<text x="' + pt.x.toFixed(1) + '" y="' + (pt.y - 12).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="800" fill="' + col + '">' + label + '</text>';"""
new_mkr = """  // chartLabelClamp: Label horizontal in den Chart klemmen, Punkt optional ohne Text
  const mkr = (pt, label, col) => {
    let out =
      '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="6" fill="white" stroke="' + col + '" stroke-width="2.5"/>' +
      '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="2.6" fill="' + col + '"/>';
    if (label) {
      const tw = String(label).length * 6.2;         // grobe Textbreite
      let lx = pt.x;
      if (lx - tw / 2 < 2)     lx = 2 + tw / 2;      // linker Rand
      if (lx + tw / 2 > W - 2) lx = W - 2 - tw / 2;  // rechter Rand
      out += '<text x="' + lx.toFixed(1) + '" y="' + (pt.y - 12).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="800" fill="' + col + '">' + label + '</text>';
    }
    return out;
  };"""
n = html.count(old_mkr)
assert n == 1, "Anker mkr nicht eindeutig (count=%d)" % n
html = html.replace(old_mkr, new_mkr)

# ---------------------------------------------------------------------------
# 2) Aktueller Marker: nur Punkt, keine Zahl
# ---------------------------------------------------------------------------
old_curr = "  const mCurr = currIdx === bestIdx ? '' : mkr(currPt, fmt(currPt.v), '#7C8AA5');"
new_curr = "  const mCurr = currIdx === bestIdx ? '' : mkr(currPt, '', '#7C8AA5');"
n = html.count(old_curr)
assert n == 1, "Anker mCurr nicht eindeutig (count=%d)" % n
html = html.replace(old_curr, new_curr)

# ---------------------------------------------------------------------------
if html == orig:
    print("FEHLER: keine Aenderung vorgenommen.")
    sys.exit(1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(html)

print("OK - Patch angewendet:")
print("  - Nur PB-Label (aktueller Punkt ohne Zahl)")
print("  - Labels werden an Chart-Raender geklemmt")
