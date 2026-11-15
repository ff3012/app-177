# Berichte-Schnellerfassung am iPad (Querformat) — Design

Stand: 2026-11-14. Status: vom App-Betreiber im Brainstorming freigegeben, Spec zur Durchsicht.

## Ziel

Im Feuerwehrhaus steht ein iPad (Querformat) als gemeinsames Gerät. Mitglieder erfassen darauf Tätigkeits-, Übungs- und
Einsatzberichte, ohne sich anzumelden: Link der Feuerwehr öffnen, eigenen Namen antippen, Bericht ausfüllen, abgeben.
Der Funktionsumfang entspricht dem bestehenden Berichts-Assistenten der App; neu sind der Zugang über einen geheimen
Link und ein breites Layout für Tablets im Querformat (Layout "A": feste Schrittleiste links, Inhalt in zwei Spalten).

## Entscheidungen (alle vom App-Betreiber)

| Frage | Entscheidung |
|---|---|
| Zugang des iPads | Gemeinsames Gerät mit geheimem Link je Feuerwehr, keine Anmeldung |
| Ausweis der schreibenden Person | Nur den eigenen Namen in der Mitgliederliste antippen (keine Stb-Nr., kein PIN) |
| Umfang | Alles wie in der App: Tätigkeits-, Übungs- und Einsatzbericht mit allen Feldern |
| Layout | Variante A: Schrittleiste links, Inhalt in zwei Spalten, feste untere Leiste Zurück/Weiter |
| Umsetzung | Bestehenden Assistenten teilen (zweites Layout) und auf einer neuen öffentlichen Seite einbinden |

Bewusst akzeptiertes Restrisiko: Wer den Link kennt, kann Berichte unter dem Namen eines beliebigen aktiven Mitglieds
dieser Feuerwehr anlegen. Der Link ist ein geheimer, nicht erratbarer Wert (wie `Organization.icsToken` und
`DroneGroup.qrToken`) und lässt sich jederzeit neu erzeugen oder abschalten.

## Nicht-Ziele

- Keine Anmeldung, kein PIN, keine Prüfung der Identität der schreibenden Person.
- Keine Änderung am Handy-Layout und am bestehenden Ablauf in `/meine-feuerwehr/berichte/neu`.
- Kein PDF-Download und keine Berichtsliste am iPad (nach der Abgabe geht es zurück zur Namenswahl; PDF und E-Mail
  entstehen wie bisher serverseitig).
- Keine Änderung der Aufbewahrung (Berichte werden weiter nach 14 Tagen vom Cron `report-retention` gelöscht).
- Keine eigene PWA/Manifest-Variante für das iPad (siehe offene Punkte).

## 1. Zugang und Link

**Datenmodell.** Neue Spalte `Organization.reportKioskToken String? @unique`, nullable und ohne Default: `null` bedeutet
"Schnellerfassung aus". Additive Migration (neue nullable Spalte, kein Backfill), alle Feuerwehren starten ausgeschaltet.
Der Wert wird im Klartext gespeichert, weil der Admin den Link jederzeit erneut sehen und kopieren können muss (gleiches
Vorgehen wie `icsToken`/`qrToken`). Erzeugung: `randomBytes(24).toString('base64url')` (192 Bit).

**Verwaltung.** Auf `/admin/heimatfeuerwehr` kommt eine Karte "Berichte-Schnellerfassung (iPad)" (neue Datei
`report-kiosk-card.tsx` plus Server Actions in `report-kiosk-actions.ts`, gleiches Muster wie `dashboard-token-actions.ts`).
Sie zeigt den Link mit Kopier-Schaltfläche oder "Noch nicht aktiv", mit den Aktionen "Link erzeugen", "Neu erzeugen"
(macht den alten Link sofort ungültig) und "Abschalten" (setzt die Spalte auf `null`). Jede Aktion prüft
`canManageHeimatfeuerwehrFor(user, organizationId)` für die übergebene Organisation und schreibt den Link nur auf genau
diese Zeile. Mitglieder ohne Admin-Recht haben keinen Schreibzugriff.

**Route.** Neues oberstes Segment `src/app/berichte-schnell/[token]/` (kein `(app)`-Rahmen, kein `requireUser()`), mit
Eintrag `'/berichte-schnell'` in `PUBLIC_PATH_PREFIXES` (`src/middleware.ts`). Gleiche Gründe wie bei
`/drohnen-schnell`: Layouts gelten nach Verzeichnis-Verschachtelung, nicht nach URL, ein Ort unter `(app)` würde die
Anmeldepflicht erben. Ein unbekannter, abgeschalteter oder neu erzeugter Link antwortet mit `notFound()`.

**Ersteller.** `Report.createdById` ist Pflicht. Wie bei der Drohnen-Schnellerfassung wird ein technischer, nicht
anmeldbarer Platzhalter-Benutzer (`berichte-schnellerfassung@system.local`, `isActive: false`, zufälliges Passwort-Hash)
angelegt (neue Datei `src/lib/heimatfeuerwehr/report-kiosk-user.ts` mit `getOrCreateReportKioskUser()` und
`isReportKioskEmail()`, Struktur wie `src/lib/drone/quick-register-user.ts`). `Report.filledById` ist die gewählte
Person. Folge für die Sichtbarkeit (unverändert, `canViewReport`): Die ausfüllende Person sieht den Bericht unter
"Meine Berichte", der Admin der Feuerwehr über seine Rechte; der Platzhalter kann sich nie anmelden.

## 2. Ablauf am iPad

1. **Namenswahl.** Große Namenskacheln, alphabetisch nach Nachname, mit Suchfeld oben. Nur aktive Mitglieder der
   Feuerwehr dieses Links (`NOT_DEACTIVATED_WHERE`), nur Vorname und Nachname, nie E-Mail, Stb-Nr. oder Telefon.
2. **Berichtsart.** Drei große Kacheln (Tätigkeits-, Übungs-, Einsatzbericht, `ACTIVE_REPORT_TYPES`).
3. **Assistent im Layout A.** Dieselben Schritte wie in der App: Grunddaten, bei Übungsberichten zusätzlich
   Übungsdetails, Fahrzeuge/Mitglieder, Abschluss (Material/Geräte, Löscher, Bemerkung gehören dort zum Abschluss,
   nicht zu einem eigenen Schritt). Die Schrittleiste zeigt drei Schritte, bei Übungen vier.
4. **Bestätigung.** Nach der Abgabe erscheint "Bericht Nr. 12/2026 abgegeben". Nach 30 Sekunden oder mit "Neuer Bericht"
   geht es zurück zur Namenswahl. Damit bleibt keine Person auf dem gemeinsamen Gerät "angemeldet", und die Eingaben
   der Vorgängerin sind weg (der Assistent hält seinen Zustand nur im Browser-Speicher).

Der Zustand "gewählte Person" und "gewählte Art" liegt in einem kleinen Client-Container
(`kiosk-flow.tsx`: Namenswahl, Artwahl, Assistent, Bestätigung als lokale Zustände). Alle Eingaben bleiben wie in der App
bis zur Abgabe rein clientseitig.

**"Zuletzt verwendet"** (die drei zuletzt genutzten Tätigkeits-/Übungsarten) richtet sich am gemeinsamen Gerät nicht
nach einer einzelnen Person, sondern nach der Feuerwehr: die letzten drei verschiedenen Arten über alle Berichte
dieser Feuerwehr desselben Typs (`getRecentActivityKinds` bekommt dafür eine Variante mit `fireDepartmentId` statt
`filledById`). Die Seite lädt sie je Berichtsart vor (drei Abfragen, klein).

## 3. Abgabe und Sicherheit

**Geteilter Kern.** `submitReport` (`berichte/submit-actions.ts`) wird zerlegt: Der gesamte Teil ab der Validierung
(Eingabeprüfung, Anlegen in einer Transaktion, PDF, S3, E-Mail) wandert unverändert in
`submitReportCore({ fireDepartmentId, createdById, input })` in einer neuen Datei
`src/lib/heimatfeuerwehr/submit-report-core.ts` (ohne `'use server'`, reine Funktion, wie `createUserCore` beim
MCP). Die bisherige Server Action `submitReport` ruft sie nach `requireUser()`/`canCreateReportFor` auf, mit
`fireDepartmentId = user.homeOrganizationId` und `createdById = user.id`. Verhalten und Fehlertexte der App bleiben
unverändert.

**Neue Server Action** `submitReportViaKiosk(token, input)` in `src/app/berichte-schnell/[token]/actions.ts`:

1. Rate-Limit je Link mit der vorhandenen In-Memory-Funktion `checkRateLimit` (`src/lib/mcp/rate-limit.ts`, Schlüssel
   `berichte-schnell:<token>`), 20 Abgaben pro Stunde. Bei Überschreitung statischer Fehlertext "Zu viele Abgaben.
   Bitte später erneut versuchen." Der Import aus `lib/mcp` bleibt, die Funktion ist generisch.
2. Link neu auflösen: `Organization` mit `reportKioskToken = token`, sonst Fehler "Die Schnellerfassung ist nicht
   mehr aktiv." Die Feuerwehr kommt immer aus dem Link, nie vom Gerät.
3. `getOrCreateReportKioskUser()` liefert den Ersteller.
4. `submitReportCore({ fireDepartmentId: org.id, createdById: kioskUser.id, input })`. Der Kern prüft wie bisher, dass
   Ausfüller, eingesetzte Mitglieder, Übungsleiter/-überwachung/-beobachter und Fahrzeuge zur Feuerwehr gehören, aktiv
   sind und nicht doppelt vorkommen, dass die Bemerkung gesetzt ist, die Zeiten stimmen und Codes bekannt sind.
5. Gibt `{ reportId, number }` zurück (statt nur `reportId`), damit die Bestätigung die Nummer zeigen kann.

Der Doppelklick-Schutz bleibt wie in der App (Schaltfläche nach dem ersten Klick deaktiviert, bewusst akzeptiert). Die
Seite `/berichte-schnell/[token]` lädt Mitglieder (nur Name), Fahrzeuge und "Zuletzt verwendet" serverseitig und gibt
sie als Props an den Client. Ein neu erzeugter oder abgeschalteter Link wirkt beim nächsten Seitenaufruf und bei der
nächsten Abgabe sofort (die Abgabe prüft den Link neu, auch wenn die Seite noch offen war).

## 4. Layout A und Assistent-Anpassung

`ReportWizard` (`berichte/neu/report-wizard.tsx`) bekommt vier neue, optionale Props, damit er ohne App-Navigation
läuft; ohne sie verhält er sich exakt wie heute:

- `layout?: 'mobile' | 'tablet'` (Standard `'mobile'`)
- `onSubmit?: (payload: SubmitReportInput) => Promise<{ error?: string; reportId?: string; number?: number }>`
  (Standard: `submitReport`)
- `onDone?: (result: { reportId: string; number?: number }) => void` (Standard: `router.push` zur
  Abgeschlossen-Seite)
- `onCancel?: () => void` (Standard: der "Meine Feuerwehr"-Link im Kopf)

Im Layout `'tablet'` (und nur dort, am Kiosk erzwungen ab Fensterbreite 1024 px, darunter fällt die Seite auf das
Handy-Layout zurück):

- Kopfleiste mit Feuerwehr und Ausfüller, links eine feste Schrittleiste (Schritte als große Pillen, abgeschlossene mit
  Häkchen, aktueller hervorgehoben, Sprung nur auf bereits besuchte Schritte), rechts der Schrittinhalt in zwei
  Spalten, unten eine feste Leiste mit "Zurück" und "Weiter"/"Bericht abgeben".
- Alle Tipp-Ziele mindestens 48 px hoch. Fahrzeuge und Mitglieder erscheinen als Kacheln im Raster (je nach Breite
  zwei bis drei Spalten) statt als Listen mit Popover.
- Schrittinhalte und Eingabelogik bleiben dieselben Komponenten und derselbe Zustand; nur die Anordnung wird per
  `layout` umgestellt. Kein zweiter Zustand, keine zweite Prüfung.
- Sicherheitsbereiche (`env(safe-area-inset-*)`) und `touch-action: manipulation` auf der Kiosk-Seite; kein Zoom
  durch Doppeltipp.

Der bestehende `MemberMultiSelect` (Popover mit Checkboxen) bleibt am Handy. Für `layout='tablet'` kommt eine
Kachelvariante (`MemberTileSelect`, gleiche Schnittstelle `excludeIds`/`onAdd`) in `components/heimatfeuerwehr/`; sie
ersetzt am Tablet das Popover. Die Zuordnung der Mitglieder zu Fahrzeugen und die "Ohne Fahrzeug"-Karte bleiben
inhaltlich gleich.

## 5. Dateien (Überblick)

Neu:
- `prisma/migrations/<zeitstempel>_report_kiosk_token/migration.sql` (eine nullable Spalte mit Unique-Index)
- `src/lib/heimatfeuerwehr/submit-report-core.ts`, `report-kiosk-user.ts`
- `src/app/berichte-schnell/[token]/page.tsx`, `actions.ts`, `kiosk-flow.tsx`, `loading.tsx` (falls nötig)
- `src/components/heimatfeuerwehr/member-tile-select.tsx`
- `src/app/(app)/admin/heimatfeuerwehr/report-kiosk-card.tsx`, `report-kiosk-actions.ts`

Geändert:
- `prisma/schema.prisma` (Spalte), `src/middleware.ts` (öffentlicher Pfad)
- `src/app/(app)/meine-feuerwehr/berichte/submit-actions.ts` (ruft den Kern auf)
- `src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.tsx` (Props, Tablet-Layout)
- `src/app/(app)/meine-feuerwehr/berichte/neu/page.tsx` (`getRecentActivityKinds` wandert mit der neuen
  Feuerwehr-Variante in eine gemeinsame Datei unter `src/lib/heimatfeuerwehr/`, beide Seiten importieren sie von dort)
- `src/app/(app)/admin/heimatfeuerwehr/page.tsx` (Karte einbinden)
- Dokumentation: `src/app/(app)/meine-feuerwehr/CLAUDE.md` (neuer Abschnitt), Wurzel-`CLAUDE.md` (Route-Gruppen: neues
  öffentliches Segment), `docker/README.md` nur falls Betriebshinweise nötig werden (keine neue Umgebungsvariable).

Es kommt keine neue Umgebungsvariable und keine neue Abhängigkeit hinzu; `docker/docker-compose.yml` bleibt unverändert.

## 6. Tests und Prüfung

- **Unit (`npm test`):** der geteilte Kern ohne Datenbank, soweit er rein ist (Eingabeprüfung); Verhalten der
  Kachelauswahl (Auswahl, Ausschlüsse); Link-/Rate-Limit-Logik der Kiosk-Action mit gemocktem Prisma wo nötig.
- **DB (`npm run test:db`, nur lokale Dev-Datenbank, Fixtures mit eigenem Präfix und geschützter Aufräumung):**
  gültiger Link legt Bericht mit Platzhalter als Ersteller und gewähltem Ausfüller an; unbekannter, abgeschalteter
  und neu erzeugter Link werden abgelehnt (auch bei geöffneter Seite); Ausfüller, Mitglied, Fahrzeug und
  Übungsrolle einer anderen Feuerwehr werden abgelehnt; deaktiviertes Mitglied wird abgelehnt; Rate-Limit greift;
  die bestehende `submitReport`-Aktion verhält sich unverändert (Regressionstest auf den Kern); Verwaltungs-Actions
  prüfen `canManageHeimatfeuerwehrFor` (fremder Admin wird abgewiesen).
- **Layout:** Prüfung im Browser bei 1180×820 und 1024×768 (Seitenleiste, Zwei-Spalten, Tipp-Ziele, Wechsel auf das
  Handy-Layout unter 1024 px) per `resize_window`. Die Hydration funktioniert in dieser Umgebung nicht, deshalb wird
  nur das serverseitig gerenderte Ergebnis geprüft; das Durchklicken des ganzen Ablaufs macht der App-Betreiber auf
  dem echten iPad.
- Standardprüfung vor Abschluss: `npx tsc --noEmit`, `npm test`, `npm run test:db`, `npm run build`.

## 7. Rollout

1. DEV zuerst (`/opt/app-177-dev`), Link in `/admin/heimatfeuerwehr` erzeugen, am iPad aufrufen, je einen
   Tätigkeits-, Übungs- und Einsatzbericht abgeben, PDF und E-Mail prüfen.
2. Dann PROD: Backup, `git pull`, Rebuild; die Migration läuft im Entrypoint. Alle Feuerwehren bleiben ausgeschaltet,
   bis ein Admin den Link erzeugt.
3. Den Link am iPad als Lesezeichen/Startbildschirm-Symbol ablegen (siehe offene Punkte).

## Offene Punkte (nicht blockierend)

- **Startbildschirm-Symbol am iPad:** Das Manifest der App ist statisch. Ob "Zum Home-Bildschirm" auf iOS die
  aktuelle Seite (den geheimen Link) oder `start_url` des Manifests öffnet, ist nicht bestätigt und wird auf dem
  echten iPad geprüft. Fallback: Lesezeichen in Safari. Keine eigene Manifest-Variante in dieser Spec.
- **Kachelgrößen und Bemerkungsfeld:** Die genauen Größen der Kacheln und des Bemerkungs-Textfeldes am iPad (Tastatur
  im Querformat verdeckt viel) werden erst auf dem Gerät endgültig bewertet.
- **Link verloren/weitergegeben:** Kein Zugriffsprotokoll am Link. Wer den Verdacht hat, dass der Link bekannt ist,
  erzeugt ihn neu; das iPad muss dann einmal mit dem neuen Link geöffnet werden.
