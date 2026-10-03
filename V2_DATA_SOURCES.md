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
