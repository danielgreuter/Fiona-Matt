#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Idempotenter Patch: Ueberschneidung von Fiona-Foto und Wetter-/Naechster-Wettkampf-
Karte im Hero-Banner beheben.

Ursache: .hero-identity zieht das Foto mit margin-top:-60px in die Zeile der
Karte hinauf. Die Karte erzwingt min-width:194px und ragt dadurch auf schmalen
Displays in die Foto-Spalte -> Ueberlappung.

Fix (nur fuer schmale Screens, Desktop-Layout bleibt unveraendert):
  - Karte darf schrumpfen (min-width:0, max-width:200px)
  - Foto-Breite fluid: min(152px, 100vw - 250px)
    250px = 200 (Karte) + 20 + 20 (Hero-Padding) + 10 (Sicherheitsabstand)
    -> mathematisch garantiert immer 10px Luft zwischen Foto und Karte
  - Foto bleibt quadratisch (aspect-ratio)

Marker: 'heroOverlapFix'
"""
import sys, io

PATH = "index.html"
MARKER = "heroOverlapFix"

with io.open(PATH, "r", encoding="utf-8") as f:
    html = f.read()

if MARKER in html:
    print("Bereits gepatcht (heroOverlapFix vorhanden) - nichts zu tun.")
    sys.exit(0)

orig = html

CSS = """
/* heroOverlapFix: Foto darf die Wettkampf-/Wetterkarte nicht mehr ueberlappen */
@media (max-width: 560px) {
  .next-event-card {
    min-width: 0;
    max-width: 200px;
  }
  .photo-placeholder {
    width: min(152px, calc(100vw - 250px));
    height: auto;
    aspect-ratio: 1 / 1;
  }
}
</style>"""

# An das ENDE des Haupt-Stylesheets anhaengen (erstes </style>, direkt vor </head>)
anchor = "</style>\n</head>"
n = html.count(anchor)
assert n == 1, "Anker </style></head> nicht eindeutig (count=%d)" % n
html = html.replace(anchor, CSS + "\n</head>")

if html == orig:
    print("FEHLER: keine Aenderung vorgenommen.")
    sys.exit(1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(html)

print("OK - Hero-Ueberlappung behoben (Foto skaliert, Karte schrumpfbar).")
