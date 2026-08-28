# Android Offline-Kalender (Offline-Modus, Pilot) — Design

## Ziel

Die native Android-App (Capacitor-Shell) zeigt aktuell bei fehlender Internetverbindung nur eine
leere, statische "Keine Verbindung"-Seite (`native-fallback/offline.html`), da jede Seite live vom
Next.js-Server gerendert wird — es gibt keinerlei lokalen Datenspeicher. Dieses Feature macht den
**Kalender** (als Pilot für ein späteres, umfassenderes Offline-Konzept) auch ohne Internetverbindung
lesbar: Gitter- und Listenansicht, Filter, zuletzt bekannter RSVP-Status — alles rein lesend, Stand
vom letzten Öffnen mit Internetverbindung.

Motivation: Mitglieder öffnen die App auch dort, wo kein Empfang ist (z. B. am Feuerwehrhaus im
Keller, bei einer Übung im Wald), und sollen trotzdem sehen können, was in den nächsten Tagen
ansteht bzw. kürzlich stattgefunden hat.

## Scope

**In Scope (dieser Pilot):**
- Kalender, rein lesend: Gitter- und Listenansicht, Layer-/Status-Filter, zuletzt bekannter
  RSVP-Status (als Badge, nicht interaktiv)
- Automatisches Zwischenspeichern im Hintergrund, ausgelöst durch normales Öffnen der Kalender-Seite
  online — kein manueller "Für offline speichern"-Knopf
- Zeitfenster des Caches: letzte 30 Tage + alle zukünftigen Termine (nicht unbegrenzt wie online)
- Native Android only (Capacitor-Shell)

**Explizit außerhalb dieses Pilot-Umfangs** (spätere, eigene Specs):
- Drohnen-Flugdaten offline (Piloten/Admins)
- Atemschutzstatus offline (Heimatfeuerwehr)
- Jegliche Offline-*Aktionen*: RSVP (Zusage/Absage), Termin anlegen/bearbeiten, .ics-Download —
  alles braucht den Server und bleibt online-only
- iOS / PWA ("Zum Home-Bildschirm") — nur die native Android-Capacitor-Shell

## Architektur-Überblick

Drei neue Bausteine, eingebettet in die bestehende Struktur:

1. **Ein neues, eigenständiges Vite-React-Bundle** (`native-offline/`), das die *bestehenden*
   Kalender-Anzeige-Komponenten aus `src/components/calendar/` direkt importiert und offline (ohne
   Next.js-Server, ohne Server Actions) rendert. Kein Komponenten-Duplikat.
2. **Ein Android-only Cache-Schreiber**, der beim normalen Online-Besuch der Kalender-Seite die
   bereits geladenen Daten (kein zusätzlicher Request) auf das gewählte Zeitfenster zuschneidet und
   lokal auf dem Gerät speichert (`@capacitor/filesystem`).
3. **Eine Änderung an `capacitor.config.ts`**, die bei fehlgeschlagenem Laden der Live-Seite
   (`server.errorPath`) auf das neue Offline-Bundle statt auf die bisherige leere `offline.html`
   verweist.

```
Online:  WebView --live--> app-17.bfkdo-stpoelten.at/kalender (unverändert)
                              |
                              +--> [Android-only Effect] events/layers Prop
                                     --> Zeitfenster-Filter (client-seitig)
                                     --> @capacitor/filesystem: offline-cache/kalender.json

Offline: WebView --Ladefehler--> capacitor.config.ts server.errorPath
                                     --> native-fallback/offline-app/index.html (neues Vite-Bundle)
                                     --> liest offline-cache/kalender.json
                                     --> rendert KalenderWithLayers(readOnly)
```

## Komponenten-Wiederverwendungsplan

Untersucht wurde jede Datei unter `src/components/calendar/`. Ergebnis:

| Komponente | Status | Änderung nötig |
|---|---|---|
| `CalendarView` (Gitter) | wiederverwenden | `useRouter` durch lokalen Klick-Callback ersetzen |
| `EventListView` (Liste) | wiederverwenden | `useRouter`/`next/link` ersetzen; RSVP-Inline-Buttons hinter neuem `readOnly`-Prop verbergen |
| `KalenderWithLayers` | wiederverwenden | neuer `readOnly?: boolean`-Prop (default `false`, Online-Verhalten unverändert) |
| `KalenderDesktopSidebar`, `KalenderFiltersContent`, `LayerLegend`, `RsvpBadge`, `VehicleBookingIcon` | 1:1 wiederverwenden | keine — bereits reine Props-Komponenten ohne Next.js-Abhängigkeit |
| `AddToCalendarLink` | offline ausblenden | verlinkt eine Server-Route (.ics), ergibt offline keinen Sinn |
| `EventRsvpButtons`, `SendEventPushButton` | offline **nicht** einbinden | rufen Server Actions direkt auf, funktionieren ohne Server nicht — werden durch das bereits vorhandene, rein lesbare `RsvpBadge` ersetzt |
| `EventForm` | offline nicht relevant | kein Termin-Anlegen/Bearbeiten offline |

Das neue `readOnly`-Prop ist rein additiv (Default `false`) — die Online-Ansicht ändert sich nicht.

**Datenformat:** `CalendarEventInput` (bereits heute der exportierte Typ aus `calendar-view.tsx`) ist
bereits eine flache, JSON-serialisierbare Struktur (Datumsangaben als ISO-Strings, keine
Prisma-Objekte/lazy relations) — exakt die Form, die sowohl die Live-Seite den Komponenten übergibt
als auch der Offline-Cache speichert. Keine Konvertierung nötig.

## Daten-Fluss: Cache schreiben

`src/app/(app)/kalender/page.tsx` lädt heute bereits **unbegrenzt alle sichtbaren Termine** und
übergibt sie (zusammen mit `layers`) als Props an `KalenderWithLayers`. Ein neuer Client-Component-
Wrapper (`src/components/calendar/offline-cache-sync.tsx`, gerendert innerhalb von
`KalenderWithLayers`) bekommt exakt dieselben `events`/`layers` als Props und tut in einem
`useEffect` Folgendes:

1. Prüft `Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'` — auf Web/iOS ein
   No-op.
2. Filtert `events` client-seitig auf das Zeitfenster: **`end >= heute - 30 Tage`** (Filterung nach
   Enddatum, nicht Startdatum — ein mehrtägiger Termin, der vor 40 Tagen begann und erst morgen
   endet, bleibt so korrekt im Cache; alle zukünftigen Termine sind durch dieselbe Bedingung
   automatisch mit abgedeckt, da ihr Ende immer in der Zukunft liegt). Die Online-Abfrage selbst
   bleibt unverändert (kein Einfluss auf Web/Desktop/PWA-Nutzer).
3. Schreibt `{ syncedAt: <ISO-Zeitstempel>, events: <gefilterte Liste>, layers }` als JSON via
   `@capacitor/filesystem` (`Filesystem.writeFile`, `directory: Directory.Data`,
   `path: 'offline-cache/kalender.json'`, `encoding: Encoding.UTF8`).
4. Best-effort: jeder Fehler (z. B. Speicherplatz, Dateisystem-Fehler) wird geloggt und **blockiert
   nie** die normale Seitenanzeige — derselbe Grundsatz wie beim FCM-Token-Cleanup beim Logout.

`@capacitor/filesystem` ist eine neue Abhängigkeit (`package.json`) — bisher nutzt das Projekt kein
Capacitor-Speicher-Plugin.

## Daten-Fluss: Offline anzeigen

Das neue Vite-Bundle (`native-offline/`, Build-Output landet direkt in
`native-fallback/offline-app/`) hat einen einzigen Einstiegspunkt (`main.tsx`), der:

1. Per `@capacitor/filesystem` `offline-cache/kalender.json` liest.
2. Drei Zustände unterscheidet:
   - **Kein Cache vorhanden** (Datei existiert nicht — z. B. Erstinstallation ohne je online gewesen
     zu sein): Meldung "Noch keine Daten zwischengespeichert — bitte einmal mit
     Internetverbindung öffnen."
   - **Cache vorhanden**: rendert `KalenderWithLayers` mit `readOnly={true}`, plus einen Kopfbereich
     "Offline-Ansicht — Stand: {syncedAt, formatiert}" und einen "Erneut verbinden"-Button
     (navigiert zurück zur Live-Origin, funktioniert automatisch sobald wieder Netz da ist).
   - **Fehler beim Lesen** (korrupte Datei o. ä.): dieselbe "kein Cache"-Meldung als Fallback.
3. Erhalten bleibt aus der bestehenden Interaktivität: Gitter-/Listenansicht umschalten,
   Layer-/Status-Filter — beides bereits client-seitiger State ohne Serverzugriff.

Das Bundle ist bewusst als **eigenständige "Offline-Hülle"** angelegt (eigener Kopfbereich, eigene
Meldung), nicht nur als nackte Kalender-Seite — das macht es erweiterbar, sobald Drohnen/Atemschutz
in späteren Specs dazukommen, ohne den Mechanismus (errorPath, Vite-Build, Filesystem-Cache) erneut
umbauen zu müssen. Für diesen Piloten enthält die Hülle nur den Kalender-Abschnitt.

## Build & Einbindung

- Neues npm-Skript `build:offline` (Vite-Build, `vite.config.ts` im Repo-Root mit eigenem `root`/
  `build.outDir: 'native-fallback/offline-app'`), nutzt dieselbe `tailwind.config.ts`/`globals.css`
  wie die Hauptapp (identisches Erscheinungsbild) — Vite unterstützt Tailwind v3 direkt.
- `npx cap sync android` kopiert `native-fallback/` (inkl. `offline-app/`) unverändert wie bisher in
  das Android-Projekt — kein zusätzlicher Kopierschritt nötig, `build:offline` muss nur vorher
  gelaufen sein. Neues kombiniertes Skript `cap:sync:android` (`npm run build:offline && npx cap
  sync android`) verhindert, dass dieser Schritt bei einem künftigen Release vergessen wird.
- **Schriftart-Vereinfachung**: die Offline-Ansicht nutzt eine System-Schriftart statt Barlow/IBM
  Plex Mono (Google Fonts sind offline nicht ladbar; lokal eingebettete Font-Dateien wären möglich,
  werden für diesen Piloten aber bewusst nicht umgesetzt — kleiner optischer Unterschied, kein
  funktionales Problem). FullCalendar selbst braucht keine externen Ressourcen (CSS ist im
  npm-Paket enthalten).
- `capacitor.config.ts`: `server.errorPath` von `'offline.html'` auf
  `'offline-app/index.html'` ändern. Die bisherige `offline.html` bleibt als Asset erhalten (falls
  das neue Bundle selbst nicht ladbar wäre, z. B. bei einem Build-Fehler) oder wird entfernt — wird
  beim Implementieren anhand von Capacitors tatsächlichem `errorPath`-Verhalten entschieden.

## Fehlerbehandlung & Edge Cases

- Schreiben des Caches schlägt fehl (Speicherplatz, Dateisystem) → best-effort, geloggt, blockiert
  nie die normale Online-Anzeige.
- Lesen des Caches schlägt fehl/Datei fehlt → "kein Cache"-Meldung statt Absturz.
- Cache ist veraltet (z. B. Nutzer war wochenlang offline) → wird nicht aktiv erkannt/gewarnt über
  den reinen Zeitstempel "Stand: ..." hinaus — das reicht für diesen Piloten aus.
- Nutzer landet offline auf einer *anderen* Seite als Kalender (z. B. Drohnen) → sieht dieselbe
  Offline-Hülle mit dem Kalender-Inhalt (da `errorPath` global für jede fehlgeschlagene
  WebView-Navigation gilt) — kein individuelles Routing zur ursprünglich versuchten Seite in diesem
  Piloten.

## Testing / Verifikation

Kein automatisierter Test-Suite im Projekt (projektweite Konvention). Verifikation manuell:
1. Kalender-Seite online öffnen, prüfen, dass `offline-cache/kalender.json` auf dem Gerät entsteht
   (z. B. via `adb shell run-as at.bfkdostpoelten.app cat files/offline-cache/kalender.json` oder
   Logcat-Ausgabe eines Debug-Logs beim Schreiben).
2. Gerät in Flugmodus versetzen, App neu starten/zu einer beliebigen Seite navigieren → Offline-
   Kalender-Ansicht muss erscheinen, mit den zuvor gecachten Terminen, korrektem Zeitstempel.
3. Gitter-/Listenansicht umschalten, Layer-Filter umschalten → muss offline funktionieren.
4. Ein bereits zugesagter Termin muss offline seinen RSVP-Status als `RsvpBadge` zeigen, ohne
   interaktive Buttons.
5. Frische Installation ohne je online gewesen zu sein, dann Flugmodus → "kein Cache"-Meldung statt
   leerer/kaputter Seite.
6. Zurück online gehen, "Erneut verbinden" antippen → Live-App lädt wie gewohnt.
