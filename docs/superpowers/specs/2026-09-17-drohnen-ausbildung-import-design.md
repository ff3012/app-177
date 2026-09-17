# Drohnengruppe: Bulk-Import der Ausbildungsstufen (FDISK-Export) — Design

## 0. Ziel

Ein neuer Import-Button im Drohnengruppe-Modul (`/admin/drohnen`), der einen FDISK-Export mit den
aktuellen Ausbildungsdaten (A1/A3, A2, BOS1, BOS2) für viele Mitglieder auf einmal einliest und die
entsprechenden Felder auf `DrohnengruppeMembership` aktualisiert — statt jedes Datum einzeln über
`UserFormSheet` einzutragen.

## 1. Beispieldatei

`ExportResult (10).xlsx`, Blatt `ExportResults`, Spalten (Kopfzeile):

```
Vorname | Zuname | email | StbNr | Dienstgrad | FW-Nr | Feuerwehr | A1/A3 Datum | A2 Datum | BOS1 Datum | BOS2 Datum
```

Daten als `dd.mm.yyyy`-Text oder leer. Eine reale Beispieldatei enthielt nur eine Feuerwehr (FW-Nr
`17711`, Wolfsgraben), aber die Spaltenstruktur unterstützt mehrere Feuerwehren pro Datei — der Import
muss das nicht annehmen.

## 2. Grundsatzentscheidungen (mit dem App-Betreiber geklärt)

Drei Konflikte zwischen der ursprünglichen Anforderung und dem bestehenden Code wurden vor diesem Entwurf
aufgelöst:

1. **Ausbildungsdaten bleiben auf `DrohnengruppeMembership`, nicht auf `User`.** Die ursprüngliche
   Anforderung ("alle Ausbildungen importieren, auch wenn kein Drohnengruppen-Mitglied") hätte eine
   Migration von `DrohnengruppeMembership` auf `User` gebraucht (Formularfelder sind aktuell nur sichtbar,
   wenn `droneRole !== 'NONE'`). Entscheidung: **keine Datenmodell-Änderung**. Der Import aktualisiert nur
   Zeilen von Personen, die bereits eine `DrohnengruppeMembership`-Zeile haben (unabhängig davon, welcher
   der vier Gruppen). Nicht-Mitglieder werden übersprungen und in der Zusammenfassung gezählt.
2. **"Bestehende Daten nicht überschreiben" gilt pro Feld, nicht pro Zeile.** Jedes der 4 Datumsfelder wird
   einzeln behandelt: nur ein aktuell leeres Feld wird befüllt, ein bereits gesetztes bleibt unangetastet.
3. **Stützpunktausbildung ist für BOS1/BOS2 KEINE Voraussetzung** — fachlich eine eigenständige, pro
   Drohnengruppe unterschiedliche Schulung, keine Stufe auf dem Weg zu BOS1/BOS2 (Korrektur des App-Betreibers
   gegenüber der ursprünglichen Annahme, die 5 Stufen bildeten überall eine strikte Kette). **Diese Korrektur
   gilt bewusst nur für diesen Import**, nicht app-weit: `userSchema`s Formular-Validierung, der bestehende
   Benutzer-Bulk-Import (`findAusbildungsGapError`) und `qualification-filter.ts`/`einsatzbereitschaft.ts`
   (`getExactStage()`, bricht beim ersten ungesetzten Feld ab) behandeln die 5 Stufen weiterhin als eine
   einzige strikte Kette inkl. Stützpunktausbildung — unverändert. Der Import selbst prüft die
   Vorstufen-Kette deshalb nur innerhalb der 4 tatsächlich in der Datei vorhandenen Stufen (A1/A3 → A2 →
   BOS1 → BOS2, Stützpunktausbildung wird aus dieser Kette herausgenommen): BOS1 braucht nur A1/A3 + A2
   (gesetzt oder in derselben Zeile mitgeliefert), BOS2 zusätzlich BOS1 — nie Stützpunktausbildung. Fehlt
   eine dieser 4 Vorstufen, wird nur die betroffene Stufe übersprungen und gemeldet, der Rest der Zeile wird
   trotzdem verarbeitet. **Akzeptierte Inkonsistenz** (dem App-Betreiber bewusst): eine so importierte
   Person mit gesetztem BOS1 aber ohne Stützpunktausbildung wird von `getExactStage()` andernorts (z. B.
   Einsatzbereitschaft-Stufenverteilung) weiterhin nur als "bis A2" eingestuft, bis diese anderen Stellen
   irgendwann separat angepasst werden.

## 3. Zuordnung (Matching)

Wie beim bestehenden Atemschutz-Import (`atemschutz-import/actions.ts`): FW-Nr → `Organization.nummer`,
StbNr innerhalb dieser Organisation gegen `User.stbNr` (nicht global eindeutig). Eine Zeile ohne
auflösbare Organisation oder ohne eindeutigen StbNr-Treffer wird als Fehler gezählt, nicht als Warnung.

**E-Mail-Abgleich**: weicht die Spalte `email` von der gespeicherten `User.email` ab, wird das als
**Hinweis** in der Zusammenfassung aufgeführt (nicht blockierend, ändert nichts an der gespeicherten
E-Mail) — die Datei kann laut Anforderung eine andere Adresse enthalten als die App.

**Nicht importiert**: `Vorname`/`Zuname`/`Dienstgrad`/`Feuerwehr` aus der Datei dienen nur der
menschlichen Zuordnung/Kontrolle in der Zusammenfassung, werden aber nicht auf den `User` geschrieben.

## 4. Import-Logik pro Zeile

1. Leere Zeile (kein FW-Nr/StbNr) → überspringen.
2. Organisation über FW-Nr auflösen; nicht gefunden → Fehler.
3. `User` über StbNr innerhalb dieser Organisation auflösen; nicht gefunden → Fehler; mehrdeutig (StbNr
   mehrfach in derselben Feuerwehr) → Fehler.
4. E-Mail-Abweichung prüfen → Hinweis sammeln (blockiert nichts weiteres).
5. `DrohnengruppeMembership` für diesen `User` laden (`userId` ist `@unique`, höchstens eine Zeile).
   Keine Mitgliedschaft → Zeile überspringen, Zähler "kein Drohnengruppen-Mitglied" erhöhen.
6. Für jede der 4 in der Datei vorhandenen Stufen, in dieser Reihenfolge: A1/A3 → A2 → BOS1 → BOS2
   (Stützpunktausbildung ist bewusst NICHT Teil dieser Kette, siehe Abschnitt 2.3):
   - Datei-Wert leer → nichts tun.
   - Feld in der DB bereits gesetzt → überspringen, Zähler "bereits vorhanden" erhöhen.
   - Feld in der DB leer, aber eine vorherige Stufe **dieser 4er-Kette** ist weder in der DB gesetzt noch
     durch dieselbe Zeile gerade gesetzt worden → überspringen, Zähler "Vorstufe fehlt" erhöhen, Stufenname
     in der Meldung nennen.
   - Sonst: Wert übernehmen (`prisma.drohnengruppeMembership.update`).
7. Ergebnis pro Zeile in die Gesamt-Zusammenfassung einsortieren.

## 5. Zusammenfassung (UI)

Nach dem Import zeigt der Screen (wie beim Atemschutz-Import):

- Anzahl aktualisierter Felder (gesamt, nicht pro Person — eine Person kann mehrere Felder gleichzeitig
  bekommen)
- Anzahl übersprungener Felder, weil bereits vorhanden
- Anzahl übersprungener Felder, weil eine Vorstufe fehlt (mit Zeilenverweis)
- Anzahl übersprungener Zeilen, weil kein Drohnengruppen-Mitglied
- Anzahl Fehler (Organisation/StbNr nicht gefunden oder mehrdeutig), mit Zeilenverweis
- Liste der Hinweise zu abweichenden E-Mail-Adressen, mit Zeilenverweis

## 6. Berechtigung & Einordnung im Modul

`/admin/drohnen` ist heute **pro Gruppe** gegated (`canManageDroneGroupFor`, siehe
`getAllowedDroneGroups`) — ein einzelner Gruppen-Admin sieht dort nur seine eigene Gruppe. Da eine
Import-Datei aber Mitglieder mehrerer Feuerwehren/Gruppen gleichzeitig enthalten kann, wird dieser Import
**bewusst nicht** an die aktuell auf der Seite gewählte Gruppe gebunden, sondern bezirksweit berechtigt:
**Bezirksadmin oder Bezirks-Drohnenadmin** (`isBezirksAdmin`/`isBezirksDrohnenAdmin`) — dieselbe
Berechtigungsstufe, die bereits bezirksweite Drohnengruppen-Events erfordert
(`canManageBezirksWideDroneEvent`). Ein einzelner Gruppen-Admin ohne diese Rechte sieht den Import-Link
nicht und die Server Action lehnt den Aufruf ab.

Der Link zum Import (`/admin/drohnen/ausbildung-import`) sitzt als einfacher In-Page-Link auf
`/admin/drohnen`, sichtbar nur für die oben genannten Rollen — kein eigener Eintrag in
`AdminSidebarNav`/`AdminMobileTabs`, gleiches Muster wie der bestehende Link zur
Einsatzbereitschaft-Seite.

## 7. Neue Dateien (Struktur, mirrored auf den Atemschutz-Import)

- `src/lib/drone/ausbildung-import-columns.ts` — Spalten-Definition (Header ↔ Key), analog
  `atemschutz-import-columns.ts`.
- `src/app/(app)/admin/drohnen/ausbildung-import/actions.ts` — `importAusbildung` Server Action
  (`exceljs`, Header-Namen-Auflösung, Zeile-für-Zeile-Verarbeitung wie oben, Gate auf
  Bezirksadmin/Bezirks-Drohnenadmin).
- `src/app/(app)/admin/drohnen/ausbildung-import/import-form.tsx` — Formular + Zusammenfassungs-Anzeige.
- `src/app/(app)/admin/drohnen/ausbildung-import/page.tsx` — Seite, gated wie oben.
- Link auf `/admin/drohnen/page.tsx` ergänzen.

## 8. Nicht-Ziele

- Kein Anlegen neuer Benutzer oder neuer Drohnengruppen-Mitgliedschaften.
- Kein Schreiben von Dienstgrad/Name/E-Mail aus der Datei.
- Keine Änderung an der bestehenden Präfix-Invarianten-Regel im übrigen Code (Formular, Benutzer-Bulk-Import,
  Qualifikations-Filter, Einsatzbereitschaft) — nur dieser neue Import behandelt Stützpunktausbildung als
  unabhängig von BOS1/BOS2.

## 9. Testing/Verifikation

Kein automatisierter Testlauf in diesem Repo (Projekt-Konvention). Verifikation wie beim Atemschutz-Import:
`npx tsc --noEmit` + `npm run build`, plus ein Skript gegen die lokale Dev-Datenbank mit synthetischen
Zeilen, das folgende Fälle abdeckt: normales Auffüllen eines leeren Felds, ein bereits gesetztes Feld wird
NICHT überschrieben, eine Stufe wird wegen fehlender Vorstufe **innerhalb der 4er-Kette** übersprungen (z. B.
BOS1 ohne A2) und danach durch eine zweite Zeile, die die Vorstufe UND die Stufe selbst liefert, korrekt
beides gesetzt, **BOS1 wird erfolgreich gesetzt, obwohl Stützpunktausbildung in der DB leer bleibt**
(bestätigt die Ausnahme aus Abschnitt 2.3), Nicht-Mitglied wird übersprungen, abweichende E-Mail erzeugt
einen Hinweis ohne die gespeicherte Adresse zu ändern, unbekannte FW-Nr/StbNr erzeugen einen Fehler.
