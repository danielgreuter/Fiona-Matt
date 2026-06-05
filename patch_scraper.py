#!/usr/bin/env python3
# Fix: Swiss-Athletics-Scraper bricht mit net::ERR_CONNECTION_REFUSED ab,
# wenn Requests zu schnell hintereinander kommen (Rate-Limit/Server-Abweisung).
# Loesung: gotoRetry-Helper mit Backoff + kurze Pause zwischen den Disziplinen.
import sys

PATH = "scrape_athlete_results_v46.js"
with open(PATH, encoding="utf-8") as f:
    js = f.read()

orig = js

# 1) gotoRetry-Helper vor scrapeQuery einfuegen
helper = (
    "// Robust goto: Retry bei transienten Netzwerkfehlern (ERR_CONNECTION_REFUSED etc.)\n"
    "async function gotoRetry(page, url, opts, tries = 4) {\n"
    "  let lastErr;\n"
    "  for (let i = 0; i < tries; i++) {\n"
    "    try {\n"
    "      return await page.goto(url, opts);\n"
    "    } catch (e) {\n"
    "      lastErr = e;\n"
    "      const msg = String((e && e.message) || e);\n"
    "      const transient = /net::ERR_|ERR_CONNECTION|ERR_TIMED_OUT|ERR_EMPTY_RESPONSE|ERR_NETWORK_CHANGED|Timeout/i.test(msg);\n"
    "      if (!transient || i === tries - 1) throw e;\n"
    "      const wait = 3000 * (i + 1) * (i + 1);   // 3s, 12s, 27s\n"
    "      console.log(`    \\u23f3 goto fehlgeschlagen (${msg.split('\\n')[0]}), Retry ${i + 1}/${tries - 1} in ${wait / 1000}s`);\n"
    "      await page.waitForTimeout(wait);\n"
    "    }\n"
    "  }\n"
    "  throw lastErr;\n"
    "}\n\n"
)

anchor_fn = "async function scrapeQuery(outer, inner, con, year, cat, disc, indoor) {"

# 2) outer.goto / inner.goto auf gotoRetry umstellen
old_outer = "  await outer.goto(saUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });"
new_outer = "  await gotoRetry(outer, saUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });"

old_inner = "  await inner.goto(iframeSrc, { waitUntil: 'networkidle', timeout: 30000 });"
new_inner = "  await gotoRetry(inner, iframeSrc, { waitUntil: 'networkidle', timeout: 30000 });"

# 3) Pause zwischen Disziplinen
old_loop = "      allResults.push(...rows);"
new_loop = "      allResults.push(...rows);\n      await outer.waitForTimeout(1500);   // hoeflich: Rate-Limit vermeiden"

if "async function gotoRetry" in js:
    print("INFO: gotoRetry bereits vorhanden, nichts zu tun")
    sys.exit(0)

errs = []
if anchor_fn not in js: errs.append("scrapeQuery-Anker")
if old_outer not in js: errs.append("outer.goto")
if old_inner not in js: errs.append("inner.goto")
if old_loop not in js: errs.append("allResults.push")
if errs:
    print("FEHLER: nicht gefunden:", ", ".join(errs))
    sys.exit(1)

js = js.replace(anchor_fn, helper + anchor_fn, 1)
js = js.replace(old_outer, new_outer, 1)
js = js.replace(old_inner, new_inner, 1)
js = js.replace(old_loop, new_loop, 1)

if js != orig:
    with open(PATH, "w", encoding="utf-8") as f:
        f.write(js)
    print("OK: gotoRetry + Pause eingefuegt")
else:
    print("Keine Aenderung")
