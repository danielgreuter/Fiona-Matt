#!/usr/bin/env python3
# Fix: In der PROGRAMM-Box des Wettkampf-Modals die erste Zeile entfernen,
# wenn sie nur aus Disziplin-Angaben besteht (steht bereits in der Pill oben).
# Detailzeilen (z.B. "100m Vorlauf: 12:05 Uhr") bleiben immer erhalten.
import sys

PATH = "index.html"
with open(PATH, encoding="utf-8") as f:
    html = f.read()

orig = html

old = (
    "  var extraHtml = e.extraLines ?\n"
    "    '<div style=\"margin:0 16px 12px;padding:14px;background:var(--blue-light);border-radius:14px;border:1px solid var(--blue-mid)\">' +\n"
    "    '<div style=\"font-size:10px;font-weight:800;color:var(--blue);letter-spacing:1px;margin-bottom:8px\">\U0001F4CB PROGRAMM</div>' +\n"
    "    '<div style=\"font-size:13px;color:var(--text);white-space:pre-line;line-height:1.8\">' + e.extraLines + '</div></div>' : '';"
)

new = (
    "  var progText = e.extraLines || '';\n"
    "  if (progText) {\n"
    "    var progLines = progText.split('\\n');\n"
    "    var firstLine = (progLines[0] || '').trim();\n"
    "    var discTokens = firstLine.split(/[,\\/]/).map(function(t){ return t.trim(); }).filter(Boolean);\n"
    "    var discOnlyRe = /^(\\d{1,3}\\s*m|\\d\\s*x\\s*\\d{2,4}\\s*m?|weit(sprung)?|hoch(sprung)?|kugel(stossen)?|speer(wurf)?|diskus(wurf)?|hammer(wurf)?|stab(hochsprung)?|drei(sprung)?)$/i;\n"
    "    if (discTokens.length > 0 && discTokens.every(function(t){ return discOnlyRe.test(t); })) {\n"
    "      progLines.shift();\n"
    "      progText = progLines.join('\\n').trim();\n"
    "    }\n"
    "  }\n"
    "  var extraHtml = progText ?\n"
    "    '<div style=\"margin:0 16px 12px;padding:14px;background:var(--blue-light);border-radius:14px;border:1px solid var(--blue-mid)\">' +\n"
    "    '<div style=\"font-size:10px;font-weight:800;color:var(--blue);letter-spacing:1px;margin-bottom:8px\">\U0001F4CB PROGRAMM</div>' +\n"
    "    '<div style=\"font-size:13px;color:var(--text);white-space:pre-line;line-height:1.8\">' + progText + '</div></div>' : '';"
)

if "var progText = e.extraLines" in html:
    print("INFO: Patch bereits angewendet, nichts zu tun")
elif old not in html:
    print("FEHLER: PROGRAMM-Block nicht gefunden (evtl. Code geaendert)")
    sys.exit(1)
else:
    html = html.replace(old, new, 1)

if html != orig:
    with open(PATH, "w", encoding="utf-8") as f:
        f.write(html)
    print("OK: PROGRAMM-Disziplinzeile-Fix eingefuegt")
else:
    print("Keine Aenderung")
