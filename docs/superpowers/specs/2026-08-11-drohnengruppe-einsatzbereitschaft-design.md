# Drohnengruppe: Einsatzbereitschaft-Dashboard

**Status:** Approved, ready for implementation planning.
**Quelle:** Nutzeranfrage, setzt direkt auf der bereits gemergten Ausbildungsstufen-Datenerfassung
(`DrohnengruppeMembership.bos1AusbildungAm`/`a2LizenzAm` etc.) und der bestehenden
`ninety-day-rule.ts` auf. Entspricht der in `Verwaltung-Filter-Brief.md` §6.1 skizzierten
"Einsatzbereitschaft"-Phase, die bei der Ausbildungsstufen-Erweiterung bewusst zurückgestellt wurde
(siehe CLAUDE.md, Abschnitt "Ausbildungsstufen (Verwaltung)").

## 1. Zweck

Eine Ampel-Übersicht der Einsatzbereitschaft aller Piloten mit BOS1-Ausbildung, für zwei
Zielgruppen: Admin einer einzelnen Drohnengruppe (sieht nur die eigene Gruppe) und
Bezirksadmin/Bezirks-Drohnenadmin (sieht alle Gruppen mit Drilldown).

Drei Kategorien für Piloten MIT `bos1AusbildungAm`:

- **GRÜN** ("einsatzbereit"): ≥ `NINETY_DAY_REQUIRED_FLIGHTS` (3) Flüge im 90-Tage-Fenster.
- **GELB**: genau 2 Flüge im Fenster.
- **ROT**: 0 oder 1 Flug im Fenster ("90-Tage-Regel ausgelaufen" bzw. nie erfüllt - beide Fälle
  werden nicht unterschieden, siehe §3).

Plus zwei Kennzahlen pro Gruppe: Mitglieder gesamt, Mitglieder mit A2-Zertifikat
(`a2LizenzAm` gesetzt).

## 2. Route & Zugriff

Neue Seite `src/app/(app)/admin/drohnen/einsatzbereitschaft/page.tsx`. Kein neuer Eintrag in
`lib/admin/nav-items.ts`/`AdminSidebarNav`/`AdminMobileTabs` - stattdessen ein Link
"Einsatzbereitschaft ansehen" oben auf der bestehenden `/admin/drohnen`-Seite (analog zur
"Historie"-Verlinkung bei Fahrzeugen in Heimatfeuerwehr: eine Unterseite, erreichbar über einen
In-Page-Link, kein eigener Nav-Eintrag). Der Link übergibt die aktuell gewählte Gruppe als
`?group=<selectedGroup.id>`.

**Zugriffsmodell identisch zu `/admin/drohnen`**: `allowedGroups` wird exakt gleich berechnet
(`isBezirksAdmin(user) ? allGroups : allGroups.filter((g) => canManageDroneGroupFor(user, g))`),
`notFound()` wenn leer. Das deckt Bezirksadmin, Bezirks-Drohnenadmin, Abschnittsadmin des
verankerten Abschnitts und Admin der eigenen Gruppe einheitlich ab - keine neue
Berechtigungsfunktion nötig.

Ob die Kacheln-Übersicht (mehrere Gruppen) oder direkt die Detailliste (eine Gruppe) gerendert
wird, hängt schlicht von `allowedGroups.length > 1` ab, nicht von einer Rollenprüfung - das deckt
beide Zielgruppen automatisch ab und bleibt korrekt, falls ein Abschnittsadmin je mehr als eine
Gruppe verwalten sollte.

## 3. Berechnung (`src/lib/drone/einsatzbereitschaft.ts`, neu)

Baut auf `NINETY_DAY_REQUIRED_FLIGHTS`/`getNinetyDayCutoff()` aus `ninety-day-rule.ts` auf
(keine neuen Magic Numbers):

```typescript
export type EinsatzbereitschaftStatus = 'GRUEN' | 'GELB' | 'ROT';

export interface PilotEinsatzbereitschaft {
  id: string;
  name: string;
  flightCount: number;
  status: EinsatzbereitschaftStatus;
}

export interface GruppenEinsatzbereitschaft {
  droneGroupId: string;
  droneGroupName: string;
  totalMembers: number;
  a2Count: number;
  pilots: PilotEinsatzbereitschaft[]; // nur Mitglieder MIT bos1AusbildungAm, sortiert siehe unten
}

export function classifyFlightCount(flightCount: number): EinsatzbereitschaftStatus {
  if (flightCount >= NINETY_DAY_REQUIRED_FLIGHTS) return 'GRUEN';
  if (flightCount === NINETY_DAY_REQUIRED_FLIGHTS - 1) return 'GELB';
  return 'ROT';
}

export async function getGruppenEinsatzbereitschaft(droneGroupId: string): Promise<GruppenEinsatzbereitschaft>;
```

`getGruppenEinsatzbereitschaft` lädt (in einem `Promise.all`, gleiches Muster wie
`admin/drohnen/page.tsx`):

- Gruppenname (`prisma.droneGroup.findUniqueOrThrow`).
- Alle `DrohnengruppeMembership`-Zeilen der Gruppe mit `user.{id,firstName,lastName}`,
  `bos1AusbildungAm`, `a2LizenzAm` (neue, dedizierte Query - **nicht** `listDrohnengruppeMembers`
  erweitern, da diese Funktion von Flugformular/90-Tage-Bericht geteilt wird und dort keine
  Ausbildungsfelder braucht).
- Flugzahlen im 90-Tage-Fenster via `prisma.droneFlight.groupBy({ by: ['pilotUserId'], where: {
  startsAt: { gte: getNinetyDayCutoff() }, pilotUser: { droneMembership: { droneGroupId } } },
  _count: { _all: true } })` - identische Query wie die bisherige, jetzt entfernte Sektion auf
  `/admin/drohnen` (siehe §5).

`totalMembers` = Anzahl aller geladenen Mitgliedschaften. `a2Count` = Anzahl mit gesetztem
`a2LizenzAm`. `pilots` enthält nur Mitglieder mit gesetztem `bos1AusbildungAm`, sortiert nach
Dringlichkeit: ROT zuerst, dann GELB, dann GRÜN; innerhalb einer Kategorie alphabetisch
(`lastName`, dann `firstName`) - wer Aufmerksamkeit braucht, steht oben, nicht rein alphabetisch
wie die übrigen Tabellen dieses Moduls.

Mitglieder ohne `bos1AusbildungAm` erscheinen **nicht** in `pilots` - nur implizit in der
Differenz `totalMembers - pilots.length`, die auf der Detail-Ansicht nicht separat ausgewiesen
wird (siehe Nicht-Ziele).

Für die bezirksweite Kacheln-Ansicht wird diese Funktion einmal pro Gruppe in `allowedGroups`
aufgerufen (`Promise.all`, aktuell max. 4 Gruppen - kein Performance-Problem, gleiches Muster wie
die bestehende `allGroups`/`allowedGroups`-Verarbeitung).

## 4. UI

**Mehrere Gruppen** (`allowedGroups.length > 1`): Kachel-Grid oben, eine Kachel pro Gruppe mit
Gruppenname, den beiden Kennzahlen (Gesamt, A2) und drei kleinen Ampel-Zähl-Badges
(z. B. "2 · 1 · 1" in Grün/Gelb/Rot-Tönen). Klick auf eine Kachel setzt `?group=<id>` (Link, kein
Client-State) und markiert sie als aktiv. Ohne `?group=` ist die erste erreichbare Gruppe
Standardauswahl (gleiches Muster wie `selectedGroup` auf `/admin/drohnen`).

**Eine Gruppe** (`allowedGroups.length === 1`): kein Kachel-Grid, direkt die Detail-Sektion für
diese eine Gruppe.

**Detail-Sektion**: zwei Kennzahlen-Kacheln oben (Mitglieder gesamt, A2-Zertifikat), darunter eine
Tabelle (Name / Flüge 90 Tage / Ampel-Badge) für `pilots` der ausgewählten Gruppe, sortiert wie in
§3. Badge-Farben verwenden die bestehenden `success`/`warning`/`danger`-Tokens (gleiche Familie
wie die 3-stufigen Atemschutz-Badges in Heimatfeuerwehr `getExpiryStatus`) - keine neuen Farben.
Mobile: Karten-Fallback unterhalb `sm:`, Tabelle darüber - identisches Muster wie die bestehende
Flug-Tabelle (`flight-table.tsx`).

Leerer Zustand (Gruppe ohne BOS1-Piloten): Hinweistext statt leerer Tabelle, analog zur
bestehenden "Keine Mitglieder dieser Drohnengruppe hinterlegt."-Meldung.

## 5. Änderung an /admin/drohnen

Die bestehende Sektion "Mitglieder · 90-Tage-Status" (binäres Erfüllt/Offen-Badge, ohne
BOS1-Voraussetzung, siehe `page.tsx` Zeilen 99-154 im aktuellen Stand) wird vollständig entfernt -
inklusive der dafür genutzten `listDrohnengruppeMembers`/`prisma.droneFlight.groupBy`-Aufrufe auf
dieser Seite: `members`, `flightCounts` und `countByPilot` werden auf dieser Seite ausschließlich
für diese Tabelle berechnet (verifiziert durch Lesen der aktuellen Datei) und können ersatzlos aus
dem `Promise.all`/der Destrukturierung entfernt werden - `drones`/`documents` bleiben unverändert
an ihren Positionen. An ihrer Stelle: ein schlichter Link/Button "Einsatzbereitschaft ansehen" →
`/admin/drohnen/einsatzbereitschaft?group=<selectedGroup.id>`, platziert wo vorher die Tabelle
stand.

## 6. Nicht-Ziele

- Kein Self-View für einfache Mitglieder - bleibt Admin-only, wie der bestehende 90-Tage-Bericht
  und `GroupStatusChart`.
- Keine automatischen Benachrichtigungen/E-Mails bei ROT-Status - reine Anzeige.
- Keine separate Ausweisung "Mitglieder ohne BOS1" als eigene Liste/Zahl auf der Detail-Ansicht -
  nur implizit über `totalMembers - pilots.length` errechenbar, nicht extra angezeigt.
- Keine Änderung an der BOS1-Dateneingabe (`UserFormSheet`), der 90-Tage-Regel-Logik selbst
  (`ninety-day-rule.ts` bleibt unverändert) oder am Berechtigungsmodell
  (`canManageDroneGroupFor` bleibt unverändert).
- Keine Unterscheidung zwischen "hatte nie 2+ Flüge" und "hatte sie, jetzt abgelaufen" innerhalb
  von ROT.

## 7. Abnahme

- Ein Admin einer einzelnen Drohnengruppe sieht auf `/admin/drohnen/einsatzbereitschaft` direkt
  die Detail-Ansicht seiner Gruppe, ohne Kachel-Grid.
- Ein Bezirksadmin/Bezirks-Drohnenadmin sieht ein Kachel-Grid aller Gruppen mit korrekten
  Kennzahlen und Ampel-Zählungen, kann per Klick in jede Gruppe hineindrillen.
- Ein BOS1-Pilot mit 3+ Flügen in 90 Tagen erscheint GRÜN, mit genau 2 GELB, mit 0-1 ROT.
- Ein Mitglied ohne BOS1-Ausbildung erscheint nicht in der Piloten-Liste, fließt aber in
  "Mitglieder gesamt" ein.
- `/admin/drohnen` zeigt die alte Erfüllt/Offen-Tabelle nicht mehr, stattdessen einen Link zur
  neuen Seite mit vorausgewählter Gruppe.
