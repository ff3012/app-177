# Drohnengruppe Flugbuch: Qualifikations-Filter

**Status:** Approved, ready for implementation planning.
**Quelle:** Nutzeranfrage nach dem gerade gemergten Flugbuch-Redesign (`/drohnen`). Baut direkt auf
den fünf Ausbildungsfeldern von `DrohnengruppeMembership` auf (`a1a3LizenzAm`/`a2LizenzAm`/
`stuetzpunktausbildungAm`/`bos1AusbildungAm`/`bos2AusbildungAm`), bereits vorhanden aus der
"Drohnengruppe Ausbildungsverfolgung"-Erweiterung.

## 1. Zweck

Ein neuer, Admin-only Filter „Qualifikation" auf `/drohnen`, mit dem sich Piloten nach erreichter
Ausbildungsstufe eingrenzen lassen — Mehrfachauswahl, sechs Optionen:

- A1/A3 Pilotenlizenz (`a1a3LizenzAm` gesetzt)
- A2 Pilotenlizenz (`a2LizenzAm` gesetzt)
- Stützpunktausbildung (`stuetzpunktausbildungAm` gesetzt)
- BOS1 Ausbildung (`bos1AusbildungAm` gesetzt)
- BOS2 Ausbildung (`bos2AusbildungAm` gesetzt)
- Ohne Ausbildung (`a1a3LizenzAm` NICHT gesetzt — da die Stufen aufeinander aufbauen, bedeutet ein
  ungesetztes A1/A3 automatisch, dass keine der fünf Stufen erreicht ist)

Wirkt auf beide admin-sichtbaren Bereiche der Seite: die Flugliste (nur Flüge von Piloten mit den
gewählten Qualifikationen) und die Gruppenstatus-Balkenliste (nur Mitglieder mit den gewählten
Qualifikationen). Admin-only, wie der bestehende „Pilot"-Filter — für ein reines Mitglied ergibt
eine Qualifikations-Auswertung anderer Piloten keinen Sinn und wird nicht angeboten.

## 2. Mehrfachauswahl-Logik: UND

Bei mehreren aktivierten Optionen muss ein Pilot ALLE ausgewählten Bedingungen gleichzeitig
erfüllen (UND, nicht ODER — bestätigte, bewusste Entscheidung des App-Owners).

Zwei Konsequenzen, beide bewusst nicht extra abgefangen, sondern einfache Folgen der UND-Logik:

- Da die Stufen sequenziell aufeinander aufbauen (wer BOS1 hat, hat automatisch A2 und A1/A3),
  kollabiert z. B. „BOS1 UND A2" praktisch auf „BOS1" — kein Fehler, nur eine redundante, aber
  korrekte Kombination.
- „Ohne Ausbildung" gleichzeitig mit irgendeiner echten Stufe ausgewählt ergibt konsequent immer 0
  Treffer (widersprüchlich: kann nicht gleichzeitig `a1a3LizenzAm IS NULL` und z. B.
  `bos1AusbildungAm IS NOT NULL` sein, letzteres impliziert ersteres als gesetzt). Die UI verhindert
  diese Kombination nicht aktiv — sie ergibt sich einfach zu einer leeren Liste, wie jede andere
  widersprüchliche Filterkombination auch.

## 3. Datenquelle: eine gemeinsame, erweiterte Mitgliederabfrage

Die bestehende `listDrohnengruppeMembers` (`src/lib/drone/members.ts`) bleibt unverändert — sie
wird an mehreren anderen Stellen geteilt (Flugformular, 90-Tage-Bericht) und braucht dort keine
Ausbildungsfelder (siehe CLAUDE.md: "keep it that way rather than duplicating").

Stattdessen ersetzt `/drohnen/page.tsx` seine aktuelle `members`-Abfrage (aktuell
`listDrohnengruppeMembers(selectedGroup.id)`, Ergebnis wird bereits doppelt verwendet — für die
Gruppenstatus-Liste UND die Optionen des Pilot-Selects) durch eine neue, eigene Abfrage direkt auf
`DrohnengruppeMembership`, die zusätzlich zu Name/ID auch die fünf Ausbildungsfelder lädt. Diese
eine erweiterte Liste bedient jetzt DREI Verwendungszwecke statt zwei: Gruppenstatus-Namen,
Pilot-Select-Optionen, und die Qualifikations-Filterung — eine einzige Quelle, kein Risiko des
Auseinanderlaufens zwischen Flugliste und Gruppenstatus-Liste.

Neue Hilfsfunktion `matchesQualification(membership, selected: string[]): boolean` in
`src/lib/drone/` (exakter Dateiname im Plan) — nimmt ein Objekt mit den fünf Ausbildungsfeldern
plus die Liste der aktuell ausgewählten Filter-Keys (wiederverwendet die bestehenden
`Ausbildungsstufe`-Feldnamen aus `@/lib/validation/user.schema` als Vokabular, plus ein eigener
Sonderwert `'NONE'` für „Ohne Ausbildung" — keine parallele, zweite Aufzählung der fünf Stufen).

Ablauf in `page.tsx`: erweiterte Mitgliederliste laden → für jedes Mitglied `matchesQualification`
gegen die aus der URL gelesene Auswahl prüfen → daraus eine `Set<string>` passender `userId`s
bilden → diese Set filtert sowohl die an `GroupStatusList` übergebenen Piloten als auch (via
`pilotUserId: { in: [...] }` in der bestehenden `filterWhere`-Konstruktion) die Flug-Query. Wenn
kein Qualifikations-Filter aktiv ist, wird dieser zusätzliche `pilotUserId`-Constraint einfach
weggelassen (nicht auf "alle IDs" aufgeblasen).

## 4. UI: hand-gerollter Mehrfachauswahl-Dropdown

Kein shadcn `Popover`/`Command` — das Drohnengruppe-Modul ist bewusst nicht auf shadcn umgestellt
(siehe CLAUDE.md, "zwei Komponenten-Philosophien nebeneinander"). Stattdessen ein einfacher,
client-seitiger Button+Panel-Umschalter (die `FlightSidebar`-Komponente ist bereits `'use client'`):
ein Button „Qualifikation" (mit Zähler-Suffix bei aktiver Auswahl, z. B. „Qualifikation (2)"), der
ein Panel mit sechs Checkboxen öffnet/schließt. Platziert direkt unter dem bestehenden
Pilot/Drohne/Zeitraum-Select-Block, oberhalb der Zweck-Farblegende.

## 5. URL-Zustand

Neuer Parameter `?qualifikation=` als kommagetrennte Liste der ausgewählten Keys (z. B.
`?qualifikation=bos1AusbildungAm,a2LizenzAm`) — reiht sich in das bestehende Muster ein (übersteht
Reload, als Link teilbar, setzt `take` beim Ändern zurück wie jeder andere Filter). Der leere
Zustand (kein Parameter) bedeutet „kein Qualifikations-Filter aktiv", nicht „alle sechs
ausgewählt".

## 6. Nicht-Ziele

- Keine Änderung an `DrohnengruppeMembership`, `listDrohnengruppeMembers`, oder den bestehenden
  fünf Ausbildungsfeldern selbst — reine Leseabfrage auf bereits vorhandenen Daten.
- Kein Filter für einfache Mitglieder (Admin-only, wie der bestehende Pilot-Filter).
- Keine Änderung an der Ausbildungsdaten-Eingabe (`UserFormSheet`) oder der Einsatzbereitschaft-
  Ampel (`/admin/drohnen/einsatzbereitschaft`) — dieser Filter ist rein für das Flugbuch.

## 7. Abnahme

- Genau ein aktivierter Filter (z. B. „BOS1") zeigt Flugliste und Gruppenstatus-Liste nur für
  Piloten mit gesetztem `bos1AusbildungAm`.
- Zwei sequenziell verschachtelte Filter (z. B. „BOS1" + „A2") liefern dasselbe Ergebnis wie nur
  „BOS1" allein.
- „Ohne Ausbildung" + eine echte Stufe gleichzeitig liefert eine leere Liste, keinen Fehler.
- Filterzustand übersteht Reload und ist als Link teilbar.
- Ein einfaches Mitglied sieht den Filter nicht.
- Gruppenstatus-Liste und Flugliste zeigen für dieselbe Filterauswahl immer dieselbe Personenmenge.
