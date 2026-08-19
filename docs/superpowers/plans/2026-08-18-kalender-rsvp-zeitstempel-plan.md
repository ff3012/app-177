# Kalender RSVP Zeitstempel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, on the Kalender-Termindetailseite, when a member's RSVP ("Zusage") was last set
or changed — in the Teilnehmerliste (every participant) and in "Meine Zusage" (the current user) —
formatted as `DD-MM-YYYY HH:MM` in Europe/Vienna time.

**Architecture:** Pure display addition on top of data that already exists. `TerminZusage`
already has `createdAt`/`updatedAt` (`updatedAt` is `@updatedAt`, auto-bumped by Prisma on every
RSVP re-submit), and `src/app/(app)/kalender/[eventId]/page.tsx` already fetches full
`TerminZusage` rows for the Teilnehmerliste. No schema change, no migration, no new Server Action,
no client-component changes.

**Tech Stack:** Next.js App Router Server Component (existing page), a small addition to the
existing `src/lib/format.ts` helper module.

## Global Constraints

- Timestamp format is exactly `DD-MM-YYYY HH:MM` (dash-separated, day first, 24-hour time,
  zero-padded), computed in `Europe/Vienna` time regardless of server OS timezone.
- Scope is limited to `kalender/[eventId]/page.tsx`'s Teilnehmerliste and "Meine Zusage" sections.
  Do not touch `event-list-view.tsx`'s `DesktopEventRow` or `home-todo-list.tsx` — explicitly out
  of scope, confirmed with the product owner.
- No new permission check needed — the Teilnehmerliste (names, statuses, notes) is already fully
  visible to everyone `canViewEvent` allows onto the page; the new timestamps don't change that.
- This repo has no automated test suite. Verify via `npx tsc --noEmit`, `npm run build`, and live
  manual verification against the local dev Postgres (`DATABASE_URL` in `.env`, container
  `einsatz-foto-upload-postgres-1`).

---

### Task 1: Vienna-timezone RSVP timestamp formatter + Termindetailseite display

**Files:**
- Modify: `src/lib/format.ts` (add `formatDateTimeDDMMYYYY`)
- Modify: `src/app/(app)/kalender/[eventId]/page.tsx` (add `formatRsvpTimestampLabel` +
  two render additions)

**Interfaces:**
- Produces: `formatDateTimeDDMMYYYY(date: Date): string` — exported from `src/lib/format.ts`,
  returns e.g. `"18-08-2026 14:32"` in Europe/Vienna time. This is the only new exported symbol;
  nothing else in this plan depends on interfaces beyond this one function and the existing,
  already-defined `RsvpStatusOption` type from `@/lib/validation/rsvp.schema` and `TerminZusage`
  Prisma model fields (`status`, `createdAt`, `updatedAt`, already fetched by the page's existing
  `prisma.terminZusage.findMany` call).

- [ ] **Step 1: Add the formatter to `src/lib/format.ts`**

Open `src/lib/format.ts`. It already has a private `const VIENNA_TIME_ZONE = 'Europe/Vienna';`
near the top (used by `formatRelativeDate`). Add this new exported function anywhere after that
constant is declared (e.g. right after `formatRelativeDate`, before `isOlderThanMonths`):

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

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors (this repo has no pre-existing errors — if you see any, they are not
caused by this step; stop and report rather than "fixing" unrelated code).

- [ ] **Step 3: Manually sanity-check the formatter's output**

Confirm correctness before wiring it into the page - this both proves the function works and pins
down the Node/ICU `hourCycle` behavior before it matters. Run this directly with `npx tsx` (no
throwaway file needed):

```bash
npx tsx -e "
import { formatDateTimeDDMMYYYY } from './src/lib/format';
// A known UTC instant: 2026-01-15T23:30:00Z is 2026-01-16 00:30 in Vienna (CET, UTC+1 in January).
console.log(formatDateTimeDDMMYYYY(new Date('2026-01-15T23:30:00Z')));
// Expect: 16-01-2026 00:30 (NOT 16-01-2026 24:30 or 15-01-2026 23:30 - both would indicate a bug)
"
```

Expected output: `16-01-2026 00:30`. If you see `24:30` anywhere, the `hourCycle: 'h23'` line was
dropped or overridden - fix it before continuing. If you see `15-01-2026 23:30`, the `timeZone`
option isn't being applied - check for typos in `VIENNA_TIME_ZONE`.

- [ ] **Step 4: Add the page-local label helper and imports to `page.tsx`**

Open `src/app/(app)/kalender/[eventId]/page.tsx`. Add this import alongside the existing imports
near the top of the file:

```ts
import { formatDateTimeDDMMYYYY } from '@/lib/format';
```

Add this new function directly after the existing `STATUS_BADGE_CLASS` constant (before
`formatEventTime`):

```ts
function formatRsvpTimestampLabel(zusage: { status: RsvpStatusOption; createdAt: Date; updatedAt: Date }): string {
  const changed = zusage.createdAt.getTime() !== zusage.updatedAt.getTime();
  return changed
    ? `Zuletzt geändert am ${formatDateTimeDDMMYYYY(zusage.updatedAt)}`
    : `${STATUS_LABEL[zusage.status]} am ${formatDateTimeDDMMYYYY(zusage.createdAt)}`;
}
```

- [ ] **Step 5: Wire the label into the "Meine Zusage" section**

In the same file, find this existing block (currently ~lines 117–127):

```tsx
      {!event.vehicleBookingId && (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Meine Zusage</h2>
          <EventRsvpButtons
            eventId={event.id}
            initialStatus={ownZusage?.status ?? null}
            initialNote={ownZusage?.note ?? ''}
            withNote
          />
        </div>
      )}
```

Replace it with:

```tsx
      {!event.vehicleBookingId && (
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
      )}
```

(Only the new `{ownZusage && ...}` line is added; `<EventRsvpButtons>` itself is unchanged - do
not add any new props to it.)

- [ ] **Step 6: Wire the label into the Teilnehmerliste**

In the same file, find this existing block (currently ~lines 144–156):

```tsx
            <ul className="flex flex-col gap-1.5 text-sm">
              {zusagen.map((zusage) => (
                <li key={zusage.id} className="flex flex-wrap items-baseline gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE_CLASS[zusage.status]}`}>
                    {STATUS_LABEL[zusage.status]}
                  </span>
                  <span className="text-neutral-800">
                    {zusage.user.firstName} {zusage.user.lastName}
                  </span>
                  {zusage.note && <span className="text-xs text-neutral-500">„{zusage.note}“</span>}
                </li>
              ))}
            </ul>
```

Replace it with:

```tsx
            <ul className="flex flex-col gap-1.5 text-sm">
              {zusagen.map((zusage) => (
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
              ))}
            </ul>
```

(Each `<li>` becomes a two-line stack: the existing badge/name/note row unchanged, plus a new
muted timestamp line below it - the outer `<ul>` and its `key`/`.map` are unchanged.)

- [ ] **Step 7: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Full production build**

Run: `npm run build`
Expected: succeeds with no errors, `/kalender/[eventId]` still listed in the route output.

- [ ] **Step 9: Live verification against the local dev Postgres**

The local dev Postgres (`einsatz-foto-upload-postgres-1`, matching this repo's `.env`
`DATABASE_URL`) already has a bootstrap admin user and Feuerwehr organizations seeded from earlier
work this session. Use `docker exec -i einsatz-foto-upload-postgres-1 psql -U ffapp -d ffapp` for
all queries below (adjust the user/db name if your `.env`'s `DATABASE_URL` differs - check it
first with `grep DATABASE_URL .env`).

Find an existing `Event` id and `User` id to attach test `TerminZusage` rows to:

```sql
SELECT id, title FROM "Event" LIMIT 3;
SELECT id, email FROM "User" LIMIT 3;
```

If no `Event` rows exist, create one via the running app's own `/kalender/neu` page instead of
inserting one by hand (an `Event` has many required relations - creating one through the real UI
is simpler and safer than hand-crafting the INSERT). Then seed one `TerminZusage` row representing
a **first-ever, unchanged** response (`createdAt` == `updatedAt`):

```sql
INSERT INTO "TerminZusage" (id, "eventId", "userId", status, "createdAt", "updatedAt")
VALUES ('test-zeitstempel-1', '<event-id>', '<user-id>', 'ZUGESAGT', now() - interval '2 hours', now() - interval '2 hours');
```

Start a dev/production server (this repo's documented workaround: `npm run dev`'s CSP blocks
hydration on this box, but this page needs no client-side interactivity to verify the *display*
logic, so `npm run dev` is fine here — only skip it if you hit the CSP/hydration issue) and load
`/kalender/<event-id>` as that user. Confirm:
- The Teilnehmerliste row for this user shows `Zugesagt am <2 hours ago's date/time>` (not "Zuletzt
  geändert").
- If this is the logged-in user, "Meine Zusage" shows the same label above the buttons.

Then simulate a real status change by updating `updatedAt` to a later time than `createdAt`
(mirroring what the real `setRsvp` Server Action's `upsert` does via `@updatedAt` on every write -
this is the same effect a real re-submit through the UI has, verified as accurate per the design
spec's investigation):

```sql
UPDATE "TerminZusage" SET status = 'ABGESAGT', "updatedAt" = now() WHERE id = 'test-zeitstempel-1';
```

Reload the page. Confirm the row now shows `Zuletzt geändert am <current date/time>` instead.

Also confirm the negative case: view the page as a **different** user who has never RSVP'd to
this event, and confirm "Meine Zusage" shows no timestamp line at all (just the heading and
buttons) - `ownZusage` is `undefined` for them.

Clean up the test data afterward:

```sql
DELETE FROM "TerminZusage" WHERE id = 'test-zeitstempel-1';
```

If you created a throwaway `Event` via the UI for this test, delete it afterward too (via the
event's own "Bearbeiten" → delete flow, or directly in SQL if simpler - either way, leave the
database exactly as you found it).

- [ ] **Step 10: Commit**

```bash
git add src/lib/format.ts "src/app/(app)/kalender/[eventId]/page.tsx"
git commit -m "feat: show RSVP-Zeitstempel in Kalender-Teilnehmerliste (issue #16)"
```
