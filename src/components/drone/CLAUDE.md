# CLAUDE.md — Drohnengruppe module

This file loads automatically (in addition to the root CLAUDE.md) when Claude Code works with files under this directory. Moved out of the root CLAUDE.md by a /doctor pass (context-size cleanup) — content is unchanged verbatim.

### Drohnengruppe module

> **The Flugbuch-Redesign pass below ("Drohnengruppe Flugbuch-Redesign") superseded most of the
> concrete file names in this section and in "Drohnengruppe V2"** — `flight-table.tsx`,
> `ninety-day-ring.tsx`, `group-status-chart.tsx`, and the standalone `/drohnen/90-tage` page are all
> **deleted**; read `NinetyDayRing`/`GroupStatusChart`/the 90-Tage page below as history, not current
> files. `PurposeBadge` is the one component from "Drohnengruppe V2" that survived unchanged, still
> used by the redesign's `FlightRow`/`FlightCard`.

Visibility of the whole module and of *all* flights (vs. just your own + ones you piloted) are separate
checks — `canViewDroneModule` (module visibility) vs. `canViewAllFlights` (row-level scope, Admin
Drohnengruppe only). `src/lib/drone/members.ts` (`listDrohnengruppeMembers`) is the shared query for
"who can be picked as a pilot" — reused by the flight form, the 90-day report, and nowhere else; keep it that
way rather than duplicating the `where: { droneMembership: { isNot: null } }` filter.

`/drohnen`'s "Alle Flüge einsehen" toggle (now in `components/drone/flight-sidebar.tsx`'s
`FlightSidebar`, default on) is purely a client-side display filter, not a permission boundary: the
server query in `page.tsx` already fetches every flight whenever `canViewAllFlights(user)` is true, and
the toggle just filters that already-loaded array down to the current user's own registered/piloted
flights when switched off. Only rendered at all when `canToggle` (= `canViewAllFlights`) is true —
non-admins never see it and always get the server-side-scoped own-flights query, same as before this
toggle existed.

- **Unterlagen (PDFs for members)**: `DroneDocument` stores the PDF bytes directly in Postgres
  (`data Bytes`) rather than on a filesystem/volume — deliberate, since the expected volume is a
  handful of small documents, and this way there's no extra Docker mount to provision and the
  files ride along automatically in the existing `pg_dump` backup. List queries (`/admin/drohnen`,
  `/drohnen/unterlagen`) always `select` metadata only (never `data`) to avoid pulling PDF bytes
  into memory just to render a list; only the single-document download route
  (`/drohnen/unterlagen/[id]/route.ts`) fetches the full row. Upload/delete live on `/admin/drohnen`
  (gated `isSiteAdmin`, same as the rest of that page) rather than a new admin page — the "Flug
  registrieren"/"Drohnen"-style precedent here is to add a section to an existing admin page, not a
  new nav entry (`AdminSidebarNav`/`AdminMobileTabs`), unless the feature needs its own URL. The 1MB
  default Server Action body
  limit was raised app-wide to 10MB (`next.config.mjs`) specifically for this upload, since Server
  Actions have no per-route size config.
- **90-day/3-flight rule**: constants and the shared cutoff/predicate helpers live in
  `src/lib/drone/ninety-day-rule.ts` (`NINETY_DAY_REQUIRED_FLIGHTS`, `NINETY_DAY_WINDOW_DAYS`,
  `getNinetyDayCutoff()`, `meetsNinetyDayRule()`) — both the Admin-only `/drohnen/90-tage` report (all
  members) and the `NinetyDayRing` every member sees for *themselves* on `/drohnen` read from here, so the
  rule can never drift between the two views. `getComplianceUntilDate()` (same file) projects the date the
  rule would lapse with no further flights: it's 90 days after the `NINETY_DAY_REQUIRED_FLIGHTS`-th most
  recent flight still inside the window — that's the specific flight whose expiry would drop the count below
  the threshold, not simply the oldest flight in the window.
- **Ausbildungsstufen (Verwaltung)**: fünf sequenzielle Ausbildungsstufen (A1/A3-Lizenz → A2-Lizenz →
  Stützpunktausbildung → BOS1 → BOS2) leben als nullable `DateTime`-Felder direkt auf
  `DrohnengruppeMembership`, nicht auf `User` — sie ergeben nur für tatsächliche Gruppenmitglieder einen
  Sinn. Eine einzige "gültiger Präfix"-Invariante (eine Stufe darf nur gesetzt sein, wenn jede
  vorangehende Stufe ebenfalls gesetzt ist) wird über ein einzelnes `.superRefine()` auf `userSchema`
  erzwungen und verhindert damit gleichzeitig sowohl das Überspringen einer Stufe als auch das Entziehen
  einer mittleren Stufe, solange eine spätere noch davon abhängt. **Achtung**: `syncDroneMembership`s
  (`admin/benutzer/actions.ts`) Early-Return wurde gezielt um eine `ausbildungChanged`-Prüfung erweitert,
  damit eine reine Ausbildungsdaten-Änderung (ohne Rollen-/Gruppenwechsel) nicht stillschweigend
  übersprungen wird — würde man diesen Term wieder aus der Early-Return-Bedingung entfernen, würde jede
  reine Ausbildungs-Bearbeitung scheinbar erfolgreich speichern (kein Fehler, Erfolgs-Toast), ohne dass
  tatsächlich etwas in die Datenbank geschrieben wird; genau die Art von leicht übersehener Regression,
  die es hier explizit zu vermeiden gilt. Wird `droneRole` auf `'NONE'` zurückgesetzt, löscht das
  bestehende `deleteMany` die gesamte `DrohnengruppeMembership`-Zeile — inklusive aller 5
  Ausbildungsdaten. Das ist eine bewusste Konsequenz der Datenmodell-Entscheidung oben und wird seit dem
  finalen Review über eine clientseitige Warnung in `UserFormSheet` sichtbar gemacht, statt stillschweigend
  zu passieren.
- **Einsatzbereitschaft (Drohnengruppe)**: das oben als "noch nicht gebaut" beschriebene Konzept aus
  `Verwaltung-Filter-Brief.md` §6.1 existiert jetzt — eine neue Seite
  `/admin/drohnen/einsatzbereitschaft`, erreichbar über einen In-Page-Link auf `/admin/drohnen` (kein
  eigener `AdminSidebarNav`/`AdminMobileTabs`-Eintrag, gleiches Muster wie die "Historie"-Verlinkung bei
  Fahrzeugen in Heimatfeuerwehr). Berechnet von `src/lib/drone/einsatzbereitschaft.ts`s
  `getGruppenEinsatzbereitschaft`/`classifyFlightCount`: für jedes Mitglied MIT gesetztem
  `bos1AusbildungAm` eine Ampel — GRÜN (≥ `NINETY_DAY_REQUIRED_FLIGHTS` Flüge im 90-Tage-Fenster), GELB
  (genau einer zu wenig), ROT (alles darunter, ohne Unterscheidung zwischen "nie erfüllt" und "abgelaufen")
  — plus zwei Kennzahlen pro Gruppe (Mitglieder gesamt, Mitglieder mit A2-Zertifikat). Mehrere
  erreichbare Gruppen (Bezirksadmin/Bezirks-Drohnenadmin) zeigen ein Kachel-Grid mit Drilldown; eine
  einzelne Gruppe zeigt die Detail-Ansicht direkt. Die zugrunde liegende
  `prisma.drohnengruppeMembership.findMany`-Abfrage filtert dabei bewusst mit `NOT_DEACTIVATED_WHERE`
  (`@/lib/auth/user-status`) auf `user` — ohne diesen Filter würde ein DEAKTIVIERTER Ex-Pilot mit
  weiterhin bestehender `DrohnengruppeMembership`-Zeile (nur das Entziehen der Gruppenrolle löscht diese
  Zeile, eine bloße Deaktivierung nicht) in `totalMembers`/`a2Count` mitzählen und, falls
  `bos1AusbildungAm` gesetzt ist, fälschlich ROT-klassifiziert ganz oben in der Dringlichkeitsliste
  auftauchen — genau der Fehler, den jede andere Drohnengruppen-Mitgliederliste in dieser Codebase
  (`listDrohnengruppeMembers`) bereits vermeidet.

**Drohnengruppe V2 (Signalrot-Mockup-Angleichung)** — the three items below (`NinetyDayRing`,
`GroupStatusChart`, `PurposeBadge`) were one pass to bring this module in line with the "Signalrot" design
mockup, done first among the four modules; Kalender's equivalent pass ("Kalender V2") followed it.

- **`NinetyDayRing`** (`src/components/drone/ninety-day-ring.tsx`) replaced a plain colored `<span>` badge
  that only explained itself via a `title` tooltip — undiscoverable on touch devices, since there's no hover.
  It's a hand-rolled SVG ring (`stroke-dasharray`/`stroke-dashoffset`), not a chart library, matching this
  codebase's "no icon/chart dependency, inline SVG" convention elsewhere (e.g. the edit-pencil icon in
  `user-management-section.tsx`).
- **`GroupStatusChart`** (`src/components/drone/group-status-chart.tsx`), a per-pilot bar chart of 90-day
  compliance, is rendered on `/drohnen` only when `canViewAllFlights(user)` (Admin Drohnengruppe) — deliberately
  the same permission as the existing `/drohnen/90-tage` report, not opened up to all members. Showing every
  pilot's name next to a compliant/non-compliant color is more exposing than what a regular member could see
  before (only their own status), so this was a conscious choice confirmed with the app owner rather than
  matched blindly to a design mockup that had no permission model behind it.
- **`PurposeBadge`** (`src/components/drone/purpose-badge.tsx`) renders "Einsatz" as a solid brand-red pill and
  "Übung" as an outlined neutral pill, used in both `FlightTable`'s desktop row and its mobile `FlightCard` —
  a single shared component so the two views can't diverge on this styling.
- **Flight-created email notification**: `src/lib/drone/notify-flight-created.ts` is the single place that
  builds and sends the "neuer Drohnenflug" email (reads the recipient from `AppSettings` via
  `getDroneFlightNotificationEmail()`, no-ops if unset, swallows send errors so a Mailjet outage never blocks
  saving a flight). Called from both `createFlight` (normal form) and the QR quick-register action below —
  don't duplicate the email-building logic at either call site again.
- **QR-code quick registration** (`src/app/drohnen-schnell/[token]/*`): a fully public, no-login page meant
  to be printed as a QR code so a pilot can log a flight on their phone without signing in. Gated purely by
  a bearer token stored in `DroneGroup.qrToken` — **one token per Drohnengruppe** (it used to be a single
  app-wide `AppSettings.droneQuickRegisterToken`), generated/rotated from `/admin/drohnen` for whichever
  group is selected there, and the token itself is what identifies the group the flight belongs to. Same
  shape as `Organization.icsToken` — an unguessable capability URL, not a password. The server action
  re-checks the token itself (never trusts that the page-level check ran). Flights created this way are
  attributed to a dedicated, `isActive: false` system user (`src/lib/drone/quick-register-user.ts`,
  lazily upserted by email `drohnen-schnellerfassung@system.local`) instead of a real session — this is what
  makes the link create-only: that user can never log in, so nothing it "owns" can be read back or edited
  through this path, only by an Admin Drohnengruppe via the normal UI. Don't route this flow through
  `requireUser()`/a real login — that would reintroduce a shared-session risk the token design avoids.
  **GitHub issue #14**: the member-facing Flugbuch (`/drohnen`) used to also show a small
  "Schnellerfassung" card linking to this same URL, next to the Unterlagen/QR card in the sidebar —
  removed entirely per the issue ("nicht für den Benutzer sichtbar machen"). Creating/rotating the
  link stays exclusively on `/admin/drohnen`'s own "QR-Code Schnellerfassung" card (unchanged, still
  fully functional there) — a regular member can still use a link someone else printed/shared, they
  just no longer discover or copy it from inside their own Flugbuch view. `selectedGroup`'s query in
  `drohnen/page.tsx` no longer selects `qrToken` at all, since nothing on that page reads it anymore.

**Drohnengruppe Flugbuch-Redesign** — a full rebuild of `/drohnen`, matching the Kalender-Desktop
visual language (month-grouped list, left sidebar with filters). Replaces the old flat
`flight-table.tsx`/`ninety-day-ring.tsx`/`group-status-chart.tsx`/standalone `/drohnen/90-tage`
page (all deleted) with:

- `src/components/drone/flight-row.tsx` (`FlightRow`, desktop `sm:`+, and `FlightCard`, mobile) —
  a month-grouped card list, each flight a single row: date box, location+`PurposeBadge`+
  time/pilot/drone line, a fixed-width "Erfasst von …" column, and a right-aligned "Bearbeiten"
  button. `src/lib/drone/group-flights-by-month.ts`'s `groupFlightsByMonth()` buckets the
  already-sorted flight list into month cards, mirroring Kalender's own `groupEventsByMonth()`.
- `src/components/drone/flight-sidebar.tsx` (`FlightSidebar`, client component) — Pilot/Drohne/
  Zeitraum selects, the Zweck color legend, the "Alle Flüge einsehen" toggle, and (admin-only) the
  Qualifikations-Filter dropdown described below. Pure URL-state, same `setParam(key, value)`
  pattern already established for every other filter on this page.
- `src/components/drone/mein-status-card.tsx` (`MeinStatusCard`) replaces the old `NinetyDayRing` —
  same 90-day-rule data, restyled as a small sidebar card instead of an SVG ring.
- `src/components/drone/group-status-list.tsx` (`GroupStatusList`) replaces the old
  `GroupStatusChart` — a per-pilot bar list (same `canViewAllFlights`-gating as before), now
  embedded directly above the flight list instead of as a separate chart component.
- `/drohnen/90-tage-export` (new route) + the existing `/drohnen/export` are how the retired
  `/drohnen/90-tage` page's content is still reachable — both are Excel downloads now, no more
  standalone HTML report page. **Both export routes must independently re-check
  `canViewDroneModule`/`canViewAllFlights`** — a real Critical finding from the final review: they
  were initially reachable by anyone who could guess the URL, since only the page itself (not the
  routes) had been gated.
- **Admin reach widened**: the admin view (Gruppenstatus list, "Alle Flüge einsehen" default-on,
  Pilot filter, exports) is no longer restricted to only that group's own Admin Drohnengruppe — any
  Abschnittsadmin or Bezirksadmin also sees the admin view for groups within their reach, via
  `src/lib/drone/flightbook-groups.ts`'s `getAllowedDroneGroups(user)` (returns every `DroneGroup`
  the viewer may administer, empty array for a plain member/pilot). `isAdmin` on the page is simply
  `allowedGroups.length > 0` — no separate boolean, one source of truth for "does this viewer get
  the admin experience."
- **Flug erstellen/bearbeiten/löschen gruppenübergreifend für Admins** (Fix, gefunden während einer
  Debugging-Session zu einem gelöschten Flug): `canManageFlight` prüfte ursprünglich nur
  `isDroneGroupAdmin(user) && user.droneGroupId === flight.droneGroupId` — ein Bezirksadmin/Bezirks-
  Drohnenadmin/Abschnittsadmin ohne eigene Mitgliedschaft in der jeweiligen Gruppe konnte fremde
  Flüge dadurch weder bearbeiten noch löschen, obwohl er die Gruppe selbst über
  `canManageDroneGroupFor` sonst überall verwalten darf. `canManageFlight` delegiert jetzt an genau
  diese Funktion (`canManageDroneGroupFor(user, {id: droneGroupId, organizationId}) ||
  flight.registeredById === user.id`) — dafür brauchen alle Aufrufstellen jetzt zusätzlich
  `drone.droneGroup.organizationId`, nicht mehr nur `drone.droneGroupId`. Symmetrisch dazu regelt
  die neue `canRegisterFlightFor(user, droneGroup)` (`user.droneGroupId === droneGroup.id ||
  canManageDroneGroupFor(user, droneGroup)`) das Erstellen: `/drohnen/neu` hat jetzt denselben
  Gruppenwechsel-Pillen wie `/drohnen` (`getAllowedDroneGroups`), und `createFlight` nimmt die
  Ziel-`droneGroupId` als gebundenes erstes Server-Action-Argument (`.bind(null, droneGroupId)`,
  gleiches Muster wie `updateFlight`/`deleteFlight`s `flightId`-Bindung) statt sie aus
  `user.droneGroupId` abzuleiten. `canViewDroneModule` bekam dafür zusätzlich einen
  `isBezirksDrohnenAdmin`-Bypass (bewusst NICHT `isBezirksAdmin` — das bleibt laut der bestehenden
  Sicherheitsentscheidung oben ausgeschlossen), da ein reiner Bezirks-Drohnenadmin ohne eigene
  `DrohnengruppeMembership` sonst nie über die allererste Prüfung der Seite hinausgekommen wäre.

**Drohnengruppe Qualifikations-Filter** — an Admin-only, multi-select "Qualifikation" dropdown in
`FlightSidebar` (a hand-rolled button+checkbox-panel toggle, no shadcn `Popover`/`Command` — this
module stays hand-rolled per its own established convention) that narrows both the flight list
and the `GroupStatusList` bar list to pilots matching the selected Ausbildungsstufen.

**Reversed from the original AND design (follow-up change by the app owner)**: A1/A3, A2 and
Stützpunktausbildung now match "genau hier stehen geblieben" (stage set, next stage NOT set) instead
of "hat diese Stufe erreicht" — the filter's purpose is finding training gaps ("wer muss noch
ausgebildet werden, um BOS1 zu erreichen"), so checking A1/A3 must exclude anyone who already
progressed past it. BOS1/BOS2 deliberately keep the old "reached this stage" (inclusive of higher
stages) semantics — BOS1 is the training *goal*, so its filter should still show everyone who got
there, including those who went on to BOS2. `EXACT_STAGE_KEYS` in `qualification-filter.ts` marks
which three keys get the new "exact stage" treatment. Multiple selections now combine with **OR**,
not AND (`matchesQualification`'s `.some(...)`, was `.every(...)`) — AND would be useless once two
"exact stage" checkboxes are both active, since no one can be stuck at two different stages at once;
"A1/A3 + A2" now shows everyone stuck at either one. `selectedQualifications` never contains `'NONE'`
together with a real stage key (`toggleQualification` in `flight-sidebar.tsx` clears `'NONE'` the
moment any real checkbox is turned on), so that combination isn't specially handled.

- The filter reads `?qualifikation=` from the URL as a comma-separated list of
  `Ausbildungsstufe` keys (`@/lib/validation/user.schema`'s `AUSBILDUNGSSTUFEN`), fed into
  `matchesQualification(membership, selected)` against a purpose-built extended members query in
  `drohnen/page.tsx` (loads the five training-date fields alongside id/name — **not**
  `listDrohnengruppeMembers()`, which several other call sites share and which doesn't need these
  fields) that must run *before* and *outside* the page's later `Promise.all` for the flights query,
  since the flights query's `pilotUserId: { in: [...matchingMemberIds] } }` filter depends on its
  result — a circular-dependency bug caught during planning, not after the fact.
- **BOS1-als-Standardauswahl (Folgeänderung nach dem ersten Live-Test)**: die ursprüngliche Fassung
  hatte sechs Checkboxen (fünf echte Stufen + eine eigene "Ohne Ausbildung") und eine leere Auswahl
  bedeutete "kein Filter, zeige alle". Auf Wunsch des App-Betreibers, nachdem er das Feature live
  gesehen hatte, wurde das geändert: **BOS1 ist jetzt die Standardauswahl bei jedem frischen
  Seitenaufruf**, und die eigene "Ohne Ausbildung"-Checkbox ist komplett entfernt — "keine Checkbox
  aktiv" bedeutet jetzt direkt "Ohne Ausbildung" statt "kein Filter" (explizit vom App-Betreiber
  bestätigt, nicht selbst angenommen). `resolveSelectedQualifications(raw: string | null |
  undefined)` (`qualification-filter.ts`) ist die EINE gemeinsame Auflösungsstelle für Server
  (`page.tsx`) und Client (`FlightSidebar`), damit beide nie auseinanderlaufen: Parameter fehlt ganz
  → `[QUALIFICATION_DEFAULT_KEY]` (= `bos1AusbildungAm`); Parameter ist exakt das `'NONE'`-Sentinel
  (geschrieben, sobald die letzte echte Checkbox deaktiviert wird) → `['NONE']`; sonst die
  kommagetrennte, gegen `QUALIFICATION_OPTIONS` gefilterte Liste. `QUALIFICATION_OPTIONS` selbst
  listet jetzt nur noch die fünf echten Stufen (keine eigene Checkbox mehr für "Ohne Ausbildung") —
  die UI zeigt automatisch nur fünf Checkboxen, ohne dass die JSX selbst angepasst werden musste. Es
  gibt seitdem **keinen Weg mehr, über diesen Filter "alle Piloten unabhängig von der Ausbildung"**
  zu sehen — nur echte Stufen ankreuzen oder den impliziten BOS1-Standard nutzen.
- **Reale Race Condition (finales Review, behoben)**: `selectedQualifications` wurde ursprünglich
  direkt aus `useSearchParams()` gelesen; da `router.push` innerhalb eines React-Transitions
  committet, liefert `useSearchParams()` bei zwei schnell aufeinanderfolgenden Klicks noch den ALTEN
  Wert, wodurch die zweite Checkbox die erste stillschweigend wieder verwarf. Behoben durch lokalen
  `useState` als Wahrheitsquelle (synchron innerhalb von `toggleQualification` aktualisiert, bevor
  der URL-Push feuert), mit einem `useEffect`, der nur bei einer ÄUSSEREN URL-Änderung
  (Browser-Zurück, geteilter Link) resynchronisiert.

**Bugfix: Bearbeiten-Button im Flugbuch horizontal verschoben** (echter, vom App-Betreiber
gemeldeter Bug, per Screenshot): `FlightRow`s innerer `content`-Div (die eigentliche
Spalten-Zeile mit Datum/Ort/Erfasst-von/Bearbeiten) ist ein Flex-Item der äußeren Zeilen-`Link`
(`sm:flex`) — Flex-Items wachsen per Default NICHT über ihre Content-Breite hinaus
(`flex-grow: 0`). Ohne ein explizites `w-full` auf `content` bestimmte daher die Länge von
Ort/Pilot/Drohne/„Erfasst von …" jeder einzelnen Zeile deren Gesamtbreite, wodurch der
rechtsbündige "Bearbeiten"-Button je nach Textlänge horizontal driftete, statt für alle Zeilen an
derselben Position zu stehen. Gefixt mit `w-full` auf `content` plus `overflow-hidden`/`truncate`
auf den beiden variable-Text-Spalten (Ort/Pilot/Drohne-Zeile, "Erfasst von …") als zweite
Absicherung, damit auch ein einzelnes unbrechbares Wort (z. B. ein langer Nachname) seine Spalte
nie über die vorgesehene Breite hinaus aufdrücken kann — beide Fixes sind nötig, keiner allein
reicht. Verifiziert an einer isolierten Reproduktion mit der echten kompilierten Tailwind-CSS
(nicht im echten `/drohnen` selbst, da dieser Weg über `loading.tsx`/React-Suspense-Streaming läuft
und in diesem Browser-Automatisierungs-Umfeld — derselbe bereits an vielen Stellen in dieser Datei
dokumentierte Hydration-Gap — nie über den Lade-Skeleton hinaus rendert): vor dem Fix drifteten drei
Testzeilen mit stark unterschiedlicher Textlänge um über 400px, mit dem Fix liegen alle drei exakt
an derselben Position.

