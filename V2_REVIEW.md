# Fiona Matt Athletics V2 – Reviewstand

Die neue Oberfläche ist auf `v2` vorbereitet. `main`, die öffentliche App, bestehende Scraper und produktive Workflows wurden nicht geändert.

## Neu nutzbar

- Rankings mit Disziplin-/Saisonfilter, Fiona-Hervorhebung und Abständen, sofern der tatsächliche Nachbarrang geliefert wird.
- WA-Verlauf mit Zoom, historischen Einträgen und Top-5 nach Punkten.
- Team-LIE-Vergleich, alle gelieferten Disziplinen, Athletenprofile und individuelle Top-5 nach Leistung.
- Trainingswochen aus dem bestehenden Kalender, inklusive vollständiger Kommentare und Details.
- Getrennter Fiona-/Schweiz-Wettkampfkalender; hinzufügen, bearbeiten und explizit bestätigtes Löschen über die bestehenden API-Verträge.
- Vollständige Resultatlisten, Laportal-Top-5, Ergebnisdetails, Formkennzahlen und PB-Historie.
- Dakar-/Liechtenstein-Uhren und Countdown mit Wettkampfwoche/Race-Day/abgeschlossen-Status.
- Getrennte Quellenstatus und gespeicherte Fallbacks; historische V1-Daten bleiben erkennbar.

## Vorschau

Diese Screenshots verwenden **simulierte Testantworten und den vorhandenen lokalen Resultatbestand**. Sie belegen die Darstellung, nicht aktuelle sportliche Bestleistungen oder Live-Erreichbarkeit.

[Mobile Vorschau](docs/v2-mobile-preview.jpg) · [Desktop Vorschau](docs/v2-desktop-preview.jpg)

## Validierung

- `npm test`: 11 Daten-/UI-Regressionstests bestanden, insbesondere Saisontrennung, Teil- und Gesamtausfälle, Kalenderfehler sowie explizites Löschen.
- `npm run test:browser`: echter Chromium, neun Ansichten bei 320, 390 und 1440 Pixeln; keine JavaScript-Fehler und kein horizontaler Seitenüberlauf. WA-Zoom und Dialoge geprüft.
- JavaScript-Syntax geprüft. Screenshots von Desktop, Smartphone, WA-Zoom, Rankings, Training, Team und Kalender visuell kontrolliert.
- Testzugriffe schreiben keine echten Kalenderdaten. Die automatisierten Tests intercepten alle externen APIs.

## Vor einem Wechsel auf main noch erforderlich

Die Live-Worker-Abfragen liefern aus dieser Entwicklungsumgebung HTTP 403. Aktuelle Payloads, ihre Vollständigkeit, echte Schreibberechtigungen und PWA-Installation müssen auf der späteren Preview-Origin geprüft werden. Startzeiten und Lauf-/Bahnzuteilung für Dakar sind nicht hinterlegt. V1 bleibt als Übergangsansicht für zusätzliche Sonderfunktionen (z. B. bestehender Punkte-Rechner) erreichbar. Kein vollständiger V1/V2-Funktionsabgleich und kein Produktionsrelease behauptet.

Lokal: `npm ci --ignore-scripts`, `npm test`, statischen Server im Repository starten. Browserprüfung mit installiertem Playwright-Chromium; alternativ `FIONA_BROWSER_PATH=/pfad/zu/chromium npm run test:browser`.
