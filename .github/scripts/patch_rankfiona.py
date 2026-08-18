#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Idempotent: Ranking-Tab zeigt Fiona ausserhalb Top 15 mit vollem Zeilen-Detail
(Wind/Ort/Datum/Jahrgang). Marker: fionaAppendRich."""
import sys, io
PATH="index.html"; MARKER="fionaAppendRich"
h=io.open(PATH,encoding="utf-8").read()
if MARKER in h:
    print("Bereits gepatcht - nichts zu tun."); sys.exit(0)
o=h
a1="""    if (live.fiona) {
      fionaRank   = live.fiona.rank;
      fionaResult = live.fiona.result;
    }"""
a2="""    if (live.fiona) {
      fionaRank   = live.fiona.rank;
      fionaResult = live.fiona.result;
      if (live.fiona.club) fionaClub = live.fiona.club;  // fionaAppendRich
    }"""
assert h.count(a1)==1, "Anker 1 nicht eindeutig"; h=h.replace(a1,a2)
b1="""  if (!fionaInTop15 && fionaRank && fionaResult) {
    html += `<div style="text-align:center;font-size:11px;color:var(--text-dim);padding:4px 0">· · ·</div>`;
    html += rankRow(fionaRank, 'Fiona Matt', fionaClub, fionaResult, disc, true);
  }"""
b2="""  if (!fionaInTop15 && fionaRank && fionaResult) {
    html += `<div style="text-align:center;font-size:11px;color:var(--text-dim);padding:4px 0">· · ·</div>`;
    const fw = (useLife && live.fiona) ? live.fiona.wind : null;
    const fBorn = (useLife && live.fiona && live.fiona.born) ? String(live.fiona.born).slice(-4) : null;
    const fVenue = (useLife && live.fiona) ? (live.fiona.venue || '') : '';
    const fDate = (useLife && live.fiona) ? (live.fiona.comp_date || '') : '';
    html += rankRow(fionaRank, 'Fiona Matt', fionaClub, fionaResult, disc, true, fw, fVenue, fDate, fBorn);
  }"""
assert h.count(b1)==1, "Anker 2 nicht eindeutig"; h=h.replace(b1,b2)
assert h!=o
io.open(PATH,"w",encoding="utf-8").write(h)
print("OK - Ranking-Append gepatcht.")
