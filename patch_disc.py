#!/usr/bin/env python3
# Fix: Disziplin-Pills im "Angemeldet" (highlight) Kontext umrahmen,
# damit sie sich wie bei "Anmeldung ausstehend" abheben.
import re, sys

PATH = "index.html"
with open(PATH, encoding="utf-8") as f:
    html = f.read()

orig = html

# CSS-Regel direkt nach der .upcoming-item.highlight Regel einfügen
anchor = ".upcoming-item.highlight { background: var(--blue-light); border-color: var(--blue-mid); }"
addition = (
    "\n.upcoming-item.highlight .disc-pill { background:#fff; border:1px solid var(--blue-mid); }"
)

if anchor not in html:
    print("FEHLER: Anker .upcoming-item.highlight nicht gefunden")
    sys.exit(1)

# Doppeltes Einfügen verhindern
if ".upcoming-item.highlight .disc-pill" in html:
    print("INFO: Regel bereits vorhanden, nichts zu tun")
else:
    html = html.replace(anchor, anchor + addition, 1)

if html != orig:
    with open(PATH, "w", encoding="utf-8") as f:
        f.write(html)
    print("OK: disc-pill Highlight-Fix eingefügt")
else:
    print("Keine Änderung")
