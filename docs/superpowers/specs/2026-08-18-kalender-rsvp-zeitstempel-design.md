# Kalender: Zeitstempel bei Zu-/Absagen — Design

GitHub Issue: https://github.com/ff3012/app-177/issues/16

**Goal:** Show, on the Kalender-Termindetailseite, when a member last responded to a RSVP
("Zusage") — both for their own response ("Meine Zusage") and for every entry in the
Teilnehmerliste — in the format `DD-MM-YYYY HH:MM`.

**Architecture:** Pure display addition. `TerminZusage` already carries `createdAt`/`updatedAt`
(the latter `@updatedAt`, auto-bumped by Prisma on every RSVP change), and the detail page already
fetches full `TerminZusage` rows with no field-level `select`. No schema change, no migration, no
new Server Action. The only new code is a small Vienna-timezone-safe date formatter and its use in
two spots already rendered by `src/app/(app)/kalender/[eventId]/page.tsx`.

**Tech Stack:** Next.js Server Component (existing page), a small addition to the existing
`src/lib/format.ts` helper module. No client-side changes — `EventRsvpButtons` (the RSVP
input widget) is untouched.

## Global Constraints

- Timestamp format is exactly `DD-MM-YYYY HH:MM` (dash-separated, day first, 24-hour time,
  zero-padded), computed in `Europe/Vienna` time regardless of server OS timezone.
- Scope is limited to the Termindetailseite (`kalender/[eventId]/page.tsx`): the Teilnehmerliste
  and the "Meine Zusage" section. The compact inline Zusage/Absage buttons elsewhere
  (`event-list-view.tsx`'s `DesktopEventRow`, `home-todo-list.tsx`'s Startbildschirm-Todo) are
  explicitly out of scope — confirmed with the user.
- No new permission check: the Teilnehmerliste's audience is unchanged — everyone `canViewEvent`
  already allows onto the page could already see every participant's name, status, and note.
  Exactly when someone responded is new information this feature surfaces (it wasn't shown
  anywhere before), but it's benign event-participation metadata shown to the same existing
  audience, not a new class of exposure to a new audience — so no new permission check is needed.

## Label logic (shared by both display spots)

Compare `createdAt.getTime()` and `updatedAt.getTime()` on the `TerminZusage` row:

- **Equal** (never changed since the first response): `"{StatusLabel} am DD-MM-YYYY HH:MM"`,
  e.g. `Zugesagt am 18-08-2026 14:32`, using `createdAt`.
- **Different** (the row was saved again since the first response — a real status change, but also
  a note-only edit or re-submitting the same status, since `updatedAt` is `@updatedAt`-managed and
  bumps on every write): `"Zuletzt geändert am DD-MM-YYYY HH:MM"`, using `updatedAt`. The label
  says "geändert" (changed) because the row was touched again, not because the *status* necessarily
  differs from before - this is a deliberate simplification (tracking a separate "status last
  changed" timestamp would need a schema change) and matches the common case well enough for this
  feature's purpose.

This matches the issue's explicit wording ("Zeitstempel bei Zu- bzw. Absagen ... bzw letzte
Änderung anzeigen wenn von Zugesagt auf Abgesagt Wechsel").

## New formatter — `src/lib/format.ts`

```ts
/** Formats a Date as "DD-MM-YYYY HH:MM" in Europe/Vienna time - used for RSVP-Zeitstempel
 * (Kalender-Termindetailseite, GitHub issue #16). No built-in Intl locale produces this exact
 * dash-separated, day-first order, so the formatted parts are read individually and reassembled.
 * `hourCycle: 'h23'` (not `hour12: false`) avoids a known Node/ICU quirk that renders midnight
 * as "24:00" instead of "00:00" under hour12: false. */
export function formatDateTimeDDMMYYYY(date: Date): string {
  const parts = new Intl.DateTimeFormat('de-AT', {
    timeZone: VIENNA_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
}
```

Placed in `format.ts` (not a new file) to reuse the existing private `VIENNA_TIME_ZONE` constant
and match this file's established convention of small, focused, exported date-formatting helpers.

## Page changes — `src/app/(app)/kalender/[eventId]/page.tsx`

A new page-local helper (co-located with the page's existing `STATUS_LABEL`/`formatEventTime`
helpers, matching this file's established pattern of keeping single-use formatting logic local
rather than exported):

```ts
function formatRsvpTimestampLabel(zusage: { status: RsvpStatusOption; createdAt: Date; updatedAt: Date }): string {
  const changed = zusage.createdAt.getTime() !== zusage.updatedAt.getTime();
  return changed
    ? `Zuletzt geändert am ${formatDateTimeDDMMYYYY(zusage.updatedAt)}`
    : `${STATUS_LABEL[zusage.status]} am ${formatDateTimeDDMMYYYY(zusage.createdAt)}`;
}
```

**Meine Zusage section** (currently lines 117–127): render the label directly below the "Meine
Zusage" heading, above `<EventRsvpButtons>` (which is left untouched — no new props), only when
`ownZusage` exists:

```tsx
<div className="rounded-lg bg-white p-4 shadow-sm">
  <h2 className="mb-2 text-sm font-semibold text-neutral-900">Meine Zusage</h2>
  {ownZusage && <p className="mb-2 text-xs text-neutral-500">{formatRsvpTimestampLabel(ownZusage)}</p>}
  <EventRsvpButtons
    eventId={event.id}
    initialStatus={ownZusage?.status ?? null}
    initialNote={ownZusage?.note ?? ''}
    withNote
  />
</div>
```

Placed above the buttons (not below the note/save button) so it reads as "current persisted
state" before the interactive controls to change it — and because it's static server-rendered
text describing the last *saved* state, it correctly stays put while the user edits the form
before saving (no new prop threading into the client component needed).

**Teilnehmerliste section** (currently lines 129–159): each `<li>` currently packs badge, name,
and optional note into a single `flex flex-wrap items-baseline` row. Adding a fourth optional
inline element (a timestamp) risks visual crowding on narrow viewports when a note is also
present. Restructure each `<li>` into two stacked lines instead — the existing row unchanged,
plus a new small muted line below it:

```tsx
<li key={zusage.id} className="flex flex-col gap-0.5">
  <div className="flex flex-wrap items-baseline gap-2">
    <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE_CLASS[zusage.status]}`}>
      {STATUS_LABEL[zusage.status]}
    </span>
    <span className="text-neutral-800">
      {zusage.user.firstName} {zusage.user.lastName}
    </span>
    {zusage.note && <span className="text-xs text-neutral-500">„{zusage.note}“</span>}
  </div>
  <span className="text-xs text-neutral-400">{formatRsvpTimestampLabel(zusage)}</span>
</li>
```

## Testing

No automated test suite exists in this repo (established convention: verify via `tsc`/`build` plus
live, real-DB manual verification). Verification plan for the implementer:
1. `npx tsc --noEmit` / `npm run build` clean.
2. Live-verify against the local dev Postgres: seed one `TerminZusage` row with `createdAt ===
   updatedAt` (first-ever response) and confirm it renders `"{Status} am DD-MM-YYYY HH:MM"`;
   update the same row's `status` via the app's own RSVP flow (or a direct SQL update simulating
   a real re-submit, confirming Prisma's `@updatedAt` bumps `updatedAt`) and confirm it now renders
   `"Zuletzt geändert am ..."` with the new `updatedAt` value.
3. Confirm "Meine Zusage" only shows the line when the current user has an existing `TerminZusage`
   row, and shows nothing extra when they haven't responded yet.
4. Confirm the Vienna-timezone formatting is correct regardless of the exact server timezone
   (cross-check `formatDateTimeDDMMYYYY`'s output against a known UTC instant converted by hand).
5. Clean up all seeded test data afterward, per this project's established convention.
