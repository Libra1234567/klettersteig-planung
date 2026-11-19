# Serverseitiger Tourenimport

Die PHP-API liest eine öffentliche Tourenseite als HTML und gibt erkannte Werte als JSON zurück. Sie führt kein JavaScript der Zielseite aus und speichert keine importierten Daten. Das Admin-Formular übernimmt Werte nur in leere Felder; vor dem lokalen Speichern müssen sie kontrolliert werden.

## Voraussetzungen und Installation

1. PHP **8.1 oder neuer** mit der Erweiterung **cURL** auf dem Webspace aktivieren. DOM verbessert das HTML-Parsing, ist aber optional.
2. `api/import.php` und `api/config.php` gemeinsam in das Verzeichnis `api/` auf dem Webspace hochladen. Die Adresse muss anschließend etwa `https://meine-domain.at/api/import.php` lauten.
3. In `api/config.php` `https://YOUR-USER.github.io` durch den **Origin** der veröffentlichten GitHub-Pages-Site ersetzen, also ohne Pfad oder abschließenden Slash. Alternativ `STEIGWETTER_ALLOWED_ORIGINS` als kommagetrennte Liste exakter Origins setzen.
4. In `js/import-config.js` `https://YOUR-WEBSPACE-DOMAIN.example/api/` durch die API-Basisadresse ersetzen. Den abschließenden Slash beibehalten.
5. Die Änderungen an `admin.html`, `css/style.css`, `js/admin.js` und den neuen JavaScript-Dateien auf GitHub Pages veröffentlichen.

HTTPS für den Webspace wird empfohlen. Für den Serverabruf werden ausschließlich öffentliche IPv4-Ziele an Standard-HTTP(S)-Ports akzeptiert. DNS-Adressen werden geprüft und beim Abruf fest gebunden; Weiterleitungen werden höchstens dreimal verfolgt und vor jedem Abruf erneut geprüft. Downloadgröße und Timeouts sind in `config.php` begrenzt. Wenn der Webspace ausgehende cURL-Verbindungen oder DNS-Abfragen sperrt, muss der Hostinganbieter diese Funktion freischalten.

## Verhalten und Grenzen

- Parser nutzen Seitentitel, Meta-Beschreibung, sichtbaren Seitentext, beschriftete Kartenlinks und ausgewählte Koordinatenformate. Nicht jede Tourenseite veröffentlicht maschinenlesbare Daten.
- GPS wird nur automatisch einem Einstieg oder Gipfel zugeordnet, wenn Beschriftung oder Textkontext dies stützt. Nicht zuordenbare GPS-Funde werden als Kandidaten angezeigt und bleiben aus den GPS-Formularfeldern heraus.
- Importiertes GPS bleibt **unverifiziert**. Die gelb markierten Werte und Quellenhinweise müssen geprüft werden; das Importieren setzt keine Verifizierungscheckbox.
- Es werden nur Felder des bestehenden Formular-/Datenmodells übernommen. Erkannte Höhenmeter erscheinen in der Ergebnisanzeige, werden aber nicht in ein neues Datenfeld geschrieben, weil das bestehende Formular dafür kein Feld besitzt.
- Die API gibt `rawText` für den ergänzenden JavaScript-Fallback zurück. Der bereinigte Text wird auf 16.000 Zeichen begrenzt.
- Die CORS-Allowlist schützt Browserzugriffe, ersetzt keine Server-Firewall oder Hosting-seitige Missbrauchsbegrenzung. Die SSRF-Prüfungen bleiben unabhängig davon aktiv.

## Manuelle Tests nach dem Upload

Über Admin → **Neuer Klettersteig** testen und vor dem Speichern kontrollieren:

1. Eine Tourenseite mit Name, Schwierigkeit und Zeiten: erkannte Werte erscheinen; vorher ausgefüllte Felder bleiben unverändert.
2. Eine Seite ohne GPS: Name/andere Funde werden gezeigt, GPS-Felder bleiben leer und eine verständliche Warnung erscheint.
3. Eine Seite mit Schwierigkeit wie `C/D`, `D/E` oder `C–D`: der Parser normalisiert erkannte Grade.
4. Ungültige URL, `file:`-URL sowie `localhost`/private IP: verständliche Ablehnung.
5. Nicht erreichbare Seite, Nicht-HTML-Antwort und Weiterleitung auf ein lokales Ziel: verständliche Ablehnung; lokales Ziel wird nicht abgerufen.
6. Unvollständige Seite: nur erkannte Werte übernehmen; nicht vorhandene Werte leer lassen.
7. Vor dem Import Name oder GPS-Feld manuell ausfüllen: dieser Wert bleibt erhalten; Konflikte werden angezeigt.
8. Abbrechen, lokal speichern, JSON exportieren sowie bestehende Einträge bearbeiten/löschen: vorhandene Admin-Funktionen bleiben unverändert.

Der Entwicklungscontainer für diese Änderung enthält kein PHP-Binary. Deshalb konnte `php -l` oder ein echter cURL-Endpunktlauf hier nicht durchgeführt werden. PHP-Lint und die obigen HTTP-/SSRF-Tests müssen nach dem Upload auf einem PHP-Webspace ausgeführt werden.
