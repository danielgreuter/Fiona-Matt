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

## Home, 150 m und Kalender 03.10.2026
- WA-Ansicht verwendet ausschliesslich live abgerufene oder als Cache ausgewiesene WA-Resultate/PBs. Keine eingebetteten V1-Monatswerte oder PB-Fallbacks. Beste Punktzahl mit Zeit direkt im Chart.
- 150-m-Einzelresultate werden aus der bestehenden WA-Quelle in die vollständige Resultatliste übernommen und dort als World Athletics gekennzeichnet. Der SA-Scraper fragt 150 m bisher nicht ab; keine Ergebnisse oder Disziplin-IDs erfunden. Wiederholte Abrufe duplizieren die Resultate nicht.
- Home-PB-Boxen sind Tastatur-/Touch-Schaltflächen; ausgewählte Box mit aria-pressed und passender 60-/100-/150-/200-m-Kurve, Saisonbestleistung setzt Saisonfilter.
- Wettkampfkalender startet mit allen gelieferten Terminen; Wappen über unveränderten V1-Worker-Pfad anhand Kanton/Ort. Kalender-Live-Payload: zwölf Wettkämpfe bis September, keine kommenden Wettkämpfe. Keine zukünftigen Termine erfunden.
- Rot-blauer Hintergrund ausserhalb weisser Karten. V1-Archiv bleibt unverändert. 18 Tests und 27 Chromium-Prüfungen bestanden.

## Feinheiten 04.10.2026
- Home: eine 100-m-PB-Box; separate Saisonbestleistungsbox entfernt. Resultatzeilen ohne alleinstehendes Sekunden-s, mit klarer Trennung von Leistung, Datum, Disziplin und Wettkampf.
- Einheitlicher Detaildialog: sichtbares sticky ×, Escape und echter Klick ausserhalb der Box schliessen. Klick oder Textauswahl innerhalb bleibt offen. Native dialog-Semantik nach W3C APG/H102: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ .
- Details: Leistungshero, kompakte Wind-/Rang-/Quellenfelder und tabellarische Top 5; Rohdaten nur aufklappbar.
- Team LIE: kompakte Zeilen, Einzelprofilabruf erst beim Öffnen des Tabs (drei parallel), Profilcache sechs Stunden; manuelle Aktualisierung verfügbar. Zuordnung nur über identische Disziplin, Leistung und kompatible Punkte. Wettkampfdatum kommt aus passendem Resultat/PB, niemals aus updated. Wenn WA nur PB-Datum ohne Veranstaltungsort liefert, bleibt der Ort als fehlend gekennzeichnet. Kantonswappen anhand bekannter Orte; bei Ausland Landesname aus geliefertem Ländercode.
- Live-Einzelprofile Fiona/Verling/Insinna geprüft und als Regressionfixtures gespeichert. Beispiel Verling 72.90: 25.06.2025 Maribor, nicht Aktualisierungsdatum 25.04.2026.
- Hintergrund: feine parallele Tracklinien auf dem rot-blauen Verlauf; V1-Archiv unverändert. 21 Tests und 27 Browser-Layoutprüfungen mit zusätzlichen echten Modalinteraktionen bestanden.

## Wetter und Entwicklungskurven 04.10.2026
- Dakar: Open-Meteo Current Weather API, Koordinaten 14.7167/-17.4677, Zeitzone Africa/Dakar. Temperatur, gefühlte Temperatur, Feuchte, Wind und Wetterzustand sind Modellwerte, keine behaupteten Stationsmessungen. Attribution und Datenzeit in Ortszeit sichtbar. Abruf beim Öffnen und alle 30 Minuten während die App offen ist; manuell aktualisierbar. Cache maximal 30 Minuten ohne Abruf, bei Ausfall mit gespeichertem Datenstand und Fehlerhinweis; kein erfundenes Wetter. Offizielle Dokumentation: https://open-meteo.com/en/docs .
- Home und Analyse: Kurve per Touch/Klick oder Enter/Leertaste vergrösserbar. Tabelle enthält genau dieselben regulären Resultate wie die Kurve, inklusive Datum, Laufkennung/Rang, Wind, Wettkampf und Ort. Neueste Tage oben. Gleicher Wettkampftag wird anhand gelieferter h/r/v-, qf-, sf-, f-Kennungen geordnet; keine tatsächlichen Startzeiten erfunden. Unbekannte Kennungen behalten Quellenreihenfolge.
- Aktuelle SA-Quelle separat geprüft, 104 Resultate, Stand 03.10.2026. Am 05.09.2026 standen die 100-m-Läufe in Quellenreihenfolge 11.96 (3qf4), 12.07 (4f1), 12.26 (9h8). Kurve nun Vorlauf/Qualifikation/Final: 12.26, 11.96, 12.07. Leistung und Wind unverändert. 11.82 mit +3.1 m/s am 11.07.2026 bleibt ausserhalb der regulären Kurve. Reale jüngste Quelldaten als gezielte Regressionfixture.
- Klarere Tracklinien, dezente Bahnnummern 1–6, Widget- und Dialogtitel in #1e3a8a. V1-Archiv unverändert. 24 Tests und 27 Chromium-Layoutprüfungen bestanden, zusätzliche echte Home-/Analyse-Zoominteraktionen mit Tabelle geprüft.

## Darstellung und Laufbezeichnungen 04.10.2026
- Home-/Analyse-Zoomtabellen: neueste Tage zuerst, innerhalb eines Tages schnellste Zeit zuerst. WA-Resultattabellen ebenso; Sprung-/Wurfdisziplinen nach grösster Leistung. Die Kurve behält ihre Laufchronologie, Tabellen verändern keine Quelldaten.
- Zentraler Formatter für Lauf/Rang in Resultatkarten, Details, Kurventooltips und WA-Tabellen/Details: h/v = Vorlauf, qf = Viertelfinale, sf = Halbfinale, f = Finale; Rang vor dem Kürzel, Laufnummer danach (keine behauptete Bahnnummer). r wird neutral als Serie bezeichnet. Textkennungen und reine Ränge werden lesbar dargestellt; unbekannte Werte bleiben erhalten.
- Dakar: kompakte Wetterzeile mit SVG-Symbol, Temperatur, Zustand, Wind und Modellzeit; Antippen zeigt gefühlte Temperatur, Luftfeuchte, Quelle und vollständigen Datenstand. Vergleich mit der Version vor Wetter (aaa5a45): bei 320 px 298.58 statt 315.89 px Kartenhöhe, bei 390 px 302.58 statt 319.89, bei 1440 px 263.19 statt 284.
- Hintergrund: app-eigene SVG-Bahnkurven, sechs Bahnen mit Startmarkierungen und Zahlen, in allen Ansichten hinter den Karten. Reduzierte Deckkraft nach visueller Prüfung.
- Meilensteine mit lokal gespeicherten echten Wappen für Waadt, Nordmazedonien, Bern, Italien, Senegal. Rieti: internationale 100-m-Limite erreicht, Status verletzt; keine Teilnahme oder Leistung behauptet. Bildnachweise in ASSET_CREDITS.md und Footer verlinkt.
- Resultatkarten: breitere Zeitspalte, dezente Trennlinie und mehr Abstand zum Veranstaltungstext. 27 Tests sowie 27 responsive Chromium-Layoutprüfungen bestanden; Dakar-Höhe und Chart-/Resultatdialoge zusätzlich geprüft. V1-Archiv unverändert.

## Flaggen und weicher Athletenheader 04.10.2026
- Internationale Meilensteine zeigen jetzt Nationalflaggen statt der zuvor gewünschten Landeswappen: Nordmazedonien, Italien und Senegal für Dakar. Schweizer Kantonswappen bleiben erhalten. Nordmazedonien als geprüftes Original-SVG, Italien exakte vertikale Trikolore, Senegal vorhandenes korrektes SVG. Quellen in ASSET_CREDITS.md.
- Dakar: Maskottchen und Titel als gemeinsame zentrierte Gruppe; Flagge rechtsbündig unter dem Titel. Wetter bleibt kompakt. Höhe bei 320/390/1440 px: 278.58/281.58/244.19 px, weiterhin kleiner als vor der Wetterergänzung.
- Globaler Fiona-Header mit drei app-eigenen Tracklinien. Originalporträt ohne harten Rahmen, CSS-Masken für weiche Seiten- und Unterkanten; Originaldatei und Fotozoom unverändert.
- 28 Tests und alle 27 Chromium-Layoutprüfungen bestanden, Screenshots von Handy und Desktop visuell geprüft. V1-Archiv unverändert.

## Fiona-Markierung 04.10.2026
- Eigene Resultatkarten mit dezentem blauem Hintergrund und schmaler Innenlinie. In Wettkampf-Top-5-Tabellen ist Fionas Zeile blau markiert, unabhängig von der Reihenfolge Fiona Matt / Matt Fiona. Falls sie nicht in den gelieferten Top 5 enthalten ist, wird ihre eigene gelieferte Leistung als separate markierte Zeile ergänzt; Rang/Lauf aus eigenem Resultat, keine fremden Resultate überschrieben. V1-Archiv unverändert.
