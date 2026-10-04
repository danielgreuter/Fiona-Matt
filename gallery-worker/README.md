# Öffentliche Fotogalerie mit geschütztem Upload

Separater Worker: bestehender Fiona-Proxy und dessen Daten bleiben unverändert. Fotos liegen in einem privaten R2-Bucket und werden vom Worker öffentlich ausgeliefert. Upload und Löschen erfordern einen gültigen langen Schlüssel. Unterschiedliche Schlüssel für Daniel und Fiona sind möglich; Schlüssel stehen ausschliesslich im Cloudflare-Secret und bleiben im Browser nur bis zum Schliessen/Abmelden im Arbeitsspeicher.

## Aktivierung im Cloudflare-Konto

1. R2-Bucket `fiona-gallery-photos` erstellen (keinen öffentlichen Bucket-Zugang einschalten).
2. Worker `fiona-gallery` mit `worker.mjs` erstellen. R2-Binding `PHOTOS` mit dem Bucket verbinden.
3. Variable `ALLOWED_ORIGIN` = `https://danielgreuter.github.io` setzen.
4. Secret `GALLERY_UPLOAD_KEYS` setzen: JSON-Objekt mit Namen und jeweils einem zufällig erzeugten Schlüssel von mindestens 32 Zeichen. Beispielstruktur: `{"Daniel":"<zufälliger Schlüssel>","Fiona":"<anderer zufälliger Schlüssel>"}`. Keine Beispielwerte benutzen und keine echten Schlüssel in GitHub/Chat veröffentlichen.
5. Worker bereitstellen. Seine HTTPS-Adresse in `config.js` unter `gallery.apiBase` eintragen und die App veröffentlichen.
6. Galerie öffnen, Fotos verwalten, Schlüssel eingeben. Ein Testfoto veröffentlichen, nach Abmelden öffentliche Anzeige prüfen und nach erneuter Anmeldung löschen.

Alternativ mit Wrangler aus diesem Verzeichnis:

```bash
npx wrangler login
npx wrangler r2 bucket create fiona-gallery-photos
npx wrangler secret put GALLERY_UPLOAD_KEYS
npx wrangler deploy
```

Daten: `/photos` GET listet mit Cursor jeweils 100 Bilder; POST lädt ein Foto hoch. `/auth` POST prüft den Schlüssel. `/photos/<id>` GET liefert das Bild; DELETE entfernt es nach Authentifizierung. CORS ist auf den App-Ursprung begrenzt. Keine Anmeldung für Besucher nötig. Datum, Titel und Album sind optional/kurz begrenzt. Maximal 8 MB pro Upload, serverseitig geprüft. Der Browser rechnet Fotos auf höchstens 2048 Pixel um und schreibt frische JPEGs ohne ursprüngliche EXIF-Metadaten. HEIC nur, wenn das Gerät das Format selbst dekodieren kann; sonst JPEG-Export nötig.

Wichtig: Alben und Fotos sind öffentlich. Der Worker entfernt EXIF nicht für direkt per API gesendete Dateien; für manuelle API-Uploads vorher Metadaten entfernen. Keine Schlüssel im URL-Query, in Local Storage, Logs oder Repository speichern. Für Widerruf einen Eintrag im Secret entfernen/ersetzen. R2-/Workers-Kosten und Limits im eigenen Konto prüfen, bevor erstmals aktiviert wird.

Offizielle Dokumentation: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ und https://developers.cloudflare.com/workers/configuration/secrets/

## Nachträglich beschriften

Nach diesem Update den gesamten aktuellen `worker.mjs`-Inhalt im Cloudflare-Editor ersetzen und Deploy klicken. Bestehende R2-Bindings und Secrets beibehalten. `POST /photos/<id>` aktualisiert Titel, Beschreibung, Album und Aufnahmedatum nach derselben Schlüsselprüfung. Das Bild und seine ID bleiben erhalten. Die App zeigt bei einem alten Worker eine klare Update-Meldung.

Teilen nutzt auf unterstützten Handys die Gerätefreigabe inklusive Bilddatei (WhatsApp als Ziel wählbar); andernfalls wird ein öffentlicher Fotolink über WhatsApp angeboten.
