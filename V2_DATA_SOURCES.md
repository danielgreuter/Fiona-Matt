# Fiona Matt Athletics V2 — Datenquellen-Garantie

## Grundsatz

V2 darf keine bestehende Datenquelle oder bereits erarbeitete Information verlieren.

Alte Scraper, Proxy-/KV-Pfade, Workflow-Logik und Patch-Dateien dürfen erst entfernt oder vereinfacht werden, wenn:

1. die zugrunde liegende Information identifiziert ist,
2. die Datenquelle dokumentiert ist,
3. die Daten in V2 nachweislich weiterhin geladen werden,
4. die Darstellung/Funktion in V2 ersetzt wurde,
5. ein Fallback vorhanden ist, falls die Live-Quelle ausfällt.

## Bestehende Datenpfade

### 1. Fiona — Einzelresultate / PBs
- Quelle: Swiss Athletics
- Scraper: `scrape_athlete_results_v57.js`
- KV-Key: `results:fiona:sa`
- Live-Zugriff: Cloudflare Worker `?action=sa-results`
- Lokaler Fallback: `athlete_results.json`
- Enthält u. a.:
  - Resultate
  - Datum
  - Ort
  - Wettkampf
  - Rang/Lauf
  - Wind
  - Indoor/Outdoor
  - PB je Disziplin
  - windunterstützte Kennzeichnung

### 2. Laportal-Anreicherung
- Bestandteil von: `scrape_athlete_results_v57.js`
- Quelle: `slv.laportal.net`
- Zweck:
  - Rang / Fiona-Rang
  - Top-5 / Umfeld des Resultats
  - zusätzliche Wettkampfdetails

### 3. Swiss Athletics Bestenliste U18 Frauen
- Quelle: Swiss Athletics Bestenliste
- Scraper: `scrape_bestenliste.js`
- KV-Key 2026: `bestenliste:fiona`
- KV-Key 2025: `bestenliste_2025:fiona`
- Enthält:
  - Rangliste je Disziplin
  - Fiona-Rang
  - Resultat
  - Wind
  - Top-15/Umfeld
  - Kategorie U18 Frauen
- 2025 wird bewusst eingefroren.

### 4. Schweizer Wettkampfkalender
- Quelle: Swiss Athletics Wettkampfkalender
- Scraper: `scrape_chcalendar.js`
- KV-Key: `chcalendar:v1`
- Enthält Schweizer Wettkämpfe / Veranstaltungen.

### 5. World Athletics / WA Score
- Bestehende V1-Funktionalität muss erhalten bleiben.
- Hinweise aus bestehenden Patches:
  - WA-Score-Verlauf
  - WA-Punkte je Resultat
  - beste Resultate nach WA-Punkten
  - Wind / Wettkampf
  - World-Athletics-Verknüpfungen

### 6. Team LIE
- Bestehende V1-Funktionalität muss erhalten bleiben.
- Hinweise aus bestehenden Patches:
  - Liechtensteiner Athlet:innen
  - Verein
  - Disziplinen
  - Bestleistungen
  - WA-Punkte
  - Vergleich innerhalb Team LIE
  - World-Athletics-Profile

## V2-Funktionsumfang

Beibehalten / neu aufbauen:
- Dakar / YOG Modul
- 100-m Performance Center
- Formkurve
- Rankings
- Training 2.0
- PB-Historie
- Resultatdetails
- modernes Performance-App-Design

Nicht umsetzen:
- Road-to-Dakar-Timeline als eigener Punkt

## Migrationsregel

Bis zum vollständigen Funktionsabgleich bleiben bestehende Scraper und produktiven Workflows unangetastet.

V2 darf neue Datenadapter hinzufügen, aber keine produktive Quelle entfernen, bevor der Informationsumfang vollständig repliziert ist.

## Migration 03.10.2026
- `data-adapters.js`: unabhängige Lesezugriffe auf `bestenliste`, `wa-pbs`, `results`, `lieteam`, `calendar`, `chcalendar`, `upcoming`; vollständige Payloads bleiben erhalten. Browsercache nach erfolgreichem Abruf, sichtbarer Cache-Status bei Ausfall.
- `extensions.js`: Rankinglisten inkl. Fiona, Team-Disziplinen und WA-Punkte, Kalender, Top-5, windunterstützte 100 m, PB-Historie, vollständige Resultatdetails.
- `legacy.html`: unveränderte V1 aus main als Übergangsansicht. Enthält insbesondere historische eingebettete Rankings, Zoomansichten und Kalenderbearbeitung bis zur vollständigen Migration.
- Keine Scraper, produktiven Workflows oder Proxy-Schreibpfade geändert.
- Noch offen: vollständige native V2-Migration von WA-Zoom, Teamvergleichen, Kalenderbearbeitung und 2025-Fallbacks; visuelle Browserprüfung und Live-Quellenprüfung.

## Weitere Migration 03.10.2026
- `historical-data.js` übernimmt sämtliche eingebetteten FIONA-Felder und die Team-LIE-Profilzuordnung aus V1, unverändert und als historischen Stand gekennzeichnet.
- `data-models.js`: Datumsnormalisierung, Disziplinzuordnung, getrennte Saisonrankings, Trainings-Deduplizierung. Gleiche WA-Punkte in unterschiedlichen Monaten bleiben erhalten.
- `migration-ui.js`: native Rankingfilter, Fiona-Abstände nur bei tatsächlich vorhandenem Nachbarrang, WA-Chart mit Zoom und Top-5, Teamvergleich mit allen gelieferten Disziplinen, individuelle WA-Resultate, Trainingswochen und Kalenderdetails.
- Kalenderbearbeitung nutzt die unveränderten bestehenden `calendar-add`, `calendar-update`, `calendar-delete`-POST-Verträge. Kein Schreibzugriff beim Laden. Löschen braucht eine zweite explizite Schaltfläche. Fehler verändern die angezeigten Quelldaten nicht.
- `extensions.js`: Datenstatus samt vollständigen Payloads und lesbare Laportal-Top-5 in Resultatdetails.
- `app.js`: kompletter Resultatbestand ohne 80er-Abschneidung, gespeicherte SA-Daten bei Ausfall, direkte View-Links, Dakar-/Vaduz-Uhren und tagesbasierter Countdown.
- Tests: `npm test` prüft Datenverlust, historische Saisontrennung, Ausfälle, Teamdetails, Kalenderfehler, explizites Löschen und Navigation. Alle Schreibzugriffe sind in Tests simuliert.
- Grenzen: Live-Worker-Abfragen aus der Entwicklungsumgebung liefern HTTP 403. Ein vollständiger Abgleich mit aktuellen Live-Payloads steht deshalb weiterhin aus. V1 bleibt zugänglich; weitere Sonderfunktionen wie der bisherige Punkte-Rechner bleiben dort bis zu ihrer gesonderten Migration.
- Browser-QA des weiteren Reviewstands: neun Ansichten bei 320/390/1440 px ohne JavaScript-Fehler oder Seitenüberlauf, mit simulierten Quellantworten. Screenshots und Grenzen siehe `V2_REVIEW.md`.

## WA-/Team-Korrektur 03.10.2026 nach Veröffentlichung
- Live-Vertrag von `results` geprüft: `{results, pbs, topScore}` zusätzlich zum älteren Arrayformat. Bisher wurde die Objektantwort fälschlich verworfen; die Quelle und sämtliche Zusatzfelder werden jetzt akzeptiert und behalten.
- Erzwungener WA-Abruf (`force=1`) über die vorhandene Worker-Funktion. Der aktuell gelieferte Bestand enthält 13 Einzelresultate, neuester Eintrag 01.07.2026; die PB-Liste enthält einen separaten Eintrag vom 11.07.2026. Keine Vollständigkeit der Saison behauptet.
- Swiss-Athletics-Live-Quelle geprüft: 104 Resultate bis 06.09.2026. Neuere SA-Resultate werden zusätzlich im WA-Bereich gezeigt, ohne Punkte zu erfinden.
- Team LIE: die zwei höchsten gelieferten Disziplinwerte pro Athlet werden gemeinsam rangiert, gleiche Punktzahl gleicher Rang, fehlende Punkte ohne Rang. Alle zwölf hinterlegten Athlet:innen bleiben erhalten.
- WA-Einzelresultate mit Zeit/Leistung, Wind (m/s), Datum, Wettkampf und Ort; Chartpunkte per Tastatur oder Klick mit Details. Indoor ohne Wind, fehlende Winddaten ausdrücklich benannt.
- Dezentes originales WA-Logo von `https://media.aws.iaaf.org/logos/wa-logo.svg` (auf offizieller WA-Startseite eingebunden); lokale SVG-Datei für Offline-Nutzung. Senegal-Flagge als exakte Vektorflagge im Dakar-Modul.
- Regression: reale WA- und Team-Payloads als Testfixtures; 16 Tests und 27 Chromium-Layoutprüfungen bestanden. Kein Kalender-Schreibzugriff. V1-Archiv bleibt unverändert.
