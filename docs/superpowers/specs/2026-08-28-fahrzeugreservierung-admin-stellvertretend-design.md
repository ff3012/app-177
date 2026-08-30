# Fahrzeugreservierung: Admin bucht stellvertretend — Design

## Ziel

Aktuell kann jedes Feuerwehrmitglied ein Fahrzeug nur für sich selbst buchen (`VehicleBooking.userId`
= der handelnde Nutzer, keine Unterscheidung zwischen "wer bucht" und "für wen"). Dieses Feature
erlaubt es einem Feuerwehr-Admin, eine Fahrzeugreservierung **im Namen eines beliebigen Mitglieds**
seiner Heimatfeuerwehr anzulegen — ohne die bestehende Genehmigungspflicht (falls für die
Organisation konfiguriert), da der Admin die Buchung ja bereits selbst verantwortet.

## Scope

**In Scope:**
- Neues Auswahlfeld "Fahrzeugreservierung für" im Buchungsformular, sichtbar nur für Admins der
  jeweiligen Heimatfeuerwehr (`canManageHeimatfeuerwehrFor`).
- Auswahl "Ich selbst" (Standard) → unverändertes heutiges Verhalten, inklusive bestehender
  Genehmigungspflicht falls `fahrzeugReservierungEmails` konfiguriert.
- Auswahl eines anderen Mitglieds → sofort `GENEHMIGT`, kein Genehmigungs-Workflow, zwei
  Benachrichtigungs-E-Mails (Kontakte + betroffenes Mitglied), Kalender zeigt das gewählte Mitglied
  als Fahrer.
- Neues, optionales `bookedByAdminId`-Feld auf `VehicleBooking` als Audit-Trail (analog zu
  `DroneFlight.registeredBy`/`pilotUser`).

**Explizit außerhalb des Umfangs:**
- Buchung für Mitglieder einer *anderen* Heimatfeuerwehr als der des Fahrzeugs (kein
  organisationsübergreifendes Buchen) — die Auswahl bleibt auf Mitglieder der Fahrzeug-Organisation
  beschränkt, genau wie das Buchungsformular selbst heute schon auf Fahrzeuge der eigenen
  Organisation beschränkt ist.
- Änderungen an der bestehenden Genehmigungs-Workflow-Logik für Nicht-Admin-Buchungen — die bleibt
  1:1 wie heute.
- Stornieren/Bearbeiten einer stellvertretend angelegten Buchung — nutzt die bereits bestehenden
  `canManageVehicleBooking`/`cancelVehicleBooking`, keine Änderung nötig.

## Datenmodell

`VehicleBooking` bekommt ein neues, nullable Feld:

```prisma
bookedByAdmin User? @relation("VehicleBookingBookedByAdmin", fields: [bookedByAdminId], references: [id], onDelete: SetNull)
bookedByAdminId String?
```

`userId` (unverändert im Namen) bedeutet ab jetzt konzeptionell **"Fahrer"** (für wen die Buchung
ist) — bei einer normalen Selbst-Buchung sind Fahrer und buchende Person identisch, wie bisher.
`bookedByAdminId` ist `null` außer bei einer stellvertretenden Buchung, wo es den handelnden Admin
festhält. Migration additiv (neue nullable Spalte + FK), keine Datenmigration bestehender Zeilen
nötig.

## Formular (`meine-feuerwehr/buchen/booking-form.tsx` + `page.tsx`)

`page.tsx` lädt zusätzlich: `canManageHeimatfeuerwehrFor(user, vehicleOrganizationId)` und, falls
`true`, die Mitgliederliste der Organisation (gleiches Muster wie
`heimatfeuerwehrPickerMembers` in `admin/heimatfeuerwehr/page.tsx`: `prisma.user.findMany({ where:
{ homeOrganizationId, ...NOT_DEACTIVATED_WHERE }, orderBy: [...], select: { id, firstName,
lastName, email } })`).

`BookingForm` bekommt eine neue optionale Prop `bookingForMembers?: { id, firstName, lastName }[]`
— wenn vorhanden (also der Nutzer Admin ist), wird ein zusätzliches `<select name="bookingForUserId">`
gerendert, dessen erste Option "Ich selbst" den Wert der **eigenen User-ID** des Admins trägt (kein
Leerstring-Sentinel nötig), gefolgt von einer Option pro Mitglied. Nicht-Admins sehen dieses Feld gar
nicht (Prop nicht übergeben → kein Rendering) — für sie bleibt `bookingForUserId` im FormData schlicht
nicht vorhanden.

## Server-Logik (`createVehicleBooking`)

Liest das neue optionale `bookingForUserId`-Feld aus `FormData`. Zwei Zweige:

1. **Feld fehlt, oder ist gleich der eigenen ID** ("Ich selbst"): exakt der heutige Code-Pfad, unverändert.
2. **Eine andere, gültige User-ID** (muss zur selben Organisation wie das Fahrzeug gehören und
   `canManageHeimatfeuerwehrFor` muss für den handelnden Nutzer zutreffen — sonst Fehler, nie
   stillschweigend ignorieren): neuer Zweig —
   - `VehicleBooking` wird direkt mit `status: 'GENEHMIGT'`, `userId: bookingForUserId`,
     `bookedByAdminId: user.id` angelegt (kein `approvalToken`, kein `OFFEN`-Zwischenzustand,
     unabhängig davon ob `fahrzeugReservierungEmails` konfiguriert ist).
   - `Event` wird sofort angelegt (identischer Titel-Aufbau wie heute: liest jetzt automatisch den
     Namen des Fahrers, da der von `userId` kommt).
   - `pushEventToGoogleCalendar(bookingEvent)` wie im bestehenden Genehmigungs-Pfad.
   - Zwei E-Mails, beide best-effort (nie blockierend, wie jede andere E-Mail-Versandstelle in
     dieser Codebase):
     - **Info-Mail an `fahrzeugReservierungEmails`** (neue Vorlage, rein informativ, keine
       Genehmigen/Ablehnen-Links — z. B. "{Admin-Name} hat für {Fahrer-Name} ein Fahrzeug
       reserviert: {Bezeichnung}, {Zeitraum}"). Kein Versand, falls die Liste leer ist (wie beim
       bestehenden Genehmigungs-Anfrage-Pfad).
     - **Info-Mail an das ausgewählte Mitglied** ("{Admin-Name} hat für dich ein Fahrzeug
       reserviert: {Bezeichnung}, {Zeitraum}") — neue Vorlage, immer versendet (unabhängig von
       `fahrzeugReservierungEmails`).

## Berechtigungen

Keine neue Permission-Funktion nötig — `canManageHeimatfeuerwehrFor(user, vehicleOrganizationId)`
entscheidet, ob das "für"-Feld überhaupt angezeigt/akzeptiert wird; die Server-Action prüft dieselbe
Funktion serverseitig erneut (nie nur der Client-UI vertrauen), bevor sie den stellvertretenden Zweig
überhaupt betritt. `canManageVehicleBooking`/`cancelVehicleBooking` bleiben unverändert — der Fahrer
(`userId`) und jeder Admin der Organisation können die Buchung weiterhin verwalten, unabhängig davon
ob sie stellvertretend angelegt wurde.

## Fehlerbehandlung

- Gewählte `bookingForUserId` gehört nicht zur Organisation des Fahrzeugs, oder der handelnde Nutzer
  ist gar kein Admin dieser Organisation (z. B. manipulierte Formulardaten) → Server Action gibt
  einen Fehler zurück, legt nichts an (kein stiller Fallback auf "Ich selbst").
- E-Mail-Versand (beide neuen Vorlagen) schlägt fehl → geloggt, blockiert nie die eigentliche
  Buchung — gleiches Prinzip wie überall sonst in diesem Modul.

## Testing

Kein automatisierter Test-Suite im Projekt. Verifikation: `npx tsc --noEmit`, `npm run build`, plus
manuelle Prüfung gegen die lokale Dev-Datenbank — als Admin für ein anderes Mitglied buchen, prüfen
dass die Buchung sofort `GENEHMIGT` ist, kein `approvalToken` gesetzt wurde, der Kalender-Eintrag den
Fahrernamen zeigt, und (soweit lokal per Mailjet-Testkonfiguration prüfbar) beide E-Mails ausgelöst
werden. Zusätzlich: Buchung "für mich selbst" als Admin weiterhin unverändert über den bestehenden
Genehmigungs-Pfad läuft (Regressionscheck).
