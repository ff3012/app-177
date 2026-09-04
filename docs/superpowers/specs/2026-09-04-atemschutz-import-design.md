# Atemschutz-Untersuchungen: Excel-Import — Design

## Ziel

Das manuelle Erfassen der Atemschutztauglichkeit (Untersuchung + Finnentest, siehe "Atemschutz"-Sektion
in `docs/superpowers/specs`/root `CLAUDE.md`) ist für einen Admin mit vielen Mitgliedern zu mühsam. Dieses
Feature fügt einen Excel-Import hinzu, der den offiziellen Untersuchungs-Export (Format bestätigt anhand
einer realen Beispieldatei, Sheet `ExportResults`, Spalten `FW-Nr`/`Feuerwehr`/`StbNr`/`Vorname`/`Zuname`/
`Geb.Datum`/`Alter Jahre`/`Untersuchtungsart`/`Untersuchtungsdatum`/`Tauglichkeitsart`) direkt einliest und
die betroffenen Mitglieder in großer Zahl auf einmal aktualisiert.

Dies **ersetzt eine frühere, bewusste Entscheidung** ("Atemschutz-Export hat keinen Import-Gegenpart -
bulk-editing safety-critical medical/compliance data via spreadsheet upload was judged too risky", siehe
`src/app/(app)/meine-feuerwehr/CLAUDE.md`) — explizit vom App-Betreiber jetzt gewünscht, mit den unten
beschriebenen Absicherungen (per-Zeile-Fehlerbehandlung, kein stillschweigendes Überschreiben, Ergebnis-
Zusammenfassung).

## Scope

**In Scope:**
- Neuer Excel-Import auf `/admin/heimatfeuerwehr`, org-gescoped wie der bestehende Fuhrpark-Import.
- Zwei neue Felder auf `User`: roher Tauglichkeits-Status-Text für Untersuchung und Finnentest.
- Aus dem Status-Text abgeleitete Ampel-Anzeige (grün/rot/neutral) in der bestehenden Atemschutz-Tabelle.
- Bedingtes Setzen von `atemschutzGueltigBis`, wenn der Status-Text eine erkennbare Gültigkeitsdauer
  ("für N Jahre") enthält.
- Die zwei neuen Status-Felder werden auch in `AtemschutzEditDialog` (Einzelbearbeitung) editierbar, damit
  sie nicht nur per Import pflegbar sind.

**Explizit außerhalb des Umfangs:**
- Kein Excel-Export-Gegenstück für die zwei neuen Status-Felder in dieser Runde.
- Keine strukturierte Kategorisierung (Enum) der Tauglichkeitsart - der Rohtext wird 1:1 gespeichert,
  explizite Entscheidung des App-Betreibers, um keine Information aus dem Original-Export zu verlieren und
  robust gegenüber künftigen, noch unbekannten Formulierungen zu bleiben.
- Keine Änderung an der bestehenden Finnentest-Gültigkeits-Logik (fixe 1-Jahres-Frist, unverändert).

## Datenmodell

Zwei neue nullable Felder auf `User` (additive Migration):

```prisma
// Roher Tauglichkeitsart-Text aus dem Atemschutz-Untersuchungs-Import (siehe docs/superpowers/specs/
// 2026-09-04-atemschutz-import-design.md) - bewusst Freitext statt Enum, um keine Information aus dem
// Original-Export zu verlieren. Rein informativ/Anzeige, keine eigene Validierungslogik daran gekoppelt.
atemschutzStatus           String?
atemschutzFinnentestStatus String?
```

Kein neues Enum, keine History-Tabelle - wie die bestehenden Atemschutz-Datumsfelder ein einzelner,
überschreibbarer aktueller Wert pro Mitglied.

## Import-Logik

**Spaltenzuordnung**: Header-Name-basiert (wie der bestehende Benutzer-/Fuhrpark-Import), nicht feste
Spaltenreihenfolge - erwartete Header: `FW-Nr`, `StbNr`, `Untersuchtungsart`, `Untersuchtungsdatum`,
`Tauglichkeitsart` (die übrigen Spalten der Beispieldatei - `Feuerwehr`, `Vorname`, `Zuname`, `Geb.Datum`,
`Alter Jahre` - werden nicht benötigt, da `StbNr` bereits die eindeutige Zuordnung liefert; werden beim
Einlesen ignoriert, ihr Fehlen bricht den Import nicht ab).

**Matching**: `FW-Nr` muss der `Organization.nummer` der aktuell auf der Seite gewählten Feuerwehr
entsprechen - eine Zeile für eine andere Feuerwehr wird als Fehler ("Zeile gehört zu einer anderen
Feuerwehr") übersprungen, nicht verarbeitet. Innerhalb dieser Feuerwehr wird `StbNr` gegen `User.stbNr`
gematcht (`homeOrganizationId` = die gewählte Feuerwehr). Kein Treffer → Zeile übersprungen, Grund
"Standesbuchnummer nicht gefunden" in der Ergebnisliste.

**Gate**: Eine gematchte Zeile wird nur verarbeitet, wenn `istAtemschutzgeraeteTraeger === true` für den
gematchten Nutzer gilt - sonst übersprungen, Grund "kein Atemschutzgeräteträger" in der Ergebnisliste. Die
Anfrage war explizit konditional ("Wenn der Benutzer... aktiviert ist, dann importiere") - der Import
aktiviert dieses Flag nicht selbst.

**Pro gültiger Zeile, verzweigt nach `Untersuchtungsart`**:
- `"Atemschutztauglichkeit"` → setzt `atemschutzUntersuchungAm` = `Untersuchtungsdatum`,
  `atemschutzStatus` = `Tauglichkeitsart` (Rohtext, ungekürzt). Enthält der Text ein Muster
  `für\s+(\d+)\s+Jahr` (Regex, case-insensitive), wird zusätzlich `atemschutzGueltigBis` =
  `Untersuchtungsdatum + N Jahre` gesetzt - **überschreibt einen vorhandenen Wert unbedingt**, auch wenn
  der zuvor manuell vom Admin angepasst wurde (bewusste Entscheidung des App-Betreibers). Ohne
  erkennbares Muster bleibt `atemschutzGueltigBis` unverändert.
- `"Atemschutz Leistungstest"` → setzt `atemschutzFinnentestAm` = `Untersuchtungsdatum`,
  `atemschutzFinnentestStatus` = `Tauglichkeitsart` (Rohtext). Kein Gültig-bis-Feld betroffen (Finnentest
  hat weiterhin nur die bestehende fixe 1-Jahres-Frist, siehe `getFinnentestExpiryDate`).
- Ein unbekannter `Untersuchtungsart`-Wert (weder der eine noch der andere String) → Zeile als Fehler
  ("Unbekannte Untersuchtungsart") übersprungen.

**Mehrere Zeilen für dieselbe (Mitglied, Untersuchtungsart)-Kombination** (in der Beispieldatei nicht
aufgetreten, aber das Exportformat garantiert das nicht): die Zeile mit dem neuesten `Untersuchtungsdatum`
gewinnt, alle anderen werden ignoriert (nicht als Fehler gezählt, da sie regulär zum selben Ergebnis
beitragen - nur die zeitlich neueste Zeile schreibt tatsächlich).

**Ampel-Ableitung** (reine Anzeige-Logik, ein gemeinsamer Helper für Untersuchung und Finnentest, nichts
wird gespeichert): Text (kleingeschrieben) enthält `"untauglich"` oder `"nicht bestanden"` → rot
(untauglich); sonst enthält er `"tauglich"` oder `"bestanden"` → grün (tauglich); sonst (leer oder
unbekannte Formulierung) → neutral/grau, Text wird trotzdem angezeigt. Anhand der 11 in der Beispieldatei
vorkommenden Werte verifiziert (siehe Testing unten).

**Fehlerbehandlung**: identisches Muster zum bestehenden Fuhrpark-/Benutzer-Import - jede Zeile wird
unabhängig in einem eigenen try/catch verarbeitet, ein Fehler in einer Zeile bricht den Batch nicht ab. Am
Ende zeigt die UI eine Ergebniszusammenfassung: Anzahl importiert, Anzahl übersprungen (mit Grund je
Zeile), Anzahl Fehler (mit Grund je Zeile).

## UI

- Neue Karte "Atemschutz-Untersuchungen importieren" auf `/admin/heimatfeuerwehr`, direkt beim
  bestehenden Atemschutz-Abschnitt platziert (nicht bei Fuhrpark) - gleiches Upload-Formular-Muster wie
  die Fuhrpark-Import-Karte, org-gescoped auf die aktuell über `?org=` gewählte Feuerwehr.
- Die bestehende Atemschutz-Tabelle bekommt zwei neue Zellen (Untersuchung/Finnentest), die die Ampel
  plus den Rohtext zeigen, neben den bereits vorhandenen Datumsspalten.
- `AtemschutzEditDialog` bekommt zwei neue einfache Text-Inputs für die beiden Status-Felder, damit sie
  auch ohne Excel-Import pflegbar bleiben.

## Fehlerbehandlung (Sonderfälle)

- Eine Zeile mit einer inzwischen deaktivierten oder überhaupt nicht existierenden Feuerwehr (`FW-Nr` ohne
  passende `Organization`) → Fehler "Feuerwehr nicht gefunden", nicht verarbeitet.
- Ein nicht parsbares Datum in `Untersuchtungsdatum` → Fehler "Ungültiges Datum", Zeile übersprungen.
- Eine leere/fehlende `Tauglichkeitsart` → Datum wird trotzdem importiert (Kernanfrage), Status bleibt
  `null`, Ampel zeigt "kein Status" statt einer Farbe.
- `User.stbNr` ist schemaseitig nicht eindeutig (kein `@unique`). Matchen mehrere aktive Mitglieder derselben
  Feuerwehr dieselbe `StbNr`, ist die Zeile nicht eindeutig zuordenbar → Fehler "Standesbuchnummer mehrfach
  vorhanden, Zeile übersprungen", statt willkürlich das erste Suchtreffer zu verwenden.

## Testing

Kein automatisierter Test-Suite im Projekt (Projektkonvention). Verifikation: `npx tsc --noEmit`,
`npm run build`, plus manuelle Prüfung gegen die lokale Dev-Datenbank mit einem Ausschnitt der echten
Beispieldatei (`202608 - Untersuchungen.xlsx`) - Import-Ergebniszusammenfassung korrekt (importiert/
übersprungen/Fehler-Zählung stimmt mit den Testzeilen überein), Ampel-Farbe korrekt für alle 11 in der
Beispieldatei vorkommenden Tauglichkeitsart-Werte, `atemschutzGueltigBis` nur bei den zwei "für N Jahre"-
Zeilen gesetzt und bei den übrigen 9 unverändert, Gate korrekt (ein Mitglied ohne
`istAtemschutzgeraeteTraeger` wird übersprungen und nicht automatisch aktiviert).
