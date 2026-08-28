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

> **Revision (2026-08-28, nach finalem Whole-Branch-Review):** Der ursprünglich hier beschriebene
> Ansatz — ein separates Vite-Bundle, ausgeliefert über Capacitors `server.errorPath` — wurde
> **verworfen**, bevor er gemerged wurde. Der finale Review (Lesen von Capacitors eigenem
> Android-Java-Quellcode, nicht Vermutung) fand zwei Blocker: (1) `errorPath` lädt zwar die
> Fehlerseite selbst lokal, aber jede weitere Ressource dieser Seite (JS/CSS) fällt auf einen
> echten Netzwerk-Request zurück, der offline fehlschlägt — nur bei der alten, reinen
> HTML/CSS-ohne-JS-`offline.html` war das nie ein Problem. (2) Die `errorPath`-Seite läuft auf einer
> **anderen Origin** (`localhost` statt der echten App-Origin) — Capacitors natives Bridge-Skript
> wird aber nur für die echte App-Origin injiziert, weshalb `@capacitor/filesystem` dort in seine
> Web-Fallback-Implementierung fällt und den nativ geschriebenen Cache nie lesen könnte. Ergebnis
> wäre eine Offline-Ansicht gewesen, die dauerhaft "kein Cache" gezeigt hätte, selbst direkt nach
> einer erfolgreichen Online-Synchronisierung. Der Abschnitt unten beschreibt den **korrigierten**
> Ansatz; die ursprüngliche Architektur ist nur noch als Warnung interessant, falls sie je wieder
> in Erwägung gezogen wird.

Vier Bausteine, eingebettet in die bestehende Struktur:

1. **Eine neue, statische Next.js-Seite** (reine Client Component, keine Server-Datenabfrage) unter
   `src/app/offline-kalender/`, die die *bestehenden* Kalender-Anzeige-Komponenten aus
   `src/components/calendar/` direkt importiert und rein clientseitig rendert. Kein separates
   Build-Tool, kein Komponenten-Duplikat — Teil des normalen `npm run build`, läuft also durch
   Next.js' eigenen Bundler, der `'use server'`-Dateien bereits korrekt behandelt (anders als der
   verworfene Vite-Ansatz, der dafür einen Alias-Stub brauchte).
2. **Derselbe Android-only Cache-Schreiber wie zuvor** (unverändert, siehe "Daten-Fluss: Cache
   schreiben" unten) — läuft weiterhin auf der Live-Seite, schreibt weiterhin über
   `@capacitor/filesystem`.
3. **Eine Erweiterung von `public/sw.js`**: cached beim Precache-Schritt zusätzlich die Assets
   dieser neuen Offline-Seite und liefert sie bei einem fehlgeschlagenen Navigations-Fetch aus,
   statt wie bisher nur die bare `offline.html`. Entscheidend: der Service Worker läuft auf
   **derselben Origin** wie die Live-App — Capacitors Bridge-Injection ist origin-basiert (nicht
   inhaltsbasiert), eine über den Service-Worker-Cache ausgelieferte Seite bekommt sie also
   trotzdem, im Gegensatz zur alten `errorPath`-Seite auf `localhost`.
4. **Eine Änderung an `components/pwa-register.tsx`**: die bisherige
   `if (Capacitor.isNativePlatform()) return;`-Sperre vor der Service-Worker-Registrierung entfällt
   für diesen einen, eng gefassten Zweck (siehe "Service-Worker-Registrierung auf Android" unten).
   `capacitor.config.ts`s `server.errorPath` bleibt bei der ursprünglichen `offline.html` — sie ist
   weiterhin der allerletzte Rückfallpunkt für den Fall, dass der Service Worker selbst noch nie
   erfolgreich installiert werden konnte (z. B. allererster App-Start ganz ohne Verbindung).

```
Online:  WebView --live--> app-17.bfkdo-stpoelten.at/kalender (unverändert)
                              |
                              +--> [Android-only Effect] events/layers Prop
                              |      --> Zeitfenster-Filter (client-seitig)
                              |      --> @capacitor/filesystem: offline-cache/kalender.json
                              |
                              +--> Service Worker (public/sw.js) precacht bei install/activate
                                     die Assets von /offline-kalender

Offline: WebView --Navigation--> fetch schlägt fehl (network error)
                                     --> Service Worker liefert gecachte /offline-kalender-Seite
                                         aus (SELBE Origin wie die Live-App)
                                     --> Next.js-Client-Component liest offline-cache/kalender.json
                                         über @capacitor/filesystem (Bridge vorhanden, da
                                         gleiche Origin)
                                     --> rendert KalenderWithLayers(readOnly)

Letzter Rückfallpunkt (Service Worker selbst nie installiert):
         WebView --Ladefehler--> capacitor.config.ts server.errorPath --> offline.html (unverändert)
```

### Service-Worker-Registrierung auf Android

Die bisherige Sperre (`pwa-register.tsx`) war eine bewusste Vereinfachung — die Begründung
("zwei konkurrierende Installationsmechanismen ohne klare Update-Präzedenz") bezog sich auf
allgemeine PWA-Install-Prompts/Update-Flows, **nicht** auf einen rein passiven
Offline-Fallback-Cache. Es gibt keinen dokumentierten Fund, dass Service Worker in einer
Capacitor-Android-WebView grundsätzlich nicht funktionieren — im Gegenteil, Capacitors eigener
Java-Quellcode (`Bridge.java`, `WebViewLocalServer.java`) zeigt, dass die App-eigene
Request-Interception für die entfernte `server.url`-Origin ohnehin `null` zurückgibt (nichts tut)
und damit einem Service Worker auf dieser Origin nicht im Weg steht. Die einzige verbleibende,
nur auf einem echten Gerät zu klärende Unsicherheit ist eine reine WebView-Plattformfrage (nicht
Capacitor-spezifisch): funktioniert Registrierung/Persistenz/Fetch-Interception zuverlässig unter
Android WebView (API 24, was `minSdkVersion` bereits erfüllt, Capacitor selbst verlangt WebView
≥55 und lädt sonst ohnehin `errorPath`).

Um die ursprüngliche Sorge (konkurrierende Mechanismen) nicht wieder einzuführen, bleibt die Rolle
des Service Workers bewusst eng: weiterhin nur GET-Navigationsanfragen abgefangen (unverändert aus
`sw.js`), keine Änderung an Push/Notification-Handling (ohnehin schon durch die native FCM-Lösung
ersetzt, Web-Push-APIs funktionieren in einer Android-WebView laut Recherche ohnehin nicht).

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

`src/app/offline-kalender/page.tsx` (neu, `'use client'`, keine Server-Komponente, keine
`async`-Datenabfrage — das macht Next.js sie als statische Route vorrenderbar, sodass der Service
Worker eine feste, gecachte HTML/JS/CSS-Antwort für diese URL ausliefern kann) rendert einen
einzigen Einstiegspunkt, der:

**Wichtig: eine dritte, öffentliche Top-Level-Route, nicht unter `(app)/`.** Wie
`drohnen-schnell/[token]` (siehe root CLAUDE.md) liegt diese Seite außerhalb der `(app)`-Gruppe und
wird zu `middleware.ts`s `PUBLIC_PATH_PREFIXES` hinzugefügt. Grund: der Service Worker cached diese
Seite beim `install`-Schritt per eigenem `fetch()`-Aufruf — läge die Seite unter `(app)/` (mit
`requireUser()`-Gate), würde ein Precache-Versuch ohne (oder mit gerade abgelaufener) Session
stattdessen die Login-Seite cachen. Da die Seite ohnehin ausschließlich lokal zwischengespeicherte
Gerätedaten anzeigt (nichts vom Server abruft), hat "öffentlich erreichbar" keine
Sicherheitsauswirkung — die tatsächlichen Kalenderdaten kommen nie über das Netz für diese URL.

1. Per `@capacitor/filesystem` `offline-cache/kalender.json` liest — funktioniert hier, weil diese
   Seite (anders als der verworfene `errorPath`-Ansatz) auf derselben Origin wie die Live-App läuft
   und damit die native Bridge injiziert bekommt.
2. Drei Zustände unterscheidet:
   - **Kein Cache vorhanden** (Datei existiert nicht — z. B. Erstinstallation ohne je online gewesen
     zu sein): Meldung "Noch keine Daten zwischengespeichert — bitte einmal mit
     Internetverbindung öffnen."
   - **Cache vorhanden**: rendert `KalenderWithLayers` mit `readOnly={true}`, plus einen Kopfbereich
     "Offline-Ansicht — Stand: {syncedAt, formatiert}" und einen "Erneut verbinden"-Button
     (lädt dieselbe URL neu, funktioniert automatisch sobald wieder Netz da ist — der Service
     Worker liefert dann wieder die echte Live-Seite statt der gecachten Fallback-Antwort).
   - **Fehler beim Lesen** (korrupte Datei o. ä.): dieselbe "kein Cache"-Meldung als Fallback.
3. Erhalten bleibt aus der bestehenden Interaktivität: Gitter-/Listenansicht umschalten,
   Layer-/Status-Filter — beides bereits client-seitiger State ohne Serverzugriff.

Die Seite ist bewusst als **eigenständige "Offline-Hülle"** angelegt (eigener Kopfbereich, eigene
Meldung), nicht nur als nackte Kalender-Seite — das macht sie erweiterbar, sobald Drohnen/Atemschutz
in späteren Specs dazukommen, ohne den Mechanismus (Service-Worker-Precache, Filesystem-Cache)
erneut umbauen zu müssen. Für diesen Piloten enthält die Hülle nur den Kalender-Abschnitt.

## Build & Einbindung

- **Kein separates Build-Tool.** `src/app/offline-kalender/page.tsx` wird Teil des ganz normalen
  `npm run build` (Next.js) — dieselbe `tailwind.config.ts`/`globals.css`, dieselben Fonts
  (`next/font`, Barlow/IBM Plex Mono laden hier wie überall sonst in der App, kein
  Font-Fallback-Sonderfall wie beim verworfenen Vite-Ansatz).
- **`public/sw.js` Erweiterung**: die bestehende `STATIC_ASSETS`-Precache-Liste bekommt die
  gebauten Assets von `/offline-kalender` dazu (Next.js' Build-Manifest liefert die exakten,
  gehashten Pfade); der bestehende `fetch`-Handler (weiterhin nur GET-Navigationsanfragen, siehe
  "Service-Worker-Registrierung auf Android" oben) liefert bei einem fehlgeschlagenen Fetch diese
  gecachte Antwort statt wie bisher nur `offline.html`.
- **`components/pwa-register.tsx`**: die `if (Capacitor.isNativePlatform()) return;`-Sperre entfällt
  — Registrierung läuft jetzt auch nativ, mit der oben beschriebenen eng gefassten Rolle.
- `capacitor.config.ts`s `server.errorPath` bleibt unverändert bei `'offline.html'` — sie deckt nur
  noch den seltenen Fall ab, dass der Service Worker selbst nie erfolgreich installiert wurde.

## Fehlerbehandlung & Edge Cases

- Schreiben des Caches schlägt fehl (Speicherplatz, Dateisystem) → best-effort, geloggt, blockiert
  nie die normale Online-Anzeige.
- Lesen des Caches schlägt fehl/Datei fehlt → "kein Cache"-Meldung statt Absturz.
- Cache ist veraltet (z. B. Nutzer war wochenlang offline) → wird nicht aktiv erkannt/gewarnt über
  den reinen Zeitstempel "Stand: ..." hinaus — das reicht für diesen Piloten aus.
- Nutzer landet offline auf einer *anderen* Seite als Kalender (z. B. Drohnen) → der Service Worker
  liefert für jede fehlgeschlagene Navigation dieselbe gecachte Offline-Hülle mit dem
  Kalender-Inhalt aus — kein individuelles Routing zur ursprünglich versuchten Seite in diesem
  Piloten.
- Service Worker selbst wurde nie erfolgreich installiert (z. B. allererster App-Start ganz ohne
  Verbindung, bevor je ein Online-Besuch die Registrierung/den Precache abschließen konnte) → fällt
  auf Capacitors `errorPath` (`offline.html`, unverändert) zurück, keine Kalenderdaten, aber auch
  kein Absturz.

## Testing / Verifikation

Kein automatisierter Test-Suite im Projekt (projektweite Konvention). Verifikation manuell:
1. Kalender-Seite online öffnen, prüfen, dass `offline-cache/kalender.json` auf dem Gerät entsteht
   (z. B. via `adb shell run-as at.bfkdostpoelten.app cat files/offline-cache/kalender.json` oder
   Logcat-Ausgabe eines Debug-Logs beim Schreiben). Über `chrome://inspect` (siehe diese Session
   bereits etabliertes Debug-Vorgehen für native Push) zusätzlich im Application-Tab prüfen, dass
   der Service Worker registriert ist und `/offline-kalender` im Cache Storage liegt.
2. Gerät in Flugmodus versetzen, App neu starten/zu einer beliebigen Seite navigieren → Offline-
   Kalender-Ansicht muss erscheinen, mit den zuvor gecachten Terminen, korrektem Zeitstempel.
3. Gitter-/Listenansicht umschalten, Layer-Filter umschalten → muss offline funktionieren.
4. Ein bereits zugesagter Termin muss offline seinen RSVP-Status als `RsvpBadge` zeigen, ohne
   interaktive Buttons.
5. Frische Installation ohne je online gewesen zu sein, dann Flugmodus → "kein Cache"-Meldung statt
   leerer/kaputter Seite.
6. Zurück online gehen, "Erneut verbinden" antippen → Live-App lädt wie gewohnt.
