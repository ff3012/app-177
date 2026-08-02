# Heimatfeuerwehr V4: Kompaktes Fuhrpark-Widget, Kalender-Synchronisierung, Admin-Buchungsübersicht

## Context

Das Modul "Meine Feuerwehr" (Mitgliederseite) + "Verwaltung Heimatfeuerwehr" (Admin) wurde in zwei
vorherigen Runden gebaut (Basis-Modul + V3-Ausbaustufe), beide committed. Der App-Owner hat nach dem
ersten realen Blick auf `/meine-feuerwehr` (Screenshot) und einem Live-Test mit einem echten
"Admin Feuerwehr"-Konto vier Punkte zurückgemeldet:

1. Die Fuhrpark-Sektion auf der Übersichtsseite nimmt zu viel Platz ein (jedes Fahrzeug als eigene
   Karte mit eingebetteter Buchungsliste) - soll durch ein kompaktes Dropdown ersetzt werden.
2. Ausgeborgte Fahrzeuge sollen als normale Termine im (bereits bestehenden) Haupt-Kalender-Modul
   auftauchen, mit Fahrzeug und Buchendem im Titel.
3. Admins der Heimatfeuerwehr sollen ALLE Fahrzeug-Buchungen (nicht nur pro Fahrzeug einzeln) einsehen
   und auch löschen können.
4. **Echter, bestätigter Bug**: ein reiner "Admin Feuerwehr" (Membership-Admin einer Feuerwehr, kein
   Abschnittskommando-Admin) sieht den Menüpunkt "Verwaltung" im Haupt-Nav gar nicht - kann die
   Heimatfeuerwehr-Verwaltung dadurch praktisch nicht erreichen, obwohl die dahinterliegende
   Berechtigungslogik bereits korrekt ist.

Alle vier Punkte wurden im Dialog geklärt (siehe Entscheidungen je Abschnitt unten).

## A. Kompaktes Fuhrpark-Widget auf `/meine-feuerwehr`

Die aktuelle Fuhrpark-Sektion (jedes aktive Fahrzeug als Karte mit eingebetteter, kommender
Buchungsliste) wird ersetzt durch:
- Ein `<select>` mit allen aktiven Fahrzeugen der eigenen Heimatfeuerwehr
- Einen "Ausborgen"-Button daneben, der zu `/meine-feuerwehr/buchen?vehicleId=<id>` navigiert

`/meine-feuerwehr/buchen`'s `BookingForm` liest `vehicleId` aus den Searchparams und nutzt es als
Default-Wert für das bereits bestehende Fahrzeug-`<select>` im Buchungsformular (Datum/Start/Ende
bleiben unverändert). Der Rest der Übersichtsseite (Atemschutz-Karte, "Meine Buchungen") bleibt wie
heute.

## B. Buchungen als geschützte Kalender-Termine

- `Event` bekommt ein neues, optionales Feld `vehicleBookingId String? @unique` (1:1-Verknüpfung zu
  `VehicleBooking`) - dessen bloßes Vorhandensein markiert "dieser Termin ist buchungsverwaltet",
  keine separate Boolean-Spalte nötig.
- `createVehicleBooking` (in `meine-feuerwehr/actions.ts`) erstellt zusätzlich einen `Event`-Datensatz:
  Titel `"Fahrzeug: {taktischeBezeichnung} ({Vorname Nachname})"`, `organizationId` = die
  Heimatfeuerwehr des Buchenden, `isSectionWide: false`, `category: ALLGEMEIN`, `createdById` = der
  Buchende, `startsAt`/`endsAt` = wie die Buchung. Die Verknüpfung läuft ausschließlich über das neue
  `Event.vehicleBookingId`-Feld (gesetzt auf die `VehicleBooking`-Id direkt nach deren Erstellung) -
  `VehicleBooking` selbst braucht kein Gegenstück-Feld.
- `cancelVehicleBooking` löscht zusätzlich den verknüpften `Event`-Datensatz (falls er noch existiert -
  siehe Randfall unten), bevor/nachdem die `VehicleBooking`-Zeile gelöscht wird.
- **Bearbeitungsschutz**: `/kalender/[eventId]/bearbeiten` prüft `event.vehicleBookingId` - ist es
  gesetzt, wird statt Formular+Löschen-Button ein Hinweistext gezeigt: "Dieser Termin gehört zu einer
  Fahrzeug-Buchung. Um ihn zu ändern oder zu stornieren, gehe zu 'Meine Feuerwehr'." mit Link dorthin.
  `updateEvent`/`deleteEvent` (`kalender/actions.ts`) bekommen dieselbe Prüfung serverseitig
  (Verteidigung in der Tiefe, passend zum bereits etablierten "jede Aktion prüft selbst"-Prinzip
  dieser Codebase) - ein direkter Action-Aufruf kann den Schutz also nicht umgehen.
- `kalender/page.tsx`s Event-Tagging (`editable: canManageEventsFor(...)`) wird um
  `&& !event.vehicleBookingId` ergänzt - Doppelklick-zum-Bearbeiten in Listen-/Rasteransicht führt für
  diese Termine dadurch automatisch nicht mehr zur (ohnehin blockierten) Bearbeiten-Seite.
- **Sichtbares Symbol**: `CalendarEventInput` bekommt ein neues Feld `isVehicleBooking: boolean`. Ein
  kleines, handgerolltes Inline-SVG-Icon (passend zur bestehenden "kein Icon-Paket, Inline-SVG"-
  Konvention dieser Codebase) erscheint neben dem Titel an allen drei Stellen, an denen Termine
  gerendert werden - FullCalendar-Monatsraster-Chip (`renderEventContent` in `calendar-view.tsx`),
  Listenansicht-Zeile und mobile Karte (`event-list-view.tsx`) - alle drei lesen von diesem einen
  Feld, damit sie nicht auseinanderlaufen (dasselbe Prinzip wie beim bereits geteilten `RsvpBadge`).
- **Bewusst nicht angefasst**: die Termin-Detailseite (`/kalender/[eventId]`, Zusage/Teilnehmerliste)
  bleibt unverändert nutzbar - eine RSVP auf einen Fahrzeug-Buchungstermin ist harmlos und nicht
  Teil dieser Anfrage.
- **Akzeptierter Randfall**: Löscht ein Admin dennoch (aktuell nicht möglich durch obigen Schutz, aber
  z. B. durch direktes Prisma-Studio) den `Event`-Datensatz unabhängig, bleibt die `VehicleBooking`
  bestehen; `cancelVehicleBooking`s Lösch-Versuch des `Event` prüft daher `if (booking.vehicleBookingId)`
  statt blind zu löschen.

## C. Verwaltung: alle Fahrzeug-Buchungen einsehen/verwalten

Dritte Sektion direkt auf `/admin/heimatfeuerwehr` (neben Fuhrpark und Atemschutz): eine Tabelle mit
ALLEN Buchungen (vergangen + kommend) über ALLE Fahrzeuge der ausgewählten Feuerwehr hinweg -
Spalten Fahrzeug, Zeitraum, Gebucht von, Status (Kommend/Vergangen), Löschen-Aktion. Die bereits
bestehende `cancelVehicleBooking`-Action (aus `meine-feuerwehr/actions.ts`, deren
`canManageVehicleBooking`-Prüfung Admins der jeweiligen Feuerwehr bereits erlaubt) wird direkt
wiederverwendet, kein Duplikat in `admin/heimatfeuerwehr/actions.ts` nötig.

## D. Bugfix: "Verwaltung"-Menüpunkt für reine Feuerwehr-Admins

`src/lib/nav-items.ts`'s `getNavItems()`:
```ts
if (isSiteAdmin(user)) {
  items.push({ href: '/admin/benutzer', label: 'Verwaltung' });
} else if (canAccessHeimatfeuerwehrAdmin(user)) {
  items.push({ href: '/admin/heimatfeuerwehr', label: 'Verwaltung' });
}
```
Site-Admins landen weiterhin auf der Benutzerverwaltung (ihre bisherige Standardseite); reine
Feuerwehr-Admins landen direkt auf der einzigen Seite, die sie tatsächlich sehen dürfen.

## Kritische Dateien

**Geändert:** `prisma/schema.prisma` (Event.vehicleBookingId), `src/app/(app)/meine-feuerwehr/page.tsx`
(Fuhrpark-Widget statt Liste), `src/app/(app)/meine-feuerwehr/buchen/{page.tsx,booking-form.tsx}`
(vehicleId-Searchparam), `src/app/(app)/meine-feuerwehr/actions.ts` (Event-Erstellung/-Löschung in
createVehicleBooking/cancelVehicleBooking), `src/app/(app)/kalender/page.tsx` (isVehicleBooking-Tagging,
editable-Anpassung), `src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx` (Schutz-Hinweis),
`src/app/(app)/kalender/actions.ts` (updateEvent/deleteEvent-Schutz), `src/components/calendar/
calendar-view.tsx` + `event-list-view.tsx` (Icon), `src/app/(app)/admin/heimatfeuerwehr/page.tsx`
(neue Buchungs-Sektion), `src/lib/nav-items.ts` (Bugfix).

## Verifikation

1. `npx tsc --noEmit` + `npm run build` nach jedem Abschnitt.
2. Browser: Fuhrpark-Widget auf `/meine-feuerwehr` prüfen; Buchung anlegen und prüfen, dass ein Termin
   in `/kalender` erscheint (mit Icon), dass `/kalender/[id]/bearbeiten` den Schutz-Hinweis zeigt, und
   dass Stornieren der Buchung den Kalendertermin mit entfernt.
3. Admin-Buchungsübersicht: alle Buchungen einer Feuerwehr sehen, eine löschen, prüfen dass
   zugehöriger Kalendertermin mitverschwindet.
4. Bugfix live mit einem synthetischen Feuerwehr-only-Admin-Objekt UND - falls möglich - einem echten
   solchen Konto verifizieren: "Verwaltung" erscheint im Haupt-Nav und führt zu
   `/admin/heimatfeuerwehr`.
5. Testdaten danach aufräumen, `AskUserQuestion` vor Commit/Push.
