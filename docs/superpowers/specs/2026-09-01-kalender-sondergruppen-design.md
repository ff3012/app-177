# Kalender: Sondergruppen & Bezirk-weite Termine — Design

## Ziel

Der Kalender füllt sich mit Terminen unterschiedlichster Interessengruppen (Feuerwehrjugend,
Schadstoffgruppe, Kommanden, ...) über alle Organisationsebenen (Heimatfeuerwehr, Abschnitt,
Bezirk). Nicht jedes Mitglied ist Teil jeder dieser Gruppen. Dieses Feature gibt jedem Mitglied
eine persönliche, gespeicherte Möglichkeit, seinen Kalender auf die für ihn relevanten
Terminarten zu reduzieren, und erweitert die Termin-Erstellung um eine dritte
Geltungsbereichs-Stufe ("Bezirk-weit") für normale Termine, die es bisher nur für
Drohnengruppen-Termine gab.

## Scope

**In Scope:**
- Neue, über die Verwaltung erweiterbare `Sondergruppe`-Tabelle (Startbefüllung: Feuerwehrjugend,
  Schadstoffgruppe, Kommanden).
- Optionales `Sondergruppe`-Auswahlfeld im Termin-Formular für `ALLGEMEIN`-Termine.
- Dritte Geltungsbereichs-Stufe "Bezirk-weit" für `ALLGEMEIN`-Termine (bisher nur eigene
  Feuerwehr/Abschnitt-weit), nur für Bezirks- und Abschnittsadmins anlegbar.
- Persönliche, serverseitig gespeicherte Filtereinstellung pro Mitglied: welche Sondergruppen
  werden im eigenen Kalender ein-/ausgeblendet. Standard: alle ausgeblendet (Opt-in).
- Neue Verwaltungsseite (Abschnitt in `/admin/bezirksverwaltung`) zum Anlegen/Umbenennen/
  Deaktivieren von Sondergruppen, Bezirksadmin-only.

**Explizit außerhalb des Umfangs:**
- Die Drohnengruppen-Kategorie (`EventCategory.DROHNENGRUPPE`) bleibt vollständig unverändert -
  eigene Mitgliedschafts-Sperre, eigenes Sichtbarkeitsmodell, taucht in dieser Erweiterung nicht
  als "Sondergruppe" auf. Sie war in der ursprünglichen Anfrage genannt, weil sie schon eine
  bestehende Kalender-Kategorie ist, nicht weil sich an ihrer Sichtbarkeit etwas ändern soll -
  explizit vom Nutzer bestätigt.
- Kein echtes Zugriffs-Gate pro Sondergruppe (wie bei der Drohnengruppe) - die Filtereinstellung
  ist reine persönliche Anzeige, keine Sicherheitsgrenze. Wer einen Termin heute schon sehen darf,
  sieht ihn weiterhin, unabhängig von seiner eigenen Filtereinstellung.
- Keine Änderung an `canManageEvent` (wer einen Termin bearbeiten/löschen darf) - die
  Sondergruppe ist reine Zusatzinformation, keine neue Berechtigungsdimension.

## Datenmodell

Neue Tabelle:

```prisma
model Sondergruppe {
  id        String  @id @default(cuid())
  name      String  @unique
  sortOrder Int     @unique
  isActive  Boolean @default(true)

  events Event[]
}
```

`Event` bekommt zwei neue, additive, nullable Felder:

```prisma
sondergruppeId String?
sondergruppe   Sondergruppe? @relation(fields: [sondergruppeId], references: [id], onDelete: SetNull)

// Bezirk-weit - additiv neben dem bestehenden isSectionWide, kein Umbau des bestehenden Felds.
// Nur für category === ALLGEMEIN relevant, wie isSectionWide auch.
isDistrictWide Boolean @default(false)
```

`User` bekommt ein neues Feld für die persönliche Filtereinstellung:

```prisma
ausgeblendeteSondergruppenIds String[] @default([])
```

Startbefüllung von `Sondergruppe` (Feuerwehrjugend/Schadstoffgruppe/Kommanden) über `prisma/seed.ts`,
gleiches idempotentes Upsert-Muster wie `Dienstgrad`.

## Termin-Formular & Berechtigungen

Die bestehende "Abschnitt-weiter Termin"-Checkbox wird für `ALLGEMEIN`-Termine zu einer
3-stufigen Auswahl:
- Eigene Feuerwehr (Standard, entspricht heutigem unchecked-Zustand)
- Abschnitt-weit (entspricht heutigem `isSectionWide: true`)
- Bezirk-weit (neu, `isDistrictWide: true`)

"Bezirk-weit" ist nur auswählbar, wenn eine neue Berechtigungsfunktion
`canCreateBezirksWideEvent(user)` zutrifft: `isBezirksAdmin(user) ||
user.abschnittAdminOrgIds.length > 0` - jeder Abschnittsadmin (nicht nur für den eigenen
Abschnitt), zusätzlich zu Bezirksadmins. Serverseitig erneut geprüft in `createEvent`/`updateEvent`,
nicht nur clientseitig ausgeblendet.

Ein neues, optionales "Sondergruppe"-Auswahlfeld (Standard "Keine") erscheint zusätzlich zur
Kategorie-Auswahl, nur für `ALLGEMEIN`-Termine (analog dazu, wie die bestehende
Geltungsbereichs-Auswahl schon heute nur für diese Kategorie sichtbar ist, siehe
`event-form.tsx`s `!isDroneCategory`-Guard). Wer einen Termin bearbeiten/löschen darf, bleibt
unverändert an `canManageEvent` gekoppelt - die Sondergruppe fließt in diese Prüfung nicht ein.

## Sichtbarkeit (`canViewEvent`)

Die bestehende `ALLGEMEIN`-Regel erweitert sich um eine dritte ODER-Bedingung:

> `event.organizationId === user.homeOrganizationId` ODER (`event.isSectionWide` UND gleicher
> Abschnitt) ODER `event.isDistrictWide` (sichtbar für jeden im Bezirk, unabhängig von
> Organisation/Abschnitt)

`sondergruppeId` fließt in diese Prüfung **nicht** ein - sie betrifft nur, wer den Termin
grundsätzlich sehen darf, nicht ob er ihn in seiner eigenen Ansicht ausgeblendet hat.

## Persönlicher Filter

Die Filterung nach ausgeblendeten Sondergruppen passiert **clientseitig**, exakt nach demselben
Muster wie der bestehende Ebenen-Toggle (Meine Feuerwehr/Abschnitt/Drohnengruppe) in
`KalenderFiltersContent`/`KalenderDesktopSidebar`: der Server liefert weiterhin alle Termine, die
der Betrachter laut `canViewEvent` sehen darf (unverändert), die Client-Komponente blendet
Termine mit einer in `ausgeblendeteSondergruppenIds` enthaltenen `sondergruppeId` aus der
Listen-/Grid-Ansicht aus. Kein neuer serverseitiger Filterpfad nötig, da es keine
Sicherheitsprüfung ist.

Ein neuer Abschnitt "Sondergruppen" erscheint direkt neben den bestehenden Ebenen-Togglern
(Desktop-Sidebar, Tablet-Stack, Mobile Bottom Sheet) - eine Checkbox-Liste aller aktiven
Sondergruppen. Ändert ein Mitglied eine Checkbox, wird `ausgeblendeteSondergruppenIds` über eine
neue, kleine Server Action aktualisiert (kein Formular-Submit nötig, direkter Aufruf wie die
bestehenden Toggle-Aktionen in der Verwaltung). Standard für ein Mitglied, das die Einstellung
noch nie geändert hat (`ausgeblendeteSondergruppenIds` leer): **alle Sondergruppen sind
ausgeblendet** (Opt-in) - ein leeres Array bedeutet hier bewusst "noch keine Auswahl getroffen",
nicht "alles anzeigen". Termine ganz ohne Sondergruppe (`sondergruppeId: null`, die große
Mehrheit aller Termine) sind davon nie betroffen, immer sichtbar.

## Verwaltung der Sondergruppen

Neue Sektion in `/admin/bezirksverwaltung`, neben Feuerwehren und Drohnengruppen - Anlegen (Name),
Umbenennen, Aktivieren/Deaktivieren, gleiches Formular-/Tabellen-Muster wie die bestehenden
Drohnengruppen-Verwaltung auf derselben Seite. Bezirksadmin-only
(`canManageDrohnengruppenBezirksweit`-artige neue Funktion, oder Wiederverwendung derselben
Bezirksadmin-Prüfung). Eine deaktivierte Sondergruppe bleibt an bestehenden Terminen sichtbar
(kein Cascade), verschwindet nur aus der Auswahl neuer Termine und aus der persönlichen
Filterliste für Mitglieder, die sie noch nicht sichtbar geschaltet haben.

## Fehlerbehandlung

- "Bezirk-weit" per direktem Server-Action-Aufruf ohne die nötige Berechtigung → Fehler, Termin
  wird nicht angelegt/geändert (gleiches Prinzip wie die bestehende
  `canCreateSectionWideEvent`-Prüfung).
- Eine im Formular gewählte, inzwischen deaktivierte Sondergruppe → wie bei Dienstgrad/
  Drohnengruppe-Referenzen: die Verknüpfung bleibt bestehen, nur die Auswahl-Liste für neue
  Termine zeigt sie nicht mehr an.

## Testing

Kein automatisierter Test-Suite im Projekt. Verifikation: `npx tsc --noEmit`, `npm run build`,
plus manuelle Prüfung gegen die lokale Dev-Datenbank - Bezirk-weiter Termin nur für Bezirks-/
Abschnittsadmins erstellbar (und für alle im Bezirk sichtbar, nicht nur den eigenen Abschnitt),
Sondergruppen-Filter blendet Termine korrekt aus/ein und bleibt nach Neuladen gespeichert
(direkter DB-Check des `ausgeblendeteSondergruppenIds`-Felds), Drohnengruppen-Sichtbarkeit
unverändert (Regressionscheck: ein Nicht-Mitglied sieht weiterhin keine Drohnengruppen-Termine).
