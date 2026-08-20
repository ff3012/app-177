# CLAUDE.md — Meine Feuerwehr

This file loads automatically (in addition to the root CLAUDE.md) when Claude Code works with files under this directory. Moved out of the root CLAUDE.md by a /doctor pass (context-size cleanup) — content is unchanged verbatim.

### Module 4: Meine Feuerwehr

`/meine-feuerwehr` ("Meine Feuerwehr" = the user's own `homeOrganizationId`) is unconditionally visible to
every logged-in user (added to `getNavItems` right after Kalender, same as Kalender itself — no permission
check needed since every user has a home org) and shows two things: their own Atemschutz status, and their
home Feuerwehr's vehicle fleet ("Fuhrpark") for borrowing.

- **Atemschutz** (`User.istAtemschutzgeraeteTraeger`/`atemschutzUntersuchungAm`/`atemschutzGueltigBis`/
  `atemschutzFinnentestAm`, plain nullable fields on `User` — same pattern as `stbNr`/`phone`, not a separate
  1:1 table, since they're single-valued not historical) is **read-only** on this page — members only have
  "Einsicht" (view). Editing is split across two places by data-ownership, not by page (a later, deliberate
  restructuring of the original single-dialog design): **whether** someone is an Atemschutzgeräteträger at
  all (`istAtemschutzgeraeteTraeger`) is now a plain toggle in Benutzerverwaltung's `UserFormSheet` (Person
  section, alongside `isActive`) — it's a basic user attribute, like `stbNr`, not Heimatfeuerwehr-specific
  data — while the three **date** fields (Untersuchung/Gültig-bis/Finnentest) plus the AKTIV/expiry overview
  stay in Verwaltung → Heimatfeuerwehr (see below), since that's operational compliance data a Feuerwehr's
  own Atemschutz-Sachbearbeiter manages. `atemschutzGueltigBis` is a genuinely separate, explicitly-stored field from
  `atemschutzUntersuchungAm` — **not** computed as "+5 years" on read — because a doctor can set a shorter
  validity than the 5-year default; `src/lib/heimatfeuerwehr/atemschutz-status.ts`'s `isUntersuchungActive()`
  just compares the stored `atemschutzGueltigBis` against now. `atemschutzFinnentestAm` by contrast has no
  override field at all: the Finnentest's 1-year validity is a fixed, non-negotiable rule per the brief, so
  `isFinnentestActive()`/`getFinnentestCutoff()` compute it the same way `ninety-day-rule.ts` computes drone
  compliance (today minus a fixed window) — this file is deliberately modeled on that existing pattern.
- **Fuhrpark / vehicle booking**: `Vehicle` (per-organization fleet, `taktischeBezeichnung`/`kennzeichen`
  `@unique`/`marke`/`typ`/`isActive`) and `VehicleBooking` (`vehicleId`/`userId`/`startsAt`/`endsAt`) are new
  models. The member page lists the home org's active vehicles, each with its own upcoming bookings shown
  inline (date/time + borrower's name) *before* the user books — this is what satisfies "zeige an wenn es
  bereits gebucht ist und von wem". `/meine-feuerwehr/buchen` is the booking form (own page, matching the
  `/drohnen/neu`-style convention rather than an inline card): one shared `<input type="date">` plus two
  independent `Time15MinSelect` dropdowns (Start/Ende) — a **new** component
  (`src/components/ui/time-15min-select.tsx`) factored out of `DateTime15MinInput`'s existing
  `TIME_OPTIONS` generation, since here two time selects share one date instead of each field bundling its
  own date+time. `createVehicleBooking` (`meine-feuerwehr/actions.ts`) re-validates the overlap server-side
  via `src/lib/heimatfeuerwehr/vehicle-availability.ts`'s `findOverlappingBooking()` — a plain interval
  overlap query (`existingStart < newEnd AND existingEnd > newStart`, verified with six manual overlap/
  adjacent/separate-day cases against real seeded data before shipping) — a Postgres exclusion constraint
  can't be expressed through Prisma, so this is enforced in application code only, same recheck-at-write-time
  philosophy as `isEligiblePilot`/`isActiveDrone` in the Drohnengruppe module. Cancelling a booking
  (`cancelVehicleBooking`) is allowed for the booking's own `userId` or anyone who can manage that vehicle's
  organization (`canManageVehicleBooking`) — mirrors `canManageFlight`'s "own record or module admin" shape.
- **`VehicleBooking.details`** (added later, nullable `String`): a free-text field the borrower must fill in
  (`vehicleBookingSchema` requires it, 1–500 chars) describing the purpose of the booking, but **admin-only
  to read back** — it's deliberately absent from `/meine-feuerwehr`'s own "Meine Buchungen" list (the
  borrower themselves never sees it again after submitting) and from the public dashboard kiosk
  (`lib/dashboard/data.ts`'s query only ever `select`s vehicle name/borrower name, never `details`) and from
  the linked `Event`'s title/description (still just `"Fahrzeug: {taktischeBezeichnung} ({Name})"`, unchanged
  — putting it there would leak it to every Kalender viewer). Only shown as a "Details" column on the two
  genuinely admin-only surfaces: `/admin/heimatfeuerwehr`'s "Fahrzeug-Buchungen" table (all bookings for the
  selected org) and `/admin/heimatfeuerwehr/fahrzeug/[vehicleId]`'s Buchungshistorie — both already
  `canManageHeimatfeuerwehrFor`-gated pages, so no new permission check was needed, just a new column.
  Nullable at the DB level (existing bookings have no value) with the "required" rule enforced only in
  `vehicleBookingSchema`/`BookingForm`, the same nullable-but-form-required pattern used elsewhere in this
  codebase rather than a DB `NOT NULL` that would need a backfill value for old rows. Verified live: a
  booking inserted with a distinctive `details` string appears verbatim on both admin surfaces, while
  `/meine-feuerwehr`'s own booking list (viewed as the same user who created it) shows the booking but never
  that string.

**Verwaltung → Heimatfeuerwehr** (`/admin/heimatfeuerwehr`) is where the Fuhrpark and Atemschutz data actually
get edited — a new admin page inside the existing `/admin/*` Verwaltung shell, using the same shadcn
Table/Badge/Dialog toolkit as the other admin pages (this is Verwaltung, not a member page, so it follows
that philosophy, not the hand-rolled one `/meine-feuerwehr` itself uses).

- **New permission tier**: unlike every other admin page, this one must be visible to *both*
  Abschnittskommando-Admins *and* plain Feuerwehr-Admins (an org-level `Membership` with role `ADMIN`, no
  Abschnittskommando admin membership required) — the brief explicitly asked for this. `canManageHeimatfeuerwehrFor(user, organizationId)` (`lib/auth/permissions.ts`) is `isSiteAdmin(user) ||
  canManageEventsFor(user, organizationId)` — deliberately a **new**, separately-named function rather than
  reusing `canManageEventsFor` directly, because the rule genuinely differs: `canManageEventsFor` was written
  so a site admin *without* an explicit per-org `Membership` cannot manage that org's events (see its own
  comment), but here a site admin must always have access regardless. `canAccessHeimatfeuerwehrAdmin(user)`
  (`isSiteAdmin(user) || user.feuerwehrAdminOrgIds.length > 0`) gates module/nav visibility. The page itself
  resolves which org(s) the current user may manage into an `?org=<id>`-driven selector (site admins choose
  from every Feuerwehr; a plain Feuerwehr-Admin only ever sees their own).
- **Security hardening this required**: `admin/layout.tsx`'s gate was previously `isSiteAdmin`-only for *all*
  of `/admin/*`; it's now `canAccessHeimatfeuerwehrAdmin` (which already includes `isSiteAdmin`), so a plain
  Feuerwehr-Admin can get past the layout. Since the four pre-existing admin pages
  (`benutzer`/`drohnen`/`email`/`status`) had never needed their own guard — they relied entirely on that
  layout — each of them now has an explicit `if (!isSiteAdmin(user)) notFound()` of its own, a small but
  real security-hardening side effect of adding this module, not an incidental cleanup. `getAdminNavItems(user)` (new, `src/lib/admin/nav-items.ts`, mirrors `getNavItems` in the app-wide
  `lib/nav-items.ts`) replaces the previously-hardcoded `ITEMS` array in both `AdminSidebarNav` and
  `AdminMobileTabs` — at the time this module shipped, Benutzerverwaltung/Drohnengruppe/E-Mail/Status all
  stayed `isSiteAdmin`-only, Heimatfeuerwehr was the only one additionally shown to any
  `canAccessHeimatfeuerwehrAdmin`. Verified directly (not just type-checked): a synthetic Feuerwehr-only-admin
  `SessionUser` object run through `getAdminNavItems` returned **only** `['Heimatfeuerwehr']`, and
  `canManageHeimatfeuerwehrFor` correctly returned `false` for an org that admin didn't manage — confirming
  the scoping wasn't just theoretically correct but actually behaved as designed. **Benutzerverwaltung was
  opened up to Feuerwehr-Admins in a later round** (see "Benutzerverwaltung: Feuerwehr-Admin-Scoping" under
  the Benutzerverwaltung section below) — its own explicit gate changed from `isSiteAdmin` to a new
  `canAccessUserManagementAdmin`, and `getAdminNavItems` now shows it to any Feuerwehr-Admin too;
  Drohnengruppe/E-Mail/Status remain `isSiteAdmin`-only as described here.
- Editing Atemschutz status uses the same "auto-suggest but don't overwrite a manually-touched value" pattern
  as `event-form.tsx`'s Start→Ende sync: changing "Untersuchung am" pre-fills "Gültig bis" as +5 years, but
  only until the admin edits "Gültig bis" directly — after that, further "Untersuchung am" changes never
  clobber it again (`AtemschutzEditDialog`'s `gueltigBisTouchedRef`).

**Heimatfeuerwehr V3** — a follow-up expansion (Excel export/import, an expiry-warning email, booking
history, and vehicle deletion), all requested and scoped in separate rounds after the base module shipped.

- **Unified 3-state expiry status**: the original `isUntersuchungActive`/`isFinnentestActive` booleans were
  replaced by a single `getExpiryStatus(expiryDate: Date | null): 'aktiv' | 'laeuft_bald_ab' | 'abgelaufen' |
  'keine_angabe'` (`ATEMSCHUTZ_WARNING_DAYS = 30`) — both Untersuchung (passing `atemschutzGueltigBis`
  directly) and Finnentest (passing a computed `getFinnentestExpiryDate(atemschutzFinnentestAm)` = that date
  + `FINNENTEST_WINDOW_DAYS`) now go through the same function, so the "läuft bald ab" rule can't drift
  between the two. Both `/meine-feuerwehr` and `/admin/heimatfeuerwehr`'s badges show all three colors
  (green/amber/red) — no new report page, per the app owner's explicit choice, just a third badge state in
  the tables that already existed.
- **Sachbearbeiter-scoped warning email, not global**: unlike every other notification in this codebase
  (`notifySystemCheckResult`, `notifyDroneFlightCreated` — one global `AppSettings` recipient each),
  the Atemschutz warning's recipient is a **per-organization** contact:
  `Organization.atemschutzSachbearbeiterEmail` (nullable, edited via a small form directly on
  `/admin/heimatfeuerwehr`, `setAtemschutzSachbearbeiter` in that page's `actions.ts` — a plain
  `prisma.organization.update`, not routed through `lib/settings.ts`, since that file is only for the
  singleton `AppSettings` row). This was a deliberate, explicit choice by the app owner over a global address
  or "send to every Feuerwehr-Admin" — each Feuerwehr designates its own Atemschutz contact person, who may
  not be an app admin at all. `checkAndNotifyAtemschutzWarnungen()`
  (`lib/heimatfeuerwehr/notify-atemschutz-warnung.ts`) therefore loops every `FEUERWEHR` org with a
  configured address (silently skipping the rest), builds one email per org listing only members with a
  `laeuft_bald_ab` Untersuchung or Finnentest, and wraps each org's send in its **own** try/catch — one
  Feuerwehr's Mailjet failure must not block the others' emails. `/api/cron/atemschutz-warnung` (GET,
  `CRON_SECRET`-gated — `/api/cron` is already a public prefix in `middleware.ts`, no change needed there) +
  `docker/atemschutz-warnung-email.sh` (daily 08:00 Vienna, documented in `docker/README.md`) mirror
  `/api/cron/system-check`'s exact wrapper-script shape. Verified live: seeded a member with a
  `laeuft_bald_ab` Untersuchung and a configured Sachbearbeiter address, hit the cron route directly, and
  confirmed via server logs that it correctly identified the org and attempted the send — the send itself
  failed on a local-network TLS issue (this dev machine, unrelated to the code — the same failure would hit
  any of this app's other Mailjet calls tested the same way here) and was caught exactly as designed, with
  the route still returning success.
- **Excel export/import — Fuhrpark gets both, Atemschutz export-only**: `lib/heimatfeuerwehr/
  vehicle-excel-columns.ts` and `.../atemschutz-excel-columns.ts` mirror `lib/admin/user-excel-columns.ts`'s
  shape exactly (shared header/key/width list; the vehicle one also splits out `VEHICLE_IMPORT_COLUMN_KEYS`
  the same way `USER_IMPORT_COLUMN_KEYS` does, so a re-uploaded export works as an import template
  unmodified). Both export routes (`fuhrpark-export`, `atemschutz-export`) are `?org=<id>`-scoped and
  `canManageHeimatfeuerwehrFor`-checked, unlike `/admin/benutzer/export` which has no such scoping since
  users aren't per-org data in the same way. The Atemschutz export has **no import counterpart** — a
  deliberate choice, confirmed with the app owner: bulk-editing safety-critical medical/compliance data via
  spreadsheet upload was judged too risky, so that data stays editable only one member at a time through
  `AtemschutzEditDialog`. Fuhrpark import (`fuhrpark-import/actions.ts`) duplicate-detects by `kennzeichen`
  alone (already `@unique`, simpler than the User importer's composite `stbNr`+`homeOrganizationId` key) and
  targets whichever org is selected on the page (unlike User import, which reads the destination org from a
  column per row, since a vehicle export is already single-org-scoped).
- **Buchungshistorie**: `admin/heimatfeuerwehr/fahrzeug/[vehicleId]/page.tsx` (linked from each Fuhrpark row's
  new "Historie" action) shows **every** booking for that vehicle, past and future — `/meine-feuerwehr`
  deliberately only ever queries upcoming ones (`endsAt: { gte: now }`), so this is a genuinely separate,
  admin-only query, not a filter toggle on the same data. It also shows a simple utilization figure: total
  booked hours in the last 90 days (`endsAt - startsAt` summed across bookings in that window) — verified
  live against a real 3-hour booking.
- **Fahrzeug löschen, blocked by any booking**: `deleteVehicle` (new) proactively counts
  `prisma.vehicleBooking.count({ where: { vehicleId } })` and refuses with a friendly, count-specific message
  if it's non-zero — checked explicitly *before* attempting the delete, rather than catching Prisma's FK
  constraint error the way `deleteUser` does, since Vehicle→VehicleBooking is a single simple 1:n relation
  and a proactive check guarantees the friendly message every time. This protects the booking-history feature
  above: deleting a vehicle would otherwise cascade-delete (`onDelete: Cascade`) its entire history. Verified
  live with a real vehicle pair — one with a booking (blocked, exact count in the message) and one without
  (deleted successfully). The three former inline row actions (Bearbeiten/Aktivieren-Deaktivieren) plus the
  two new ones (Historie/Löschen) are now a `DropdownMenu` in `vehicle-row-actions.tsx`, 1:1 the
  `user-row-actions.tsx` composition pattern from the Benutzerverwaltung — "Bearbeiten" passes a
  `DropdownMenuItem` (with `onSelect={(e) => e.preventDefault()}`) straight in as `VehicleFormDialog`'s
  `trigger` prop rather than duplicating its edit form, the same trigger-survives-a-closing-menu technique
  already used there for the "Löschen" `AlertDialogTrigger`.

**Heimatfeuerwehr V4** — a follow-up round driven by direct user feedback on the shipped V3 module (a
screenshot of `/meine-feuerwehr` marking the Fuhrpark section for removal, plus a live-tested, confirmed
report that Feuerwehr-only admins couldn't see the "Verwaltung" nav entry at all).

- **Compact Fuhrpark widget**: `/meine-feuerwehr`'s Fuhrpark section no longer renders every vehicle as its
  own card with an embedded upcoming-bookings list — it's now a single native `<select>` of the home org's
  active vehicles plus an "Ausborgen" submit button, `<form action="/meine-feuerwehr/buchen" method="get">`.
  A plain GET form was chosen deliberately over a client-side `<select>`-driven link: it needs no JS at all
  (works identically in this session's documented non-hydrating browser-automation environment) and the
  browser's own querystring-building does exactly what a client `onChange` handler would otherwise need to
  do by hand. `/meine-feuerwehr/buchen` now accepts `searchParams: Promise<{ vehicleId?: string }>`,
  validates the incoming id against the actually-fetched vehicle list (an invalid/foreign id is silently
  ignored, not trusted), and passes it to `BookingForm` as a new optional `initialVehicleId` prop that only
  overrides the form's default vehicle selection — Datum/Start/Ende are unaffected.
- **Vehicle bookings sync into the main Kalender as protected events**: `Event.vehicleBookingId` (nullable,
  `@unique`, `onDelete: SetNull`) links an `Event` 1:1 to the `VehicleBooking` it represents — its mere
  presence is the "this event is booking-managed" marker, no separate boolean needed.
  `createVehicleBooking` (`meine-feuerwehr/actions.ts`) now also creates a plain `ALLGEMEIN`,
  non-section-wide `Event` (title `"Fahrzeug: {taktischeBezeichnung} ({Name})"`, in the booking's own
  Feuerwehr) tagged with that id; `cancelVehicleBooking` looks the linked `Event` up via
  `vehicleBookingId` and deletes it first (only `if` it still exists — an accepted edge case in case an
  `Event` was ever removed independently of its booking, e.g. via Prisma Studio) before deleting the
  booking itself. This was a deliberate product decision, not an incidental side effect: the user explicitly
  asked for bookings to show up as ordinary calendar entries rather than a separate widget.
  `cancelVehicleBooking` gained a second, optional `redirectTo = '/meine-feuerwehr'` parameter specifically
  so `/admin/heimatfeuerwehr`'s own "all bookings" section (below) could reuse this exact function without
  being redirected to the member overview page after deleting someone *else's* booking — it passes
  `` `/admin/heimatfeuerwehr?org=${selectedOrgId}` `` instead, preserving which Feuerwehr was selected.
- **Booking-managed events are protected from normal editing** — the user explicitly overrode the simpler
  alternative (leave them freely editable like any other event) in favor of this stricter behavior.
  `kalender/page.tsx`'s `editable` flag gains `&& !event.vehicleBookingId`, which — since that one computed
  value already drives both `EventListView`'s double-click-to-edit shortcut and the FullCalendar
  `eventClick` handler's edit-vs-view branch — suppresses the dead-end edit navigation from `/kalender`
  itself. The event detail page (`kalender/[eventId]/page.tsx`) has its own, separate "Bearbeiten" link that
  needs the identical `!event.vehicleBookingId` condition alongside its `canManageEventsFor` check — it isn't
  fed by `kalender/page.tsx`'s `editable` flag, so it doesn't inherit that guard for free and must repeat it.
  `/kalender/[eventId]/bearbeiten` additionally checks `event.vehicleBookingId` directly and, if set, renders
  a blocking message ("Dieser Termin gehört zu einer Fahrzeug-Buchung...") with a link back to
  "Meine Feuerwehr" instead of `EventForm`/the delete button — placed *after* the existing
  `canManageEventsFor` check, so a user without edit rights still sees the generic permission message first.
  `updateEvent`/`deleteEvent` (`kalender/actions.ts`) got the identical guard server-side, consistent with
  this codebase's "every Server Action re-checks its own permissions" rule — a direct action call can't
  bypass the page-level block. **Reversed since V4 shipped**: RSVP ("Zusage") was originally left
  intentionally open on booking-managed events (only editing/deleting the event itself was blocked) — the
  app owner later asked for this to change after seeing it live: a vehicle-booking entry has no real
  concept of "Zugesagt/Abgesagt/Unklar", so `/kalender/[eventId]/page.tsx` now hides both the "Meine
  Zusage" widget (`EventRsvpButtons`) and the "Teilnehmerliste" section entirely when
  `event.vehicleBookingId` is set — not just visually de-emphasized, the whole `<div>` block for each is
  conditionally omitted. The rest of the detail page (Zeit/Organisation/Ort/Beschreibung, the vehicle icon
  elsewhere in the app) is unaffected. `setRsvp`/`sendEventPushNow` themselves were not touched — this is a
  page-level display change only, not a new permission guard (nothing stops a booking event's RSVP from
  being set via a direct action call, but the UI never offers it, matching this event type's actual
  semantics rather than adding a redundant server-side block for a path nothing in the UI reaches).
  Vehicle-booking events still flow into the same per-organization `.ics` calendar feed as any other event,
  with no special exclusion — there was never a reason to treat them differently there.
- **Visible icon on booking-managed events**: a new, small, shared `VehicleBookingIcon`
  (`components/calendar/vehicle-booking-icon.tsx`, hand-rolled inline SVG car silhouette, matching this
  codebase's "no icon library" convention) renders next to the title at all three places events are ever
  displayed — the FullCalendar month-grid chip (`renderEventContent` in `calendar-view.tsx`), `EventListView`'s
  desktop table row, and its mobile card — all three reading from one new `CalendarEventInput.isVehicleBooking`
  boolean so the three views can't drift apart, the same principle already established for `RsvpBadge`.
- **Admin: all vehicle bookings for a Feuerwehr in one place**: a third section on `/admin/heimatfeuerwehr`
  (alongside Fuhrpark and Atemschutz, not a separate sub-page — matching this page's existing single-page,
  multi-section shape) lists every `VehicleBooking` for the selected org, past and future, with vehicle,
  formatted date range, borrower's name, a Kommend/Vergangen status badge, and a "Löschen" action that
  reuses `cancelVehicleBooking` directly (imported via `@/app/(app)/meine-feuerwehr/actions`, the same
  cross-route-group Server-Action-import pattern already used elsewhere in this codebase, e.g.
  `admin/benutzer/actions` from `user-form-sheet.tsx`) rather than duplicating it — Heimatfeuerwehr-admins
  already have the right permission via `canManageVehicleBooking` inside that same function.
- **Bugfix, confirmed via live testing with a real account**: `src/lib/nav-items.ts`'s `getNavItems()`
  previously gated the whole "Verwaltung" nav entry on `isSiteAdmin(user)` alone, even though
  `lib/admin/nav-items.ts`'s *internal* Verwaltung sidebar/tabs had already been made correctly
  permission-aware for Feuerwehr-only admins in an earlier round — meaning a Feuerwehr-only admin could
  never even discover `/admin/heimatfeuerwehr` existed, despite already being allowed to use it once there.
  Fixed to `if (isSiteAdmin(user)) push /admin/benutzer; else if (canAccessHeimatfeuerwehrAdmin(user)) push
  /admin/heimatfeuerwehr` — site admins keep landing on the Benutzerverwaltung as before, Feuerwehr-only
  admins now land directly on the one Verwaltung page they're actually allowed to see. Verified against
  three synthetic `SessionUser` shapes (site admin / Feuerwehr-only admin / neither), not just type-checked.
- Verified live end-to-end against a real seeded vehicle/booking: the compact widget renders and its
  "Ausborgen" link carries the vehicle id through to the booking form; a booking created directly (mirroring
  what `createVehicleBooking` produces) appears in `/kalender`'s list view with the vehicle icon; its edit
  page shows the blocking message; `/admin/heimatfeuerwehr`'s new section lists it correctly scoped to the
  selected Feuerwehr; and deleting it from there removes both the `VehicleBooking` and its linked `Event`
  while redirecting back to the admin page (not `/meine-feuerwehr`) with the selected org preserved.

### Fahrzeug-Reservierungen: Freigabe-Workflow per E-Mail

A follow-up request renamed the borrowing flow ("Fahrzeug ausborgen" → "Fahrzeug Reservierungen",
"Ausborgen" buttons → "Reservieren") and added an optional per-Feuerwehr approval step: if
`Organization.fahrzeugReservierungEmail` is set, a new reservation no longer creates its calendar
entry immediately - it waits for an explicit Genehmigen/Ablehnen decision emailed to that address.

- **`VehicleBookingStatus` enum** (`OFFEN`/`GENEHMIGT`/`ABGELEHNT`) + `VehicleBooking.status`
  (`@default(GENEHMIGT)` at the DB level, so pre-existing rows stay valid and behaviorally unchanged)
  + `VehicleBooking.approvalToken` (nullable, `@unique`, a **raw** capability token like
  `DashboardToken.token` - not hashed like `PasswordToken`, since this is a low-stakes one-time action
  link, not an auth credential). `createVehicleBooking` (`meine-feuerwehr/actions.ts`) branches on
  whether the vehicle's organization has `fahrzeugReservierungEmail` set: unset → **unchanged legacy
  behavior**, immediately `GENEHMIGT` + linked `Event` created, no email; set → the booking is created
  `OFFEN` with a fresh `approvalToken`, **no `Event` yet**, and an approval-request email goes out
  instead (see below). This means an `OFFEN` (or `ABGELEHNT`) reservation simply has no `Event` row at
  all - it's automatically invisible everywhere the Kalender/Dashboard already only ever query `Event`,
  no extra filtering needed there.
- **Overlap check still blocks on `OFFEN`, only frees up on `ABGELEHNT`**:
  `findOverlappingBooking` (`lib/heimatfeuerwehr/vehicle-availability.ts`) gained `status: { not:
  'ABGELEHNT' }` - a still-pending reservation must keep blocking the same time slot for other members,
  or two people could get their overlapping requests approved independently before either approval
  resolves the conflict. Only a rejected reservation frees the vehicle back up. Verified directly (not
  just read for correctness): a real overlap query against a `GENEHMIGT` slot found it, the same query
  against an `ABGELEHNT` slot at a different time found nothing.
- **Two public, session-less routes** — `/fahrzeug-reservierung/genehmigen/[token]` and
  `/fahrzeug-reservierung/ablehnen/[token]` (new top-level segment, added to `middleware.ts`'s
  `PUBLIC_PATH_PREFIXES`, same reasoning as `/drohnen-schnell`/`/dashboard`: no session exists when a
  clicked email link opens on any device) - both render via one shared server component,
  `booking-decision-view.tsx`, parameterized by `mode`. **One click on the email link is enough** - the
  page's own GET request performs the Genehmigen/Ablehnen decision directly during render (no
  intermediate "Ja, bestätigen"-button/second click), by calling `decideVehicleBooking(token, decision)`
  (`lib/heimatfeuerwehr/vehicle-booking-decision.ts`) straight from `BookingDecisionView`'s server
  component body and rendering whatever `VehicleBookingDecisionOutcome` it returns
  (`invalid`/`already_decided`/`decided`, a discriminated union) - there is no form and no button on this
  page at all, only the resulting confirmation text. This is a **deliberate, explicit departure** from
  the "explicit click required, not auto-consumed on GET" pattern used everywhere else in this codebase
  for one-time links (`/login/token/[token]`, activation, password reset) - see the long comment on
  `decideVehicleBooking()` for the accepted tradeoff: an email link-scanner (Microsoft Safe Links,
  Mimecast, etc.) that auto-visits links could in theory trigger the decision itself before a human ever
  opens it. Judged acceptable here because this is a low-stakes internal approval action, not a password
  reset, and the requester explicitly asked for a single click to suffice.
  `decideVehicleBooking` is a plain, non-`'use server'` lib function (not a Server Action) precisely so
  it can be called directly from render - Server Actions are POST-triggered and would have needed a
  form/button, defeating the point. `approveVehicleBooking`/`rejectVehicleBooking` no longer exist; the
  whole decision (atomic status flip, conditional `Event` creation, result email) lives in this one
  function, called identically by both routes via the shared view component. **`revalidatePath()` is
  deliberately NOT called from `decideVehicleBooking`** - Next.js forbids calling it during a Server
  Component's render phase (`"used ... during render which is unsupported"`, a real crash hit and fixed
  while building this: the DB mutation had already committed successfully before the crash, confirmed via
  direct `psql` inspection, so only the trailing revalidation calls were the problem, not the core logic).
  Not needed anyway: `/meine-feuerwehr`, `/kalender`, and `/admin/heimatfeuerwehr` all render dynamically
  from the DB on every real navigation (fresh tab, external link, hard reload) - only an already-open,
  client-router-cached view could stay briefly stale until its own next load. A booking that's no longer
  `OFFEN` (already decided, or an invalid token) returns `already_decided`/`invalid` instead of
  re-processing - clicking a link twice, or the "other" link after a decision was already made, is
  harmless and shows the already-reached status rather than an error.
- **`lib/heimatfeuerwehr/notify-vehicle-booking.ts`**: `sendVehicleBookingApprovalRequest()` (to the
  configured Freigabe-Adresse, two literal `<a>` buttons styled inline, labelled exactly `GENEHMIGT` /
  `NICHT GENEHMIGT` per the request) and `sendVehicleBookingDecisionEmail()` (to the requester, **Cc**
  the Freigabe-Adresse so it also sees the outcome) - `sendEmail()` (`lib/email/mailjet.ts`) gained an
  optional `cc?: string[]` param for this, the first caller to need Cc at all. Both email sends are
  wrapped in try/catch at the call site (same "a Mailjet outage must never block the actual state
  change" precedent as `notify-flight-created.ts`) - the reservation itself, and the approve/reject
  decision, always succeed even if the email fails to send.
- **UI renames**: the Schnellzugriff-Kachel and `/meine-feuerwehr/buchen` heading read "Fahrzeug
  Reservierungen"; every "Ausborgen"/"Fahrzeug ausborgen" submit button reads "Reservieren"; "Meine
  Buchungen" → "Meine Reservierungen" (now also showing a status badge per row, and hiding the
  "Stornieren" button for `ABGELEHNT` rows - nothing left to cancel); the admin table and the
  per-vehicle history page read "Fahrzeug-Reservierungen"/"Reservierungshistorie" with "Reserviert von"
  instead of "Gebucht von", plus a real status badge (`Offen`/`Genehmigt`/`Abgelehnt`) alongside the
  existing Kommend/Vergangen distinction (shown together as e.g. "Genehmigt" + a small "Vergangen"
  label, only for already-`GENEHMIGT` rows in the past). The Kalender module's own edit-blocked
  messages ("Dieser Termin gehört zu einer Fahrzeug-Buchung...") and the shared `VehicleBookingIcon`'s
  `aria-label` were updated to "Fahrzeug-Reservierung" for consistency, since they describe the exact
  same underlying concept. `Vehicle`/`VehicleBooking` themselves keep their original Prisma model names
  unchanged - this was a user-facing copy change only, not a schema/identifier rename, to avoid an
  unnecessary migration and touching far more files for zero user-visible benefit.
- **Verified end-to-end live** (not just type-checked): inserted two real `OFFEN` `VehicleBooking` rows
  with known tokens, opened both decision pages in the actual browser, and used a real `computer` click
  (not a simulated call) on each - the genehmigen click flipped status to `GENEHMIGT` and created the
  correctly-titled linked `Event`; the ablehnen click flipped status to `ABGELEHNT` and created no
  `Event`. Both pages then correctly showed "bereits entschieden" with the right status label on reload.
  The overlap-exclusion query was verified directly against this same test data. Test rows cleaned up
  afterward. Email delivery itself was not verified live (Mailjet isn't configured in this dev
  environment) - the send call sites are try/catch-wrapped for exactly this kind of failure, and the
  booking/decision logic was confirmed correct independent of whether the email actually goes out.
- **Bugfix history (real user report: "E-Mail wird immer doppelt geschickt - sowohl bei Genehmigt als
  auch bei Abgelehnt")**: the original two-step design (a confirm page with a "Ja, bestätigen"-button
  Server Action) read the booking (`status !== 'OFFEN'` check) and wrote the new status as two separate
  steps - a doubled tap on the confirm button could pass the read-check twice before either write landed,
  sending two result emails. A first fix applied the TOCTOU guard below to those Server Actions, but the
  user reported the duplicate still happened - at which point the user separately asked for the two-step
  design to become one-click (see above), which removed the vulnerable confirm-button step entirely
  rather than patching it further. The atomic guard itself carried over unchanged into
  `decideVehicleBooking`, the exact same pattern as `consumeToken()` (`lib/auth/tokens.ts`) already
  established for one-time tokens: `prisma.vehicleBooking.updateMany({ where: { approvalToken, status:
  'OFFEN' }, data: { status: decision } })`, checking `claimed.count === 0` (already decided/invalid/lost
  the race) before doing anything further - only the winning call creates the `Event`/sends the result
  email. **Re-verified directly against the current `decideVehicleBooking` function** (not just the
  removed Server Actions the original fix targeted): firing two `decideVehicleBooking(token, 'GENEHMIGT')`
  calls at the identical row via `Promise.all` resolves to exactly one `{kind: 'decided'}` and one
  `{kind: 'already_decided'}`, with exactly one linked `Event` row created - confirming the guard holds
  in the new one-click code path too.
- **Ablehnen-Grund (follow-up)**: Ablehnen alone got a deliberate, partial reversal of the one-click
  design above - a request to let the Fahrzeug-Admin explain *why* a reservation can't be granted.
  `VehicleBooking.rejectionReason` (nullable `String`, migration `20260815090000_vehicle_booking_
  rejection_reason`) stores it, set only on `ABGELEHNT` (always `null` on `GENEHMIGT`).
  `previewVehicleBookingRejection(token)` (`vehicle-booking-decision.ts`) is a new, read-only sibling of
  `decideVehicleBooking()` - it loads the booking and returns `invalid`/`already_decided` (unchanged
  from before) or a new `pending` case (booking still `OFFEN`) without mutating anything.
  `booking-decision-view.tsx`'s ablehnen branch now calls this preview first: `pending` renders a plain
  page-level form (a `<textarea name="reason">`, optional, 500-char capped both client-side
  `maxLength` and server-side `.slice()`) instead of immediately deciding; `invalid`/`already_decided`
  render the exact same result view Genehmigen already used (a small `renderOutcome()` helper shared by
  both branches). Submitting posts to a new Server Action, `submitRejection` (`app/fahrzeug-
  reservierung/ablehnen/[token]/actions.ts`), which calls `decideVehicleBooking(token, 'ABGELEHNT',
  reason)` (now takes an optional third parameter) and then `redirect()`s back to the same ablehnen
  URL - the reload shows the `already_decided` outcome with the stored reason. Genehmigen is
  completely unaffected: it still calls `decideVehicleBooking(token, 'GENEHMIGT')` directly from
  render, no dialog, one click. The reason is surfaced to the person who reaches it: in
  `sendVehicleBookingDecisionEmail`'s result mail (a `Grund: ...` line, ABGELEHNT-only), on
  `/meine-feuerwehr`'s "Meine Reservierungen" (under the status badge), and on `/admin/
  heimatfeuerwehr`'s Fahrzeug-Reservierungen table (under the status cell) - so it isn't write-only,
  visible only in an email that could get lost. Verified live end-to-end: submitted a real rejection
  through the actual form (not a scripted call), confirmed via direct DB read that `status`/
  `rejectionReason` landed correctly and zero `Event` rows were created, and confirmed the reason
  renders correctly on both the reload confirmation page and `/meine-feuerwehr`; Genehmigen's one-click
  path re-tested unchanged in the same session.
- **E-Mail-Signatur entfernt (follow-up)**: both vehicle-booking emails
  (`sendVehicleBookingApprovalRequest`/`sendVehicleBookingDecisionEmail`, both text and HTML parts)
  dropped their trailing "Abschnittsfeuerwehrkommando Purkersdorf" line at the app owner's explicit
  request - scoped to just these two templates, not the app-wide email sign-off convention described
  under "Email" below (those templates are untouched).

### Startbildschirm & mobile Navigation (Startbildschirm-Brief.md)

A follow-up mobile-only rework (imported via the same Claude Design `DesignSync`-MCP flow as the earlier
Benutzerverwaltung/Dashboard briefs): `/meine-feuerwehr` becomes the post-login landing page and a real
"does anything need my attention" dashboard, and the mobile bottom nav shrinks to a fixed 3-tab bar with the
home org's crest as the center "home" button. Scoped to `< 640px` (this app's only breakpoint, `sm:` - the
brief itself said "< 768px" but that's treated the same "approximate figure, not a new breakpoint" way
Kalender V3 already established); desktop is untouched except where a server-side redirect target had no
way to vary by viewport (see "Login-Redirect" below).

- **Post-login landing page**: all six hardcoded `/kalender` redirect targets (`login/actions.ts` ×2,
  `login/page.tsx` ×2, `aktivieren/[token]/actions.ts`, `passwort-zuruecksetzen/[token]/actions.ts`) plus
  the root `src/app/page.tsx` and the email-token "Anmeldung erfolgreich" link changed to `/meine-feuerwehr`.
  This is a **universal** change (desktop lands there too) since a Server Action can't branch a redirect by
  viewport width - there is no separate "old desktop /meine-feuerwehr" preserved; the new dashboard content
  below renders at every width (it degrades fine into the app's usual `max-w-5xl` column), only the
  nav/header work described next is genuinely mobile-only.
- **"Zu erledigen" / "Als Nächstes"** (`src/components/home/home-todo-list.tsx`, `HomeTodoList`, a Client
  Component): three todo sources, exactly as the brief's own table specifies - (1) an own-org-or-abschnittsweit
  event within the next 14 days with no `TerminZusage` row yet ("Offene Rückmeldung"), (2) Atemschutz
  Untersuchung/Finnentest expiring within a **60-day** window (a new, separate, more lenient threshold than
  the existing `ATEMSCHUTZ_WARNING_DAYS = 30` that drives the amber badges everywhere else in
  Heimatfeuerwehr - computed inline in `meine-feuerwehr/page.tsx`'s `buildAtemschutzTodo`, deliberately not
  folded into `atemschutz-status.ts`'s shared 30-day constant), (3) the 90-Tage-Regel not yet met for a
  Drohnengruppe member (reusing `getNinetyDayCutoff`/`meetsNinetyDayRule` unchanged). If none apply, the
  whole "Zu erledigen" block is omitted entirely (no placeholder) and the page starts at "Als Nächstes" -
  verified live against a freshly-reseeded dev DB with zero events/flights.
  - **Inline Zusagen/Absagen, no page reload**: the RSVP-type todo card calls the existing `setRsvp` Server
    Action directly (no note field, no "Unklar" - just the two buttons the brief's mockup shows, 44px each,
    1:1 grid) and **optimistically** moves the card into "Als Nächstes" the instant a button is tapped;
    `HomeTodoList` keeps a local `responded` map that overrides the server-provided event's status purely
    client-side, merges it back into the upcoming pool (re-sorted by date, sliced to 2), and rolls the
    override back out + shows a `sonner` toast if `setRsvp` returns an error. The server only ever sends the
    RSVP-eligible events already split into `rsvpTodos` (needs a response) vs. `upcomingPool` (top-4 buffer,
    not just top-2, so a moved card always has enough real data to merge against) - a todo event never
    appears in both arrays from the server, only the client's optimistic override can move one across.
  - **Kommandant-Variante**: for any candidate event whose organization the viewer manages
    (`canManageEventsFor`), the card shows the team's RSVP tally (`{n} zugesagt · {n} offen`, "offen" = active
    home-org member count minus zugesagt, not tracking Abgesagt/Unklar separately - matches the brief
    mockup's own two-figure "14 zugesagt · 9 offen") plus a "Details" link, instead of the Zusagen/Absagen
    buttons - applies uniformly whether the card would otherwise be in "Zu erledigen" or "Als Nächstes",
    since the brief's own wording ("die Terminkarte...statt der eigenen Zu-/Absage-Buttons") reads as one
    shared card variant, not two different rules for the two sections.
- **Schnellzugriffe**: two link-tiles, "Fahrzeug ausborgen" (→ `/meine-feuerwehr/buchen`, status line "N von
  M heute frei" from a single batched `VehicleBooking` query against today's date range - no per-vehicle
  N+1) and, only for Drohnengruppe members, "Flug registrieren" (→ `/drohnen/neu`, status either "90 Tage
  erfüllt" or "N von 3 Flügen"). One tile only (no empty second grid cell) for non-drone members.
- **"Stand der Wehr"**: gated on `canManageHeimatfeuerwehrFor(user, user.homeOrganizationId)` specifically -
  i.e. an admin (site or Feuerwehr) of their **own** home org, not any org they happen to administer. Shows
  active member count, an Atemschutz-expiring count (reusing the existing 30-day `getExpiryStatus` - the
  same figure the Heimatfeuerwehr admin table's amber badges already use, not a new threshold), and a
  Fuhrpark line (vehicles booked today / bookings this calendar month) linking to `/admin/heimatfeuerwehr`.
  Absent entirely (not shown-but-empty) for a plain member.
- **Wappen (Organization crest)**: new nullable `Organization.wappenImageData`/`wappenImageMimeType`
  (`Bytes`/`String`, Bytes-in-Postgres like `DroneDocument`/`FacebookPostImage` - a handful of small logo
  images, no reason for a Docker volume), uploaded per-Feuerwehr on `/admin/heimatfeuerwehr` (new
  "Wappen (Startbildschirm)" card, `WappenUploadForm` + `setOrganizationWappen`/`removeOrganizationWappen` in
  that page's `actions.ts`, same upload-Server-Action shape as `admin/drohnen`'s PDF upload). Served via a
  new session-gated (not in `middleware.ts`'s public prefixes, but no extra permission check beyond being
  logged in - a crest is not sensitive) `GET /api/organization/[organizationId]/wappen` route, 404 if unset.
  `(app)/layout.tsx`'s `homeOrganization` query was narrowed to an explicit `select` (previously a
  select-less `findUnique`) specifically so the potentially-large `wappenImageData` blob is never pulled
  into every single page navigation just to read `wappenImageMimeType`'s presence. No wappen set → the
  mobile tab bar's center button shows a neutral hand-rolled fallback shield icon
  (`components/layout/wappen-fallback-icon.tsx`) - never another Feuerwehr's crest, never the blanket
  district-wide wappen file. As of 2026-08-20, login page, desktop header, dashboard kiosk, and
  drohnen-schnell all use the new `/wappen-bfkdo.png` (the old `/wappen-afkdo.png` is no longer referenced
  anywhere in `src/`, but stays on disk since nothing requires deleting it) - this per-org crest is
  additive, not a replacement of the district mark.
- **Mobile tab bar rebuilt from scratch** (`components/layout/mobile-tab-bar.tsx`): no longer built from the
  shared, permission-driven `getNavItems()`/`nav-items.ts` list that desktop `<Nav>` still uses unchanged -
  a hardcoded, fixed 3-column grid (`grid-cols-3`, `h-[86px]`) instead: Kalender (left) · Wappen-Home (center,
  a 46px white circle floated `-mt-4` above the bar, `Meine Feuerwehr` label, links to `/meine-feuerwehr`) ·
  Drohnengruppe (right, only rendered when `canViewDroneModule`, otherwise an empty `aria-hidden` cell so the
  center button stays visually centered rather than the grid collapsing to 2 columns). News and Verwaltung -
  previously riding along in the same permission-driven list on mobile too - needed new homes since the
  brief's tab bar has no room for them: Verwaltung moved into a new header pill (see below); News moved into
  `ProfileMenu`'s dropdown as a plain `sm:hidden` link (`canSendAnyNews`-gated, new prop) alongside the
  existing mobile-only Abmelden - desktop keeps reaching both exactly as before, through the unchanged `<Nav>`.
- **Header restructure** (`(app)/layout.tsx`): the mobile-only small AFKDO crest `<img>` that used to sit at
  the far left is gone entirely (the brief: "Das Wappen ist hier nicht mehr - es sitzt in der Tab-Bar").
  `MobileHeaderTitleSlot`'s `fallback` prop is now a per-user computed label - `"Feuerwehr {shortName}"` for
  a Feuerwehr home org (e.g. "Feuerwehr Wolfsgraben", never the org's full `name` with "Freiwillige
  Feuerwehr..."), or just the shortName/name as-is for an AFKDO home org (a "Feuerwehr AFKDO Purkersdorf"
  label would have read wrong) - the slot's own crossfade-with-the-page's-CollapsingPageTitle mechanism
  (Kalender V3) is completely unchanged, only what it shows before a page pushes its own title. Bumped that
  slot's font size from `text-sm` (14px) to the brief's explicit `text-[17px]` - a shared value, so this
  also affects the crossfaded page-title text, not just the fallback. A new `Verwaltung` pill
  (`sm:hidden`, 30px tall, `border-[#4a4a4e]`, links to `/admin/benutzer` for a site admin or
  `/admin/heimatfeuerwehr` otherwise - same target resolution `getNavItems()` already used) sits in the
  header's right-hand cluster, gated on `canAccessHeimatfeuerwehrAdmin(user)`, matching the brief's own
  "sichtbar nur wenn Adminrechte, serverseitig geprüft" requirement exactly (no client-side hiding).
- **Verified live** against the running dev server (not just `tsc`/`build`, which were also both clean):
  `/meine-feuerwehr` renders the full greeting/todo/quick-access/Stand-der-Wehr stack correctly for the
  seeded site admin (whose home org is the AFKDO, hence the un-prefixed header label and the empty third tab
  slot since that account isn't a Drohnengruppe member); the 3-column tab bar's exact `grid-template-columns`
  (three equal 125px columns at 375px width), `86px` height, and `46px`/`-16px margin-top` center circle were
  all confirmed via `getComputedStyle`; the new wappen route was round-tripped end-to-end (upload a real PNG
  directly into `Organization.wappenImageData` via `psql`, fetch `/api/organization/.../wappen` from the
  live authenticated tab and confirm 200 + correct `Content-Type` + correct byte count, then confirm the
  admin page's "Entfernen" button appears, then clean the test row back to `NULL`); and the responsive
  cross-over itself was confirmed both directions via `getBoundingClientRect()` (not `getComputedStyle`
  alone, which - as a bare check - doesn't reflect an invisible ancestor collapsing a `display:flex` child to
  zero width) at 375px vs. 1280px: the new header pill and mobile tab bar render at mobile width and
  collapse to zero width at desktop width, while desktop `<Nav>`'s own separate "Verwaltung" link and the
  footer do the exact opposite. What remains unverifiable for the same already-documented, harness-wide
  reason as every earlier Verwaltung/Kalender mobile pass: the RSVP buttons' actual optimistic-move-on-click
  interaction, the wappen upload form's real file-input submit, and the ProfileMenu dropdown's News link
  (React state never attaches in this browser-automation session, so `useState`-gated JSX - the dropdown's
  `{open && (...)}`, `HomeTodoList`'s `responded` map - never mounts in a static DOM snapshot regardless of
  the underlying logic's correctness).
- **Bugfix (real user report, screenshot showed "Zusagen"/"Absagen" on a `Fahrzeug: MTF-BUS1 (...)`
  card)**: the initial version didn't carry the Kalender module's own "vehicle-booking events have no
  RSVP concept" rule into this new "Zu erledigen" query at all, so any event created via
  `createVehicleBooking` (`Event.vehicleBookingId` set) that fell inside the 14-day window and had no
  `TerminZusage` row (which, correctly, it never does - nobody RSVPs to a booking) was misclassified as an
  "Offene Rückmeldung" needing a response, same as a real Übung/Einsatz. `HomeEventCardData` gained an
  `isVehicleBooking` flag; `meine-feuerwehr/page.tsx` now excludes such events from `rsvpTodos` entirely
  (they still show up in "Als Nächstes" as read-only entries, since a vehicle booking is still a real
  future occupation of the calendar - just never as a to-do) and skips the Kommandant tally computation for
  them too (same reasoning: no Zusagen to tally). `HomeTodoList`'s "Als Nächstes" row reuses the existing,
  already-shared `VehicleBookingIcon` (`components/calendar/vehicle-booking-icon.tsx`) next to the title for
  such entries, the same icon the Kalender grid/list/mobile-card already show - so this is now consistent
  everywhere the app renders a vehicle-booking event, not a fourth, diverging spot. Verified live by
  reproducing the exact reported scenario (a `Vehicle`/`VehicleBooking`/linked `Event` inserted directly via
  `psql`, 3 days out) alongside a plain event with no RSVP 5 days out: after the fix, "Zu erledigen" shows a
  count of 1 (the plain event only, correctly rendered with the Kommandant tally variant since the test
  account manages that org) and the vehicle-booking event appears only in "Als Nächstes" with the car icon
  and a plain chevron - no Zusagen/Absagen anywhere for it. Test rows cleaned up afterward.

### Funktionsschalter je Heimatfeuerwehr (Atemschutz/Facebook)

Two admin-facing on/off switches, one per Feuerwehr, so a Feuerwehr that doesn't use a given module can hide
it instead of showing an empty/unused section to its members. Full design rationale in
`docs/superpowers/specs/2026-08-09-funktionsschalter-design.md`.

- **Two flags on `Organization`**: `featureAtemschutz` (`@default(true)`) and `featureFacebook`
  (`@default(false)` at the column level, see the migration backfill below) plus `featuresUpdatedAt`/
  `featuresUpdatedByName` (a plain name snapshot, no FK to `User` — same "console.log instead of an audit
  column" reasoning already used for the admin-triggered password-reset trigger, see
  Benutzerverwaltung-Brief.md above). `src/lib/heimatfeuerwehr/features.ts`'s `getOrganizationFeatures()` is
  a small helper for call sites (Server Actions, cron loops) that don't already have the organization row
  loaded with these two columns `select`ed.
- **Disabling only hides, never deletes**: turning Atemschutz off removes the entire Atemschutz card from
  both `/meine-feuerwehr` and `/admin/heimatfeuerwehr` (Sachbearbeiter form, table, Excel export link) and
  makes `atemschutz-export` return `notFound()` — but every stored Untersuchung/Finnentest date, the
  Sachbearbeiter email, and the `istAtemschutzgeraeteTraeger` flag on `User` are completely untouched and
  reappear exactly as they were the moment the module is switched back on. The daily Atemschutz-warning cron
  (`checkAndNotifyAtemschutzWarnungen`) also skips a Feuerwehr with the flag off, by adding
  `featureAtemschutz: true` to its existing organization query — no separate pause flag needed. Turning
  Facebook off hides the dashboard's Facebook widget (see grid reflow below) and pauses the hourly
  Facebook-fetch cron for that org (`featureFacebook: true` added to its existing query filter) — the
  cached posts/images and the stored Page-ID/Access-Token are left alone, so re-enabling picks up exactly
  where it left off.
- **The Ein→Aus toggle asks for confirmation, Aus→Ein doesn't** — a shadcn `AlertDialog` naming the affected
  member count and stating explicitly that existing data is preserved, matching this codebase's existing
  destructive-toggle confirmation pattern elsewhere in Verwaltung.
- **Migration backfill is token-based, not a blanket default**: `featureFacebook` defaults to `false` for
  new rows, but the migration itself runs an `UPDATE` that sets it `true` for any organization that already
  had both `facebookPageId` AND `facebookPageAccessToken` set at migration time (in practice: Wolfsgraben,
  the one Feuerwehr with a live Facebook integration already running) — so shipping this feature doesn't
  silently turn off a dashboard widget that was already working in production.
- **Two deliberate deviations from the original design brief** (see the spec file's own "Abweichungen vom
  Brief" section for the full rationale — summarized here, not repeated):
  1. **Facebook credential entry stays in the admin UI.** The brief wanted Page-ID/Access-Token config
     removed from the web app entirely ("gehört in die Serverkonfiguration, vom Systembetreuer gesetzt").
     That would have broken this app's existing, deliberate architecture — every Feuerwehr configures its
     own Facebook page itself via `/admin/heimatfeuerwehr`, nothing is server-hardcoded. `setOrganizationFeature`
     only gates activation/visibility; the pre-existing `DashboardFacebookConfigForm` for entering the
     credentials themselves is unchanged.
  2. **Facebook's post-migration default is token-dependent, not unconditionally off** (see the backfill
     bullet above) — the brief assumed every Feuerwehr would start with Facebook off; doing that literally
     would have interrupted Wolfsgraben's already-running integration for no reason.
- **Real bug caught during this feature's own review, not in the shipped version**: the initial
  implementation of the dashboard's Facebook-off grid reflow (`Feature: Dashboard-Grid ohne Facebook`,
  commit `0f1b5e9`) dropped the WASTL card from the grid entirely when Facebook *was* active — i.e. the
  reflow logic correctly built a "Facebook off" layout (WASTL fills column 3, QR moves to column 2) but the
  companion "Facebook on" layout it was diffed against had silently lost the WASTL card somewhere in the
  same edit, a plan-authoring bug rather than a runtime one. Caught by task review before merge, fixed in
  `Fix: WASTL-Karte fehlte in Spalte 2 wenn Facebook aktiv` (commit `b9d982f`), which restores the
  WASTL card into column 2 below the vehicle table for the Facebook-on layout. Both states were re-verified
  live afterward (see Task 7 verification below) — column 2 shows Fahrzeuge+WASTL and column 3 shows
  Facebook+QR when the flag is on; column 2 shows Fahrzeuge+QR and column 3 shows WASTL alone at full height
  when it's off, with the third grid column's `clamp()` width itself changing (~508px on, ~700px off, at
  1920px) and the footer's source list dropping ", Facebook" when off.
- **Verified end-to-end (Task 7)**: `tsc --noEmit` and `next build` both clean. A standalone script
  confirmed the toggle round-trips through `getOrganizationFeatures()` in both directions and that
  `setOrganizationFeature`'s Facebook-without-token guard logic correctly blocks enabling when no
  `facebookPageId`/`facebookPageAccessToken` is stored. Live in the browser as the seeded site admin:
  toggling `featureAtemschutz` off for a Feuerwehr removed its Atemschutz card from `/admin/heimatfeuerwehr`
  and made `atemschutz-export?org=<id>` return a real 404 in that same authenticated tab; toggling it back
  on restored the card. The dashboard grid was checked at 1920×1080 with a temporary `DashboardToken`: with
  `featureFacebook: true` (and a placeholder `facebookPageId`, since no organization in this dev database
  has real Facebook credentials configured) the grid rendered three columns of ~632/632/518px with WASTL
  correctly present in column 2 and Facebook+QR in column 3; with the flag `false` the grid reflowed to
  ~540/540/701px with QR moved into column 2 below the vehicle table and WASTL alone filling column 3, no
  horizontal scrollbar in either state, and the "Ausgeborgt von" table column fully inside its (now
  narrower) column-2 card. All test data (the temporary token, the placeholder Facebook fields, both
  toggled flags) was restored/deleted afterward. The interactive click-to-toggle switch itself could not be
  exercised via simulated mouse clicks in this browser-automation session — consistent with the
  extensively-documented, harness-wide non-hydration limitation elsewhere in this file — but the equivalent
  end state was reached and verified through the real Auth.js credentials POST (not a fabricated session)
  followed by direct DB flag flips, which the Server Components then render exactly as a real click would
  have produced. A dev-server port mismatch was also hit and fixed along the way: a stray `npm run dev` from
  the sibling non-worktree checkout was squatting on port 3000 from an earlier session, serving the main
  checkout instead of this worktree — it was killed and restarted from the correct worktree directory before
  any of the above checks were meaningful.

