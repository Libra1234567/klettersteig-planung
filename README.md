# Steigwetter

Ein statisches, mobiloptimiertes Klettersteig-Wetterportal mit HTML, CSS und Vanilla JavaScript. Die Seite läuft ohne Build-Schritt direkt über GitHub Pages.

## Lokal starten

JSON-Dateien können im Browser aus Sicherheitsgründen nicht zuverlässig mit `file://` geladen werden. Starte einen lokalen statischen Webserver im Projektordner, zum Beispiel:

```bash
python -m http.server 8000
```

Öffne anschließend `http://localhost:8000`. Es werden keine Pakete installiert.

## Bedienung

- Mit **Heute**, **Morgen** und **Übermorgen** wechselst du zwischen den drei Prognosetagen.
- Über **Startpunkt** wählst du Oberndorf bei Salzburg oder Hagenberg im Mühlkreis. Die angezeigte Entfernung ist ausschließlich die Luftlinie.
- Filter für Schwierigkeit, Land und Gebirgsgruppe/Region grenzen die Tourenliste ein.
- Die Tourenkarten sortieren nur vollständige Prognosen mit bestätigten Einstiegs- und Gipfelkoordinaten; bei Gleichstand entscheidet die Luftlinienentfernung.
- AlpinVerse-Community-Bewertungen werden separat angezeigt und gehen nicht in den Wetterscore ein.
- Karte und Tourenkarte öffnen dieselbe Detailansicht mit Einstiegs- und Gipfelwerten, Stundenübersicht, Datenqualität und externen Tourenlinks.
- Beim Öffnen werden zuerst Wetterpunkte aus dem `localStorage`-Cache geladen; nur fehlende oder ältere Einträge werden automatisch nachgeladen. Cache-Laufzeit: 60 Minuten. **Wetter aktualisieren** lädt alle gültigen Einstieg- und Gipfelpunkte erneut. Die Kopfzeile zeigt Wetterstand, Cachetreffer, neu geladene und fehlgeschlagene Wetterpunkte.
- Ein Datensatz ohne bestätigte Koordinaten bleibt in der Liste, wird aber nicht mit erfundenen Wetterwerten bewertet.

## Wetter- und Kartendaten

Wetter kommt von der [Open-Meteo Forecast API](https://open-meteo.com/en/docs). Für alle verfügbaren Einstieg- und Gipfelpunkte wird eine gebündelte Anfrage mit stündlichen Werten und Seehöhen zur Modell-Downscalierung gesendet. Verwendet werden Temperatur, Regenwahrscheinlichkeit und -menge, Schnee, Windrichtung, Wind und Böen, CAPE, Bewölkung, Sonnenscheindauer sowie Sonnenaufgang und -untergang. Der Forecast reicht bis zu 16 Tage, das Portal zeigt die nächsten drei. Die API ist ohne Schlüssel für nicht-kommerzielle Nutzung verfügbar; beachte die jeweils aktuellen Nutzungsbedingungen und Attributionshinweise von Open-Meteo.

Die Karte nutzt Leaflet und OpenStreetMap-Kacheln. Für größere öffentliche Nutzung müssen die [Nutzungsrichtlinien der OSM-Kachelserver](https://operations.osmfoundation.org/policies/tiles/) beachtet werden. Die Kacheln werden nicht lokal kopiert.

## Bewertung

Gewichtung: Niederschlag 20 %, Wind/Böen 20 %, Gewitterindikator (CAPE) 20 %, Temperatur 15 %, Schnee 15 %, Bewölkung/Sonne 10 %. Der schlechtere Wetterwert aus Einstieg und Gipfel begrenzt den Gesamtscore. Hohes CAPE zusammen mit Regenwahrscheinlichkeit, Böen ab 80 km/h und relevante Schneewerte lösen eine Sicherheitsabwertung auf maximal 25 Punkte aus. Die Ampelstufen sind: 85–100 sehr gut, 70–84 gut, 50–69 eingeschränkt, unter 50 nicht empfohlen.

CAPE ist ein modellbasierter Gewitterindikator und keine Gewitterwarnung. Die Bewertung ist eine Wetterorientierung, keine Aussage über Wegzustand, Sperren, Lawinengefahr oder persönliche Eignung. Die Prognoseunsicherheit steigt mit dem zeitlichen Abstand. Bei unbestätigten Geländepunkten wird die Datenqualität entsprechend herabgestuft.

## Daten ergänzen

Bearbeite ausschließlich `data/locations.json`. Die Datei enthält derzeit 37 Touren. Zur Kompatibilität mit der bestehenden App heißen `region` `range`, `location` `entry`, `externalLinks` `links`, `approachTime` `approachMinutes` und `climbingTime` `climbMinutes`. Die AlpinVerse-Community-Bewertung steht separat in `rating`. `verified` bezieht sich auf den jeweiligen GPS-Punkt; Höhen dürfen unabhängig davon `null` sein. Wetter wird für jeden gültigen GPS-Punkt unabhängig abgefragt, auch wenn der Punkt noch nicht bestätigt ist; solche Ergebnisse werden als eingeschränkt gekennzeichnet. Kartenmarker erscheinen nur für bestätigte Einstiegspunkte. Fehlende Daten bitte als `null` führen und nicht schätzen.

Die Datendatei enthält die 31 verbliebenen Touren aus der gefilterten AlpinVerse-Liste sowie sechs später ergänzte Klettersteige. Vorhandene Namen, Schwierigkeiten, Regionen, Länder und Bewertungen stammen aus der Liste; fehlende Koordinaten und Höhen bleiben `null`. Verifizierte Quellen sind direkt je Tour verlinkt, sofern recherchiert. Nicht bestätigte Koordinaten dürfen vorläufig in die Wetterabfrage einfließen, werden aber nicht als Kartenmarker angezeigt.

## GitHub Pages veröffentlichen

1. Lege ein GitHub-Repository an und pushe den Inhalt dieses Ordners auf den Branch `main`.
2. Öffne im Repository **Settings → Pages**.
3. Wähle unter **Build and deployment** die Quelle **Deploy from a branch**, Branch `main` und Ordner `/(root)`.
4. Speichere. Nach der Veröffentlichung erreichst du die Anwendung über die von GitHub angezeigte Pages-Adresse.

Pfad-relative Dateien und ES-Module funktionieren auch bei Projektseiten unter `/repository-name/`. Das Repository muss öffentlich sein, wenn GitHub Pages in deinem Tarif keine privaten Repositories unterstützt.

## Projektstruktur

```text
index.html
README.md
locations.json             # Hinweis auf die einzige Datenquelle
data/locations.json
css/style.css
js/app.js
js/weather.js
js/scoring.js
js/map.js
js/distance.js
js/details.js
assets/icons/              # für spätere lokale Icons reserviert
```

Externe Dienste: Open-Meteo (Wetter), OpenStreetMap (Kartenkacheln), Leaflet (Kartendarstellung) und Google Fonts (Schriftarten). Das Portal benötigt keine Build-Tools, Datenbank oder dauerhaft laufenden Server. Für die optionale KI-Recherche gibt es einen separaten GitHub-Actions-Workflow.

## Administration und Veröffentlichen

Über **Klettersteig-Verwaltung** im Dashboard (oder `admin.html`) lassen sich Touren suchen und nach Land, Region, Schwierigkeit, Sperrstatus, GPS- und Wetterstatus filtern. Datensätze können angelegt, bearbeitet, dupliziert und nach Rückfrage gelöscht werden. GPS-Punkte, Höhen, Prüfstatus, Quellen, Zeiten, Tourenlinks und Sperrinformationen sind editierbar. Auf schmalen Displays wird die Tabelle als Kartenliste dargestellt.

Änderungen werden zunächst nur im `localStorage` dieses Browsers gespeichert. Sie sind weder für andere Geräte sichtbar noch automatisch in GitHub Pages veröffentlicht. Exportiere `locations.json`, ersetze damit `data/locations.json` im Repository und veröffentliche die Änderung per Commit. JSON kann ebenfalls importiert werden. Ein manueller Sperrstatus hat Vorrang; abgelaufene Statuszeiträume werden als **Unbekannt** angezeigt und gelten nicht als offen. Gesperrte Touren werden aus den Empfehlungen genommen. Der automatische Abruf von Sperrmeldungen beliebiger Tourenseiten ist wegen fehlender verlässlicher Browserzugriffe (CORS und uneinheitliche Seiten) nicht eingebaut. Quellen müssen geprüft und mit Prüfdatum eingetragen werden.

Beim Anlegen einer Tour kann optional eine Touren-URL über den serverseitigen PHP-Importer verarbeitet werden. Dafür müssen `api/import.php` und `api/config.php` auf einem eigenen PHP-Webspace installiert, der GitHub-Pages-Origin in der API-Allowlist eingetragen und `js/import-config.js` auf die API-Adresse gesetzt sein. Anleitung, SSRF-Schutz und Testfälle stehen in [`api/README.md`](api/README.md). Importdaten werden nur in leere Formularfelder übernommen, GPS bleibt unverifiziert, und der Import speichert nichts automatisch.

Der lokale Entwurf wird mit einer später geänderten Repository-Datei zusammengeführt. Bei echten gleichzeitigen Änderungen zeigt die Verwaltung einen Konflikthinweis; vor dem JSON-Export sollten die betroffenen Datensätze geprüft werden. Es werden keine Token oder Anmeldedaten gespeichert.

## KI-Datenmanager

Öffne **KI-Datenmanager** im Dashboard oder `admin/ai-manager.html`. Der Scanner liest `data/locations.json` und prüft IDs, Pflichtangaben, GPS-Bereiche, Höhen, Zeiten, Tourenquellen, Bewertungen, Sperrstatus sowie widersprüchliche Koordinaten und Dauern. Kennzahlen und Tabellenzeilen sind filterbar. Der Scan läuft im Browser ohne API-Kosten. Prüfergebnisse aus GitHub Actions werden automatisch geladen, sobald `data/research-results.json` auf dem veröffentlichten Branch liegt; alternativ kann die Datei importiert werden. Entscheidungen und das lokale Prüfprotokoll bleiben in diesem Browser gespeichert.

### Sichere KI-Recherche und Freigabe

1. Lege in **Repository → Settings → Secrets and variables → Actions** das Secret `OPENAI_API_KEY` an. Der Schlüssel wird nur im Workflow genutzt, nie an das Frontend ausgeliefert.
2. Erlaube unter **Settings → Actions → General → Workflow permissions** GitHub Actions, Pull Requests zu erstellen. Der Workflow verwendet dafür den kurzlebigen Repository-Token mit `contents: write` und `pull-requests: write`.
3. Starte unter **Actions → AI route research proposals → Run workflow** einen Modus. `scan` ist lokal/kostenfrei; `gps`, `tour`, `closure`, `single` und `all` nutzen Websuche. `single` benötigt eine Route-ID. Ein Lauf recherchiert höchstens 10 Touren. Weitere Läufe setzen die Arbeit fort; erfolgreiche Recherche wird 30 Tage übersprungen, sofern `force` nicht aktiviert wird.
4. Die Recherche erstellt einen Pull Request nur mit `data/research-results.json`, `data/research-history.json` und einem Bericht. `data/locations.json` bleibt unangetastet. Nach Prüfung kann dieser Vorschlags-PR gemergt werden, damit der Manager die Ergebnisse lädt.
5. Im Manager prüfst du jeden Feldvorschlag samt Altwert, Quelle, Begründung, Vertrauensstufe und Konfliktstatus. Freigaben erfolgen pro Feld. Exportiere die Freigabe als `approved-changes.json` und lege sie im Repository unter `data/approved-changes.json` ab.
6. `Apply reviewed location changes as pull request` prüft die Freigabeliste gegen aktuelle Werte, Route-IDs, erlaubte Felder, Quellen, Vertrauensschwelle, GPS-Werte und doppelte IDs. Die Action erstellt danach einen Pull Request für `locations.json`, Historie und Änderungsbericht. Erst dessen manuelles Merge aktualisiert die Produktivdaten.

Das statische Frontend besitzt absichtlich keine GitHub-Schreibberechtigung: Nach dem Export muss die Freigabedatei über GitHub eingecheckt werden. Dadurch bleibt das Pages-Frontend geheimnisfrei; ungeprüfte Werte werden nie automatisch veröffentlicht. Bei Zweifeln, widersprüchlichen Quellen, Parkplatz- statt Einstiegspunkten oder unklaren Varianten sind Vorschläge als Konflikt markiert und müssen manuell geprüft werden.

Die OpenAI-Websuche kostet laut aktueller Preisliste $10 je 1.000 Aufrufe zuzüglich Modell- und Suchtext-Tokens. Fünf Touren entsprechen damit etwa $0,05 Suchaufrufkosten plus Tokenkosten; tatsächliche Kosten hängen von den Antworten und dem verwendeten Modell ab. Prüfe vor größeren Läufen die [OpenAI API-Preisliste](https://developers.openai.com/api/docs/pricing). GitHub Actions benötigt außerdem die Repository-Einstellung zum Erstellen von Pull Requests; siehe [GitHub-Dokumentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).

### Entwicklungstests

Ohne zusätzliche Abhängigkeiten: `node --test tests/data-validator.test.mjs` und `python -m unittest discover -s tests -p "test_*.py"`. Der Test für den OpenAI-Endpunkt benötigt ein GitHub Actions Secret und sollte als echter Lauf bewusst manuell gestartet werden, da Websuche kostenpflichtig ist.
