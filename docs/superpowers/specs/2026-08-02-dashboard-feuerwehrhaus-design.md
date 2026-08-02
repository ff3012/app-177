# Dashboard Feuerwehrhaus (GitHub Issue #8)

## Context

Ein öffentlich (aber token-geschützter) erreichbarer Kiosk-Screen für einen Windows-PC/Chrome-Vollbild
im Feuerwehrhaus, der ohne Interaktion die wichtigsten Infos der eigenen Heimatfeuerwehr zeigt: kommende
Termine, ausgeborgte Fahrzeuge (30 Tage), die WASTL-Einsatzlagekarte Niederösterreich, den Facebook-Feed
der Feuerwehr, und einen QR-Code zum App-Download. Quelle: [GitHub Issue #8](https://github.com/ff3012/app-177/issues/8)
plus ein vollständig ausgearbeiteter Design-Brief (`Dashboard-Brief.md`) und ein `.dc.html`-Mockup
(„Dashboard Feuerwehrhaus.dc.html"), beide aus einem Claude-Design-Projekt importiert. Der Brief ist
bereits ein technisches Lastenheft (exakte `clamp()`-Werte, Breakpoints, Datenregeln, Abnahmekriterien) —
dieses Spec-Dokument übernimmt seinen Inhalt vollständig und ergänzt die codebase-spezifische technische
Zuordnung (Schema, Dateipfade, Wiederverwendung bestehender Muster) sowie drei mit dem App-Owner
abgestimmte offene Entscheidungen.

## 1. Route und Authentifizierung

Neue **öffentliche** Route außerhalb der `(app)`-Gruppe:

```
src/app/dashboard/[token]/page.tsx
```

- `export const dynamic = 'force-dynamic'` und `export const revalidate = 0` — nichts wird gecacht.
- Token-Prüfung serverseitig in der Page gegen die neue `DashboardToken`-Tabelle (siehe §2). Ungültig,
  abgelaufen (`expiresAt` in der Vergangenheit) oder widerrufen (`revokedAt` gesetzt) → `notFound()` —
  anders als beim Drohnen-Schnelllink (der nie 404 wirft), hier explizit gewünscht: „kein Hinweis auf die
  Existenz der Seite" (Abnahmekriterium).
- Bei gültigem Token: `lastUsedAt` auf `now()` aktualisieren (einzige Schreiboperation dieser Route — kein
  Verstoß gegen „read-only", da keine Nutzereingabe verarbeitet wird, nur ein Zeitstempel).
- Kein Personenbezug über das Nötige hinaus: Termine und Buchungen der Heimatfeuerwehr, Name des
  Ausborgenden. **Keine** Zu-/Absagen, keine Telefonnummern, keine Atemschutzdaten.
- `src/middleware.ts`'s `PUBLIC_PATH_PREFIXES` bekommt `'/dashboard'` als neuen Eintrag (deckt
  `/dashboard/[token]` automatisch ab, da `startsWith` verwendet wird).

### Verwaltung

Vierte Sektion auf `src/app/(app)/admin/heimatfeuerwehr/page.tsx` („**Dashboard Feuerwehrhaus**"), als
weiterer `<div className="rounded-lg bg-surface p-4 shadow-card">`-Block direkt nach der bestehenden
„Fahrzeug-Buchungen"-Sektion, gleiches `canManageHeimatfeuerwehrFor`-Gate wie die anderen Aktionen dieser
Seite:

- Link erzeugen (neuer Token), Link kopieren (`CopyLinkButton`, bestehende Komponente), QR-Code anzeigen
  (Client-seitig als `<img src="data:image/svg+xml;...">`, aus derselben `qrcode`-Bibliothek wie die
  öffentliche Seite selbst generiert, nur zur Anzeige in der Verwaltung — kein zusätzliches Route-Handler
  nötig, da hier kein „read-only von außen" gilt), Ablaufdatum setzen, widerrufen.
- Tabelle bestehender Tokens für die ausgewählte Org: erstellt am, Ablaufdatum, zuletzt verwendet,
  widerrufen-Aktion — 1:1 das `Table`/`Badge`-Muster der übrigen Sektionen dieser Seite.
- Neues kleines Formular für die zwei Facebook-Felder (Page-ID, Access-Token) direkt in derselben Sektion
  oder einer eigenen fünften — analog zu `AtemschutzSachbearbeiterForm`.

## 2. Datenmodell

### `DashboardToken` (neu)

```prisma
model DashboardToken {
  id             String    @id @default(cuid())
  token          String    @unique
  organizationId String
  createdById    String
  createdAt      DateTime  @default(now())
  expiresAt      DateTime?
  lastUsedAt     DateTime?
  revokedAt      DateTime?

  organization Organization @relation(fields: [organizationId], references: [id])
  createdBy    User         @relation(fields: [createdById], references: [id])

  @@index([organizationId])
}
```

Folgt exakt dem bestehenden `Vehicle`/`Event`-Muster für Org-Referenzen (`organizationId String` +
benannte Relation + Index). Der Token selbst: `randomBytes(24).toString('hex')`, exakt wie
`generateDroneQuickRegisterToken()` in `src/lib/settings.ts` — nur hier als eigene Zeile statt eines
Singleton-Felds, da mehrere Tokens pro Org (mit individuellem Ablauf/Widerruf) möglich sein müssen, was
`AppSettings`' Singleton-Muster nicht abbildet.

### `Organization` — zwei neue optionale Felder

```prisma
facebookPageId          String?
facebookPageAccessToken String?
```

**Entscheidung (bestätigt):** pro Feuerwehr, nicht global — analog zu `atemschutzSachbearbeiterEmail`,
da jede Heimatfeuerwehr potenziell ihre eigene Facebook-Seite hinterlegen können soll, nicht nur
Wolfsgraben.

### `FacebookPostCache` (neu, ein Eintrag pro Org)

```prisma
model FacebookPostCache {
  id             String   @id @default(cuid())
  organizationId String   @unique
  posts          Json
  fetchedAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])
}
```

`posts` ist ein JSON-Array (`{ id, message, createdTime, permalinkUrl, hasImage }[]`) der Graph-API-Antwort,
gefiltert auf ≤ 90 Tage alt. Bilder liegen **separat** in:

```prisma
model FacebookPostImage {
  id        String   @id @default(cuid())
  postId    String   @unique
  data      Bytes
  mimeType  String
  createdAt DateTime @default(now())
}
```

**Entscheidung (bestätigt):** Bytes in Postgres, analog zu `DroneDocument` (PDF-Bytes) — kein
zusätzliches Docker-Volume, läuft automatisch im bestehenden `pg_dump`-Backup mit. Eigene Tabelle statt
eines Felds auf `FacebookPostCache` selbst, damit beim stündlichen Refresh nur tatsächlich neue Bilder
geschrieben werden (Abgleich über `postId`), nicht das gesamte Cache-JSON samt alter Bilder neu.

### `WastlImageCache` (neu, Singleton-artig — kein Org-Bezug, da die Karte ganz NÖ zeigt)

```prisma
model WastlImageCache {
  id        String   @id @default("singleton")
  data      Bytes
  mimeType  String
  fetchedAt DateTime @default(now())
}
```

Gleiches Bytes-in-Postgres-Muster; ein einzelner Datensatz reicht, da die WASTL-Karte nicht org-spezifisch
ist (ganz Niederösterreich).

## 3. Server-Fetches je Block (parallel in der Page)

| Block | Quelle | Regel |
|---|---|---|
| Termine | `Event`-Tabelle | `organizationId = X OR isSectionWide = true`, `startsAt >= now`, aufsteigend, Limit 7. Ohne RSVP-Felder. **Drohnengruppe-Kategorie wird nicht gefiltert** — anders als die normale Kalenderansicht (die `canViewDroneModule` prüft), gibt es hier keinen Viewer mit eigenen Rechten; der Screen zeigt alle Kategorien der eigenen Org/des Abschnitts. |
| Fahrzeugbuchungen | `VehicleBooking` (über `vehicle.organizationId`) | `startsAt` zwischen heute und +30 Tage, aufsteigend, **Limit 4** für die Tabelle; Gesamtzahl separat zählen (`prisma.vehicleBooking.count(...)`) und in der Fußzeile ausgeben. |
| WASTL | `src/app/api/wastl/overview/route.ts`, `unstable_cache`-gewrappt | Fallback auf `WastlImageCache` bei Fehlschlag. |
| Facebook | `FacebookPostCache` + `FacebookPostImage` (stündlich vom Cron befüllt, nicht live) | Fallback: Karte mit „Facebook nicht verbunden", falls `facebookPageId`/`facebookPageAccessToken` leer. |

Farbstreifen links am Termin folgt der Kategorie: Allgemein `#e4322b`, Drohnengruppe `#22a06b`,
Abschnitt `#f0a92c` (Abschnitt = `isSectionWide: true` und `category: ALLGEMEIN`).

## 4. Layout — fluid, nicht fix

Exakt wie im Brief spezifiziert (aus `Dashboard-Brief.md` §3, hier vollständig übernommen, da bindend für
die Implementierung):

- `height:100dvh; overflow:hidden` — kein Scrollen auf keiner Auflösung. Kein `transform: scale()` auf den
  Wurzelcontainer.
- Gerüst: Kopf `flex:0 0 auto`, Höhe `clamp(84px, 9vh, 132px)`, weiß, unten 4px `#e4322b`; Inhalt
  `flex:1 min-height:0`, Grid `gap:clamp(16px,1.5vw,32px)`; Fuß `flex:0 0 auto`, Höhe
  `clamp(40px, 5vh, 62px)`, Hairline oben. Seitenrand durchgehend `clamp(20px, 2.1vw, 44px)`.
- Spalten: `grid-template-columns: minmax(0,1fr) minmax(0,1fr) clamp(380px, 27vw, 560px)`.
  - Spalte 1: Kommende Termine.
  - Spalte 2: Fahrzeugtabelle (`flex:0 0 auto`) + WASTL-Karte (`flex:1; min-height:0`,
    `object-fit:contain`).
  - Spalte 3: Facebook (`flex:1; min-height:0`) + QR-Karte (`flex:0 0 auto`).
  - Jede Spalte `display:flex; flex-direction:column; min-height:0`.
- **Menge anpassen, nicht Größe**: Listen mit `overflow:hidden`, Anzahl an gemessener Höhe ausgerichtet
  (`ResizeObserver` auf dem Listencontainer). Grenzen: Termine 4–10, Fahrzeugbuchungen 3–8, Facebook 2–6.
  Server liefert das Maximum, Client blendet den Überhang aus — neue wiederverwendbare Client-Komponente
  `<HeightFittedList>` (eine Instanz pro Block).
- Typografie als `clamp()` gegen `vw` (1920px-Mittelwert): Uhr `clamp(38px, 2.9vw, 76px)`, Wochentag
  `clamp(20px, 1.4vw, 34px)`, Termintitel `clamp(20px, 1.35vw, 34px)`, Tabellenzelle
  `clamp(16px, 1.05vw, 26px)`, Sekundärtext `clamp(14px, .95vw, 23px)`, Abschnittslabel
  `clamp(12px, .8vw, 19px)`. **Untergrenzen sind bindend** — kein Fließtext unter 14px.
- Tabellenraster: `grid-template-columns: clamp(70px,4.5vw,110px) minmax(160px,1.6fr) clamp(104px,6.5vw,150px) minmax(120px,1.4fr)`.
  Fahrzeug-/Namensspalte `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`.
- Breakpoints: ≥2400px obere clamp-Grenzen; 1600–2400px Referenzfall; 1200–1600px Spalte 3 auf
  `minmax(340px,26vw)`, Facebook 2 Beiträge; <1200px zweispaltig (Termine \| Fahrzeuge+Karte; Facebook+QR
  unter Termine); Hochformat (`aspect-ratio < 1`) einspaltig.
- **Nichtverhandelbar:** keine Hover-/Fokus-/Klickzustände. Grautöne nicht heller als `#6c6c70` auf Weiß.
- Kopf rechts: Wochentag fett, Datum darunter, 1px-Linie, Uhrzeit in Barlow Condensed — client-seitige
  Insel-Komponente (`'use client'`), alle 15s aktualisiert, NICHT die ganze Seite neu rendernd.

Visuelle Referenz (Farben, exakte Kartenmaße, Schriftschnitte) ist das `.dc.html`-Mockup — bereits 1:1
mit den obigen `clamp()`-Werten konsistent, dort nur bei der 1920×1080-Referenzgröße gezeichnet.

## 5. WASTL-Lagekarte

- Serverseitiger Proxy: `src/app/api/wastl/overview/route.ts`, `Cache-Control: s-maxage=120`, Timeout.
  Quelle: `https://www.feuerwehr-krems.at/CodePages/Wastl/wastlmain/ShowOverview.asp`.
- Bei Fehlschlag: letztes erfolgreiches Bild aus `WastlImageCache` weiterverwenden, „Stand HH:MM"
  darunter ausweisen. Niemals leeres graues Feld.
- Legende (Normal/Erhöht/Stark) + Status des eigenen Bezirks als eigene Zeile unter dem Bild (Farben im
  PNG allein sind ohne Legende nicht eindeutig) — statisch codiert (keine Bezirks-Erkennung aus dem Bild
  selbst, das wäre Bildanalyse und außerhalb des Scopes).
- Copyright NÖGIS beachten — Kommentar im Code, Nutzung vor Produktivgang mit der Quelle klären
  (Hinweis, keine Code-Aufgabe).

## 6. Facebook-Feed

- **Kein Meta-iframe/Page-Plugin.** Graph API `/{page-id}/posts?fields=message,created_time,permalink_url,full_picture,attachments{media,type}`
  mit Long-Lived Page Access Token, serverseitig.
- **Abruf 1× pro Stunde** über `src/app/api/cron/facebook-fetch/route.ts` (GET, `CRON_SECRET`-gated wie
  die bestehenden Cron-Routen, `/api/cron` bereits öffentlicher Präfix), nicht bei jedem Seitenaufruf.
  Host-Wrapper `docker/facebook-fetch.sh` (stündlich), dokumentiert in `docker/README.md` — 1:1 das
  Muster von `docker/system-check-email.sh`.
- Persistenter Cache in `FacebookPostCache`/`FacebookPostImage` (siehe §2) — überlebt Neustart/API-Ausfall.
- Darstellung: neuester Beitrag **mit Bild** groß (`aspect-ratio:16/9`, `object-fit:cover`,
  `border-radius:8px`, Datum/Schlagzeile/2-Zeilen-Auszug darunter); ältere Beiträge kompakt
  (Datum+Schlagzeile, einzeilig, Anzahl höhenabhängig). Hat der neueste Beitrag kein Bild: jüngsten
  Beitrag **mit** Bild nehmen, sofern ≤30 Tage alt — sonst alle kompakt.
- Bilder werden aus `FacebookPostImage` über eine eigene Route ausgeliefert (`/api/facebook/image/[postId]`),
  nicht über `next/image` mit einem Facebook-CDN-`remotePattern` — robuster für Dauerbetrieb, da
  signierte CDN-URLs ablaufen; das Bild wird beim stündlichen Fetch einmal heruntergeladen und lokal
  (in Postgres) vorgehalten.
- Beiträge älter als 90 Tage nicht anzeigen. Ohne konfiguriertes Token: „Facebook nicht verbunden".

## 7. QR-Code

- `qrcode`-Paket (neu, `npm install qrcode`), serverseitig als SVG-Data-URI im Server Component erzeugt.
- Inhalt: `https://app-177.ff-wolfsgraben.at/`. Fehlerkorrektur M, Ruhezone 4 Module, Kantenlänge
  `clamp(96px, 7vw, 180px)`.
- URL zusätzlich als lesbarer Text daneben (Fallback für alle, die nicht scannen können).

## 8. Betrieb als Kiosk

- Vollständiger Seiten-Reload alle 5 Minuten: `<meta http-equiv="refresh" content="300">` — bewusst ein
  harter Reload statt Polling.
- Uhr aktualisiert dazwischen client-seitig alle 15s (siehe §4).
- Kein Zoom-Workaround — das fluide Layout passt sich selbst an.
- Chrome-Start-Empfehlung `--kiosk --noerrdialogs --disable-session-crashed-bubble`, dokumentiert in
  `docker/README.md` (bzw. einer neuen kurzen README-Sektion, da dies kein Docker-Thema ist, sondern den
  Windows-PC im Feuerwehrhaus betrifft — trotzdem am selben zentralen Ort dokumentiert).

## Kritische Dateien

**Neu:** Migration für `DashboardToken`/`FacebookPostCache`/`FacebookPostImage`/`WastlImageCache` +
`Organization.facebookPageId`/`facebookPageAccessToken`, `src/app/dashboard/[token]/page.tsx` +
`clock-display.tsx` (Client-Insel) + `height-fitted-list.tsx` (Client-Komponente), `src/lib/dashboard/token.ts`
(get/generate/revoke, analog `settings.ts`), `src/lib/dashboard/data.ts` (die drei Server-Fetches),
`src/app/api/wastl/overview/route.ts`, `src/app/api/cron/facebook-fetch/route.ts`,
`src/app/api/facebook/image/[postId]/route.ts`, `src/lib/facebook/fetch-posts.ts`,
`docker/facebook-fetch.sh`, neue Sektion(en) + `dashboard-token-actions.ts` in
`src/app/(app)/admin/heimatfeuerwehr/`.

**Geändert:** `prisma/schema.prisma`, `src/middleware.ts` (`/dashboard`-Präfix), `package.json`
(`qrcode`-Dependency), `src/app/(app)/admin/heimatfeuerwehr/page.tsx` (neue Sektion(en)),
`docker/README.md` (Cron-Eintrag + Kiosk-Chrome-Hinweis).

## Verifikation

1. `npx tsc --noEmit` + `npm run build` nach jedem Abschnitt.
2. Browser: `/dashboard/[token]` bei 1366×768, 1920×1080, 2560×1440, 3840×2160 (inkl. Hochformat) prüfen
   — kein Scrollbalken, kein abgeschnittener Inhalt, mehr Listeneinträge bei größerer Auflösung.
3. Ungültiger/abgelaufener/widerrufener Token → 404, kein Hinweis auf Existenz.
4. WASTL- und Facebook-Ausfall simulieren (z. B. Netzwerk kappen) — Seite bleibt vollständig lesbar
   (Fallback-Bild bzw. „nicht verbunden").
5. Admin-Sektion: Token erzeugen/kopieren/QR anzeigen/Ablaufdatum setzen/widerrufen, alles gegen echte
   Testdaten.
6. Testdaten danach aufräumen, `AskUserQuestion` vor Commit/Push.
