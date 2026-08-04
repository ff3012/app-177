# Google Kalender Rückschreiben: app-177 → Google Calendar (pro Heimatfeuerwehr)

## Context

Der bestehende "Externer ICS-Kalenderimport" (`src/lib/calendar/ics-import.ts`) liest nur in eine
Richtung: ein öffentlicher `.ics`-Feed (z. B. eine Google-Calendar-Freigabe-URL) wird alle 5 Minuten
in den app-177-Kalender der jeweiligen Feuerwehr importiert. Der App-Owner möchte jetzt auch die
Gegenrichtung: in app-177 angelegte Termine sollen automatisch in seinen (bzw. einer Feuerwehr)
Google-Kalender zurückgeschrieben werden.

**Technische Grundtatsache, die die gesamte Architektur bestimmt**: ein `.ics`-Feed/eine
"Kalender per URL abonnieren"-Freigabe ist bei Google Calendar strukturell nur lesend - es gibt
keinen Weg, per ICS-Datei etwas in einen Google-Kalender zu schreiben. Schreiben ist ausschließlich
über die Google Calendar REST-API mit echten Zugangsdaten möglich. Da es sich um private
Google-Konten handelt (kein Workspace mit Admin-Konsole), ist der praktikable, nicht-interaktive Weg
ein Google-Cloud-Service-Account: dessen E-Mail-Adresse wird dem Ziel-Kalender einmalig als Bearbeiter
hinzugefügt, danach kann app-177 serverseitig ohne jede Login-Interaktion schreiben.

Im Dialog mit dem App-Owner geklärt:
- Konfiguration erfolgt **pro Heimatfeuerwehr** über das Admin-UI (`/admin/heimatfeuerwehr`) - Upload
  der Service-Account-JSON-Datei + Eingabe der Ziel-Kalender-ID, kein globales Secret in `.env`.
- Zurückgeschrieben wird **sofort** (aus denselben Server Actions, die Termine anlegen/ändern/löschen),
  nicht per periodischem Cron - siehe Abschnitt "Warum sofort, nicht periodisch" unten.
- Fahrzeug-Reservierungen sollen **sobald genehmigt** zurückgeschrieben werden - ergibt sich
  automatisch daraus, dass für eine Reservierung ohnehin erst bei `GENEHMIGT` ein `Event`-Datensatz
  entsteht (bestehende Architektur, siehe `VehicleBooking`/`Fahrzeug-Reservierungen`-Abschnitt in
  `CLAUDE.md`) - keine zusätzliche Sonderlogik nötig, nur denselben Hook an den zwei Stellen einbauen,
  die dieses `Event` bereits erzeugen.

## A. Datenmodell (additiv, keine Migration bestehender Daten nötig)

```prisma
// Organization
googleCalendarServiceAccountJson String?   // rohes Service-Account-JSON, nie ans Client-UI zurückgegeben
googleCalendarId                 String?   // Ziel-Kalender-ID, unkritisch, im Formular sichtbar
googleCalendarLastSyncAt         DateTime?
googleCalendarLastSyncError      String?

// Event
googleEventId String?  // verknüpft einen app-177-Termin mit seinem Google-Calendar-Gegenstück
```

`googleCalendarServiceAccountJson` wird genauso behandelt wie das bestehende
`Organization.facebookPageAccessToken`: ein einfaches, unverschlüsseltes `String?`-Feld (kein
Field-Level-Encryption - bewusste Konsistenz mit dem bereits akzeptierten Schutzniveau für
vergleichbare Secrets in dieser Codebase, kein neuer, höherer Maßstab nur für dieses eine Feld), nie
im Server-Component-Payload an den Client gesendet - die Admin-UI bekommt nur ein
`hasGoogleCalendarCredentials: boolean` und zeigt "Hinterlegt: Ja/Nein" statt des Werts selbst, exakt
das Muster aus `DashboardFacebookConfigForm`.

Da alles in Postgres liegt (kein `.env`-Eintrag, kein neuer Docker-Volume), ist auch keine Änderung an
`docker-compose.yml`s `environment:`-Block nötig - im Gegensatz zu den bisherigen
VAPID/S3/Mailjet-Secrets, die alle Umgebungsvariablen sind. Die Zugangsdaten laufen automatisch mit
dem bestehenden `pg_dump`-Backup mit, wie schon bei den PDF-/Bild-Bytes-Feldern an anderer Stelle.

Migration ist rein additiv (vier neue nullable Spalten) - keine Backfill-Logik nötig. Beim Anlegen der
Migration den bereits einmal dokumentierten Reihenfolge-Fallstrick beachten (siehe
`CLAUDE.md`-Abschnitt zur ICS-Import-Fehlerbehebung): der neue Migrationsordner muss zeitlich nach
allen bestehenden sortieren, was bei einer normal per `npm run db:migrate` heute erzeugten Migration
automatisch der Fall ist.

## B. Zugangsdaten-Validierung beim Upload

Eine neue Server Action (z. B. `setGoogleCalendarCredentials` in `admin/heimatfeuerwehr/actions.ts`)
nimmt die hochgeladene Datei (`FormData`, `File`-Objekt - exakt das bereits etablierte Muster von
`DroneDocument`s PDF-Upload) sowie die Kalender-ID entgegen und validiert **vor dem Speichern**:

1. Datei ist parsebares JSON.
2. `type === 'service_account'`, `client_email` (String, enthält `@`), `private_key` (String, enthält
   `BEGIN PRIVATE KEY`) sind vorhanden - sonst ein freundlicher Fehler statt eine kaputte Datei
   stillschweigend zu speichern.
3. **Ein echter Test-Aufruf**: mit den Zugangsdaten wird einmalig ein Access-Token angefordert
   (`JWT.authorize()`, siehe Abschnitt C) - schlägt das fehl (falscher Schlüssel, Tippfehler, Datei vom
   falschen Service-Account), wird der Upload mit der Google-Fehlermeldung abgelehnt statt eine
   unbrauchbare Datei zu speichern. Gleiches Prinzip wie das bestehende "Jetzt synchronisieren"/"System
   Check"-Muster: der reale Pfad wird einmal wirklich ausprobiert, nicht nur oberflächlich geprüft.

Erst nach erfolgreicher Validierung werden `googleCalendarServiceAccountJson`/`googleCalendarId`
gespeichert und `googleCalendarLastSyncAt`/`googleCalendarLastSyncError` zurückgesetzt (identisches
Muster zum bestehenden `setIcsImportUrl`).

## C. Google-Calendar-Client (`src/lib/calendar/google-calendar-push.ts`, neu)

**Neue Abhängigkeit**: `google-auth-library` (offizielles, schlankes Google-Paket nur für
Authentifizierung/JWT-Signierung - RS256-JWT-Signing selbst nachzubauen wäre echte, fehleranfällige
Kryptografie-Arbeit, exakt dieselbe Abwägung, die in diesem Projekt schon einmal zum einzigen
bisherigen SDK (`@aws-sdk/client-s3`) geführt hat, statt AWS SigV4 händisch zu signieren). **Nicht**
das große `googleapis`-Paket - das bringt hunderte generierte API-Clients mit, die hier nicht gebraucht
werden. Die eigentlichen Calendar-Aufrufe (Create/Update/Delete) laufen über die `JWT`-Instanz eigene
`.request()`-Methode (übernimmt Token-Beschaffung/-Erneuerung automatisch) gegen die Calendar-v3-REST-
Endpunkte - kein separates, händisches `fetch` nötig, aber auch kein API-spezifischer generierter Code.

```ts
async function getClientForOrganization(organizationId: string): Promise<{ jwt: JWT; calendarId: string } | null>
```
Lädt `googleCalendarServiceAccountJson`/`googleCalendarId` der Organisation; gibt `null` zurück, wenn
nicht konfiguriert (der übliche "no-op wenn nicht eingerichtet"-Fall, wie bei
`getDroneFlightNotificationEmail()`).

```ts
async function pushEventToGoogleCalendar(event: Event): Promise<void>
async function deleteEventFromGoogleCalendar(event: Pick<Event, 'id' | 'organizationId' | 'googleEventId'>): Promise<void>
```

Beide Funktionen **werfen nie** - sie kapseln ihr eigenes try/catch, loggen den Fehler und schreiben
ihn in `Organization.googleCalendarLastSyncError` (+ `googleCalendarLastSyncAt` bei Erfolg), damit ein
Aufrufer sie einfach mit `await` aufrufen kann, ohne selbst ein try/catch zu brauchen - dasselbe
Prinzip wie `notifyFlightCreated()`: ein Google-API-Ausfall darf den eigentlichen Speichervorgang nie
verhindern.

`pushEventToGoogleCalendar` überspringt (no-op, kein Fehler) automatisch, wenn:
- die Organisation keine Zugangsdaten hinterlegt hat, oder
- `event.icsUid` gesetzt ist (**Schleifen-Schutz**: ein aus einem Google-Import stammender Termin wird
  nie zurückgeschrieben - unabhängig davon, ob Import- und Export-Kalender-ID identisch sind oder
  nicht, verhindert das jede Endlosschleife).

Sonst: ist `event.googleEventId` bereits gesetzt → `PATCH .../events/{googleEventId}`; sonst →
`POST .../events`, die von Google zurückgegebene `id` wird direkt per `prisma.event.update(...)` auf
`googleEventId` zurückgeschrieben.

**Feldabbildung**:
| app-177 (`Event`) | Google Calendar |
|---|---|
| `title` | `summary` |
| `description` | `description` |
| `location` | `location` |
| `startsAt`/`endsAt` (nicht `allDay`) | `start.dateTime`/`end.dateTime` (ISO ohne Offset) + `timeZone: 'Europe/Vienna'` auf beiden - explizite Zeitzone statt eines UTC-Offsets, um dieselbe Klasse von DST-Fehlern zu vermeiden, die im `TZ`/`tzdata`-Abschnitt von `CLAUDE.md` bereits einmal real aufgetreten ist |
| `startsAt`/`endsAt` (`allDay: true`) | `start.date`/`end.date` (`YYYY-MM-DD`) - **`end.date` ist bei Google exklusiv** (der Tag danach), im Gegensatz zu app-177s inklusivem `endsAt` - beim Schreiben muss ein Tag addiert werden, sonst wird ein einzelner Ganztags-Termin in Google einen Tag zu kurz angezeigt |

`deleteEventFromGoogleCalendar` ruft `DELETE .../events/{googleEventId}` auf, überspringt (no-op) wenn
kein `googleEventId` gesetzt ist, und behandelt eine `404`-Antwort (Termin in Google bereits gelöscht/
nie angekommen) als Erfolg statt als Fehler.

## D. Hook-Punkte (sechs Stellen, drei Dateien)

Kein Cron-Job für die Schreibrichtung - siehe "Warum sofort, nicht periodisch" unten. Jeder Aufruf
direkt nach dem entsprechenden Prisma-Write, mit `await` aber ohne dass der Aufrufer selbst ein
try/catch braucht (siehe Abschnitt C):

1. `kalender/actions.ts` `createEvent` - nach `prisma.event.create(...)`.
2. `kalender/actions.ts` `updateEvent` - nach `prisma.event.update(...)` (ein Termin, der vor Einführung
   dieses Features angelegt wurde, hat noch kein `googleEventId` - beim nächsten Bearbeiten wird er
   dadurch automatisch erstmalig nach Google gepusht, ein kostenloser Nachzieh-Effekt statt separater
   Backfill-Logik).
3. `kalender/actions.ts` `deleteEvent` - **vor** `prisma.event.delete(...)` (der Aufrufer hat den zu
   löschenden Datensatz inkl. `googleEventId` bereits als `existing` geladen).
4. `meine-feuerwehr/actions.ts` `createVehicleBooking`, im `!approvalEmail`-Zweig (sofortiges
   `GENEHMIGT`) - nach dem dort bereits bestehenden `prisma.event.create(...)`.
5. `lib/heimatfeuerwehr/vehicle-booking-decision.ts` `decideVehicleBooking`, im
   `decision === 'GENEHMIGT'`-Zweig - nach dem dort bereits bestehenden `prisma.event.create(...)`.
6. `meine-feuerwehr/actions.ts` `cancelVehicleBooking` - vor dem Löschen des verknüpften `Event`.

Kein Sonderfall für `isSectionWide` oder `category: DROHNENGRUPPE` - beide werden wie jeder andere
Termin behandelt, gepusht anhand der Zugangsdaten der **besitzenden** `organizationId`, unabhängig
davon, ob der Termin abschnittsweit sichtbar ist. Ebenso keine Ausnahme für
`vehicleBookingId`-Termine - die sind laut Klärung mit dem App-Owner explizit eingeschlossen.

## E. Warum sofort, nicht periodisch

Der Lese-Import kann ein periodischer Abgleich sein, weil die Quelle (der externe Feed) jederzeit den
vollständigen aktuellen Stand zeigt - ein verschwundener Termin ist am nächsten Sync einfach nicht mehr
in der Liste. Für die Schreibrichtung gilt das nicht symmetrisch: app-177 löscht `Event`-Zeilen hart
(kein Soft-Delete), ein periodischer Abgleich könnte eine Löschung strukturell gar nicht erkennen - die
Zeile ist einfach weg, es gibt nichts mehr zu vergleichen. Löschung erfordert also zwingend einen Hook
an der Löschstelle selbst; sobald der ohnehin nötig ist, ist es konsistenter, Anlegen/Ändern ebenfalls
sofort zu behandeln statt zwei verschiedene Mechanismen (Hook fürs Löschen, Cron fürs Anlegen/Ändern)
zu pflegen. Ein späterer periodischer Abgleich als reines Sicherheitsnetz (z. B. für Drift nach einer
Ausfallzeit) ist denkbar, aber laut YAGNI nicht Teil dieser ersten Version.

## F. Admin-UI (`/admin/heimatfeuerwehr`, neue Sektion "Google Kalender (Rückschreiben)")

Neue Sektion im bereits etablierten Mehr-Sektionen-pro-Seite-Format dieser Seite, analog zur
bestehenden ICS-Import-Sektion:

- Datei-Upload (`<input type="file" accept="application/json">`) mit explizitem Hinweistext direkt
  darunter: **"Nur für Google Kalender möglich"** (wortwörtlich wie vom App-Owner gewünscht) - macht
  klar, dass dieser Upload kein generisches Kalender-Export-Feature ist, sondern ausschließlich
  Google-Service-Account-JSON-Dateien akzeptiert.
- Textfeld "Google Kalender-ID" (Platzhalter z. B. `xxx@group.calendar.google.com`).
- Status-Zeile: "Hinterlegt: Ja/Nein" (nie der Wert selbst, siehe Abschnitt A), "Zuletzt
  synchronisiert: ..."/"Zuletzt fehlgeschlagen: ..." (identisches Muster zur bestehenden
  `icsImportLastSyncAt`/`icsImportLastSyncError`-Anzeige).
- "Entfernen"-Button (setzt beide Felder auf `null`) - gleiches Muster wie die
  Facebook-Access-Token-Entfernen-Checkbox.
- Kein separater "Jetzt synchronisieren"-Button nötig, da es (anders als beim Lese-Import) keinen
  Batch-Sync-Vorgang gibt, den man manuell anstoßen könnte - jede Aktion pusht bereits sofort. Der
  Upload-Vorgang selbst testet die Zugangsdaten bereits einmal echt (Abschnitt B).

## Nicht Teil dieser Version (bewusst)

- **Kein einmaliger Massen-Push bereits bestehender Termine.** Nach dem Hinterlegen der Zugangsdaten
  wird nicht automatisch die gesamte bisherige Terminliste einer Feuerwehr nach Google übertragen -
  nur ab jetzt neu angelegte/geänderte/gelöschte Termine lösen einen Push aus (inklusive des in
  Hook-Punkt 2 beschriebenen Nachzieh-Effekts beim Bearbeiten eines alten Termins). Ein Admin, der
  seine komplette Terminhistorie im Google-Kalender sehen möchte, müsste dafür jeden bestehenden
  Termin einmal anfassen (speichern) - akzeptierter Kompromiss, um keinen separaten
  Erstbefüllungs-Mechanismus zu bauen.
- Kein periodischer Abgleich/Cron für die Schreibrichtung (siehe Abschnitt E).
- Keine UI-Anzeige einzelner fehlgeschlagener Termine - nur der letzte Fehler insgesamt pro
  Organisation (identisch zum bestehenden Lese-Import).
- Keine Verschlüsselung des gespeicherten Service-Account-JSON über das bestehende Schutzniveau
  vergleichbarer Secrets hinaus (Abschnitt A).
