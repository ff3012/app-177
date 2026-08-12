# Kalender: Mehrere Drohnengruppen + bezirksweiter Drohnengruppen-Termin

**Status:** Approved, ready for implementation planning.
**Quelle:** Nutzerbeobachtung nach der Bezirk-17-Erweiterung (4 Drohnengruppen statt einer) — im Kalender
lässt sich beim Anlegen eines Drohnengruppen-Termins aktuell nur „AFKDO Purkersdorf" auswählen, obwohl es
inzwischen 4 Gruppen gibt.

## 1. Root Cause (bestätigt, nicht nur vermutet)

`src/app/(app)/kalender/neu/page.tsx` und `.../[eventId]/bearbeiten/page.tsx` berechnen `droneGroupOptions`
identisch:

```ts
const droneGroupOptions = user.droneGroupId && ownDroneGroup ? [{ id: user.droneGroupId, name: ownDroneGroup.name }] : [];
```

Das ist ausschließlich die **eigene persönliche Drohnengruppen-Mitgliedschaft** des einloggten Nutzers —
niemals „alle Gruppen, die er verwalten darf". Der App-Owner sah „AFKDO Purkersdorf", weil das zufällig
seine eigene Mitgliedschaft ist, nicht weil das System bewusst auf diese eine Gruppe beschränkt wäre.

Zweiter, tieferliegender Fund: die aktuelle Sichtbarkeitsregel (`canViewEvent` in `lib/auth/permissions.ts`)
verlangt für Kategorie „Drohnengruppe" einen **exakten** Treffer `event.droneGroupId === user.droneGroupId`.
Es gibt aktuell kein Konzept für „sichtbar für alle 4 Gruppen" — `isSectionWide` hilft hier nicht, da das
Abschnitt-weit bedeutet (eine Ebene über einer Feuerwehr), nicht Bezirk-weit (eine Ebene über einem
Abschnitt).

## 2. Anforderungen

1. Jedes Mitglied einer Drohnengruppe sieht die Termine **seiner eigenen** Gruppe (Basisregel, unverändert
   im Prinzip — nur die aktuelle Beschränkung auf eine hartcodierte Gruppe entfällt).
2. Jeder Admin einer Drohnengruppe kann Termine **für seine eigene Gruppe** sehen und anlegen — auch wenn er
   sonst kein Feuerwehr-/Abschnitts-Amt hat (aktuell blockiert ihn das komplett, siehe Abschnitt 5).
3. Neuer Termin-Typ „Bezirksweiter Drohnengruppen-Termin": sichtbar für Mitglieder **aller 4** Gruppen,
   anlegbar/bearbeitbar **nur** von Bezirksadmin oder Bezirks-Drohnenadmin.

## 3. Datenmodell — keine Schema-Änderung

`Event.droneGroupId` bleibt nullable (ist es bereits). Neue Bedeutung bei Kategorie `DROHNENGRUPPE`:
**`null` heißt „bezirksweit, alle 4 Gruppen"**, statt wie bisher (fälschlich als Sonderfall behandelt)
„ungültig". Kein Migrationsaufwand.

Dieses Muster existiert in dieser Codebase bereits identisch: `NewsMessage.audienceDroneGroupId = null`
bedeutet dort schon „alle Gruppen", ein gesetzter Wert „nur diese eine Gruppe" — die hier gewählte Lösung
ist also eine Wiederverwendung eines etablierten Musters, keine neue Konvention.

**Wichtige Gegenprobe, bewusst dokumentiert:** `src/lib/push/audience.ts`'s `resolveEventAudienceUserIds`
hat aktuell einen Defensiv-Check: fehlt `droneGroupId` bei Kategorie `DROHNENGRUPPE`, wird die Zielgruppe
auf **niemanden** gesetzt, mit einem Kommentar, der auf einen echten früheren Produktions-Bug verweist (ein
fehlendes `droneGroupId` hätte sonst versehentlich an alle Drohnengruppen bezirksweit gepusht). Dieser
Check wird jetzt bewusst umgedreht — „niemand" wird zu „alle Mitglieder aller 4 Gruppen" — weil das jetzt
eine **beabsichtigte** Funktion ist, kein Fehlerfall mehr. Bei der Umsetzung explizit als bewusste
Verhaltensänderung markieren (Kommentar ersetzen, nicht nur Code ändern), damit das nicht als Regression
missverstanden wird.

## 4. Berechtigungsmodell

### 4.1 Sichtbarkeit (`canViewEvent`, `lib/auth/permissions.ts`)

Für Kategorie `DROHNENGRUPPE` wird die Regel unabhängig von Organisation/Abschnitt-weit:

```
category === 'DROHNENGRUPPE':
  sichtbar wenn canViewDroneModule(user) UND (droneGroupId === null ODER droneGroupId === user.droneGroupId)
category === 'ALLGEMEIN' (unverändert):
  eigene Feuerwehr ODER (isSectionWide UND gleicher Abschnitt)
```

Für einen Drohnengruppen-Termin spielen `organizationId`/`isSectionWide` damit für die Sichtbarkeit keine
Rolle mehr — konsistent mit dem bestehenden Formular-Kommentar „Drohnengruppe-Termine sind
gruppenübergreifend gedacht".

Dieselbe Regel ist an zwei weiteren Stellen dupliziert (mit Kommentaren, die ausdrücklich auf Synchronität
mit `canViewEvent` hinweisen) und muss identisch mitgezogen werden:
- `kalender/page.tsx` (die Kalender-Übersichts-Query)
- `src/lib/push/audience.ts`'s `resolveEventAudienceUserIds` (siehe Abschnitt 3 oben)

### 4.2 Anlegen / Bearbeiten / Löschen (`kalender/actions.ts`)

Aktuell prüft `createEvent`/`updateEvent`/`deleteEvent` zuerst `canManageEventsFor(user, organizationId)`
(„ist der Nutzer Feuerwehr-Admin dieser Organisation"). Das würde einen reinen Admin Drohnengruppe (ohne
Feuerwehr-Amt) immer blockieren. Für Kategorie `DROHNENGRUPPE` wird dieser Weg **ersetzt**, nicht ergänzt:

```
category === 'DROHNENGRUPPE':
  droneGroupId gesetzt  → erlaubt nur, wenn canManageDroneGroupFor(user, gruppe)
                          (bestehende Funktion, unverändert wiederverwendet)
  droneGroupId = null   → erlaubt nur, wenn isBezirksAdmin(user) || user.isBezirksDrohnenAdmin
category === 'ALLGEMEIN' (unverändert):
  canManageEventsFor + ggf. canCreateSectionWideEvent, wie bisher
```

**Korrektur nach Selbstprüfung:** die in `kalender/actions.ts` bereits vorhandene `assertMayUseDroneGroup`
erlaubte bisher zusätzlich „eigene Mitgliedschaft" (auch als reines, nicht-Admin-Mitglied) — das würde
Anforderung 2 verletzen, die ausdrücklich nur **Admins** einer Gruppe zum Anlegen berechtigt. Diese
Kalender-spezifische Prüfung wird daher auf ausschließlich `canManageDroneGroupFor` verengt (diese Funktion
deckt „Admin dieser Gruppe" bereits ab, zusätzlich zu Abschnitts-/Bezirksadmin). Andere Verwendungsstellen
von `droneGroupId` außerhalb des Kalenders (z. B. News-Zielgruppen) sind davon nicht betroffen.

`organizationId` bleibt Pflichtfeld in der DB (Fremdschlüssel), wird für Drohnengruppen-Termine aber nur
noch serverseitig automatisch gesetzt (bestimmte Gruppe → deren verankerte Organisation; bezirksweit → die
Heimat-Organisation des Erstellers) statt vom Nutzer ausgewählt, da es die Sichtbarkeit nicht mehr
beeinflusst. `isSectionWide` wird für diese Kategorie serverseitig ignoriert/auf `false` gesetzt.

### 4.3 Wer welche Gruppen zur Auswahl bekommt

`droneGroupOptions` wird von „nur die eigene Mitgliedschaft" ersetzt durch **jede der 4 Drohnengruppen, die
der Nutzer verwalten darf** (`canManageDroneGroupFor`, bestehende Funktion), plus — nur für Bezirksadmin/
Bezirks-Drohnenadmin — den zusätzlichen Eintrag „Alle Drohnengruppen (bezirksweit)".

| Rolle | Sieht im Drohnengruppe-Auswahlfeld |
|---|---|
| Bezirksadmin / Bezirks-Drohnenadmin | Alle 4 Gruppen + „Alle Drohnengruppen (bezirksweit)" |
| Abschnittsadmin | Die eine Gruppe, die an seinem Abschnitt verankert ist (falls vorhanden) |
| Admin einer Drohnengruppe (ohne weiteres Amt) | Nur seine eigene Gruppe |

### 4.4 Zugang zur Seite „Neuer Termin"

Erweitert von „hat irgendein Feuerwehr-/Abschnitts-Amt" (`feuerwehrAdminOrgIds.length > 0`) auf „hat ein
Feuerwehr-/Abschnitts-Amt ODER ist Admin einer Drohnengruppe" (`isDroneGroupAdmin(user)`, bestehende
Funktion). Gilt für beide Seiten (`neu`, `[eventId]/bearbeiten`).

## 5. Formular-UI (`event-form.tsx`)

Bei Kategorie „Drohnengruppe" ändert sich die Ansicht: Organisation und „Abschnitt-weiter Termin" werden
**ausgeblendet** (nicht mehr sichtbarkeitsrelevant, siehe 4.1), stattdessen nur das
Drohnengruppen-Auswahlfeld gezeigt.

- Hat der Nutzer **keinerlei** Feuerwehr-/Abschnitts-Amt (reiner Admin Drohnengruppe): das Formular zeigt
  direkt nur Titel/Beschreibung/Ort/Zeit + Drohnengruppe (fest auf die eigene Gruppe voreingestellt, keine
  Kategorie-Auswahl nötig — „Allgemein" kommt für ihn ohnehin nicht infrage, da er keine Organisation
  verwaltet).
- Hat der Nutzer zusätzlich ein Amt: die Kategorie-Auswahl „Allgemein/Drohnengruppe" bleibt wie bisher, nur
  dass bei „Drohnengruppe" die oben beschriebene reduzierte Ansicht erscheint statt
  Organisation+Abschnitt-weit-Checkbox.

## 6. UX-Ergänzung: „Bezirksweit"-Label

Ein bezirksweiter Termin bekommt in Liste und Detailseite ein kleines zusätzliches Label „Bezirksweit" —
rein informativ, keine neue Farbe/Ebene (`layer` bleibt `drohnengruppe`, gleiche Farbe wie bisher). Zweck:
ein Mitglied, das den Termin sieht, versteht sofort, warum („das ist nicht meine übliche Gruppen-Aktivität,
sondern ein bezirksweiter Termin").

## 7. Nicht-Ziele

- Keine Änderung an der .ics-Feed-Logik — Drohnengruppen-Termine (inkl. bezirksweite) bleiben dort weiterhin
  komplett ausgeschlossen (Token-basiert, keine Mitgliedschaftsprüfung möglich), wie heute schon.
- Keine Änderung am Google-Kalender-Rückschreiben — betrifft Drohnengruppen-Termine ohnehin nicht.
- Keine Ausweitung, wer bezirksweite Termine **sehen** darf, über die 4 Gruppen hinaus — weiterhin nur, wer
  `canViewDroneModule` hat (Mitglied irgendeiner der 4 Gruppen). Kein „jeder Feuerwehr-Angehörige sieht das".
- Kein neues Ebenen-Konzept (`layer`) — siehe Abschnitt 6.

## 8. Abnahme

- Ein Bezirksadmin/Bezirks-Drohnenadmin sieht beim Anlegen eines Drohnengruppen-Termins alle 4 Gruppen plus
  „Alle Drohnengruppen (bezirksweit)".
- Ein Abschnittsadmin sieht nur die an seinem Abschnitt verankerte Gruppe (falls vorhanden).
- Ein reiner Admin Drohnengruppe (ohne Feuerwehr-/Abschnitts-Amt) kann die Seite „Neuer Termin" erreichen
  und einen Termin für seine eigene Gruppe anlegen.
- Ein Mitglied der Gruppe X sieht Termine der Gruppe X sowie jeden bezirksweiten Termin — keine Termine
  einer anderen, fremden Gruppe Y.
- Ein bezirksweiter Termin lässt sich nur von Bezirksadmin/Bezirks-Drohnenadmin anlegen/bearbeiten; ein
  Versuch durch einen Admin einer einzelnen Gruppe wird serverseitig abgelehnt, nicht nur im Formular
  versteckt.
- Die Push-Zielgruppe eines bezirksweiten Termins umfasst Mitglieder aller 4 Gruppen; die eines
  gruppenspezifischen Termins weiterhin nur dessen eigene Gruppe.
- Ein bezirksweiter Termin zeigt das „Bezirksweit"-Label in Liste und Detailseite.
