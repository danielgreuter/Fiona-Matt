#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Idempotenter Patch: EM-Countdown Off-by-one beheben.
Ursache: new Date('2026-07-16') = UTC-Mitternacht (02:00 lokal),
'today' aber lokale Mitternacht -> +2h Rest -> Math.ceil rundet auf 7 statt 6.
Fix: lokales Datum (new Date(2026, 6, 16)) + Math.round.

Marker: 'new Date(2026, 6, 16)' -> mehrfaches Ausfuehren ist gefahrlos.
"""
import sys, io

PATH = "index.html"
MARKER = "new Date(2026, 6, 16)"

with io.open(PATH, "r", encoding="utf-8") as f:
    html = f.read()

if MARKER in html:
    print("Bereits gepatcht - nichts zu tun.")
    sys.exit(0)

orig = html

old = """  const emDate = new Date('2026-07-16');
  const today = new Date();
  today.setHours(0,0,0,0);
  const diff = Math.ceil((emDate - today) / 86400000);"""
new = """  const emDate = new Date(2026, 6, 16); // lokal, nicht UTC (sonst Off-by-one)
  const today = new Date();
  today.setHours(0,0,0,0);
  const diff = Math.round((emDate - today) / 86400000);"""
n = html.count(old)
assert n == 1, "Anker Countdown nicht eindeutig (count=%d)" % n
html = html.replace(old, new)

if html == orig:
    print("FEHLER: keine Aenderung.")
    sys.exit(1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(html)
print("OK - Countdown rechnet jetzt lokal (16.07. => heute 6 Tage).")
