# Heimatfeuerwehr V4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compact the "Meine Feuerwehr" Fuhrpark widget, sync vehicle bookings into the existing Kalender module as protected events, add an all-bookings admin view, and fix a real bug where Feuerwehr-only admins never see the "Verwaltung" nav entry.

**Architecture:** Additive changes on top of the already-shipped Heimatfeuerwehr module (base + V3). No new Prisma models — one new nullable/unique field on the existing `Event` model links it 1:1 to a `VehicleBooking`. No new UI framework — everything follows the exact conventions already established in this codebase (plain Tailwind for member pages, shadcn for Verwaltung, native `<form>` GET/POST where JS isn't required).

**Tech Stack:** Next.js App Router (Server Actions + Server Components), Prisma/PostgreSQL, react-hook-form (booking form only), plain Tailwind, shadcn/ui (Verwaltung only).

## Global Constraints

- No test framework exists in this repo (`CLAUDE.md`: "There is no test suite in this repo"). Every task's "test" step is `npx tsc --noEmit -p tsconfig.json` and/or `npm run build`, plus a targeted Node script or browser check where runtime behavior needs proving — not a literal unit test file.
- `npx tsc --noEmit -p tsconfig.json` and `npm run build` must both pass cleanly before every commit (established project convention).
- German UI copy throughout; code identifiers mix German/English matching the existing file's own convention.
- `AskUserQuestion` before the final `git commit`/`git push` (established project convention — do not skip).
- Prisma migration timestamps in this repo use a hand-incremented fake-date scheme, currently ending at `20260812090000`. A freshly-generated migration will get today's *real* system timestamp (`2026-08-01...`), which sorts *before* that — it must be renamed to `20260813090000_<name>` and its `_prisma_migrations` bookkeeping row corrected to match (see Task 1, Step 5 for the exact commands — this has bitten this exact project twice already this session).

---

### Task 1: Schema — `Event.vehicleBookingId`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: a new migration folder under `prisma/migrations/`

**Interfaces:**
- Produces: `Event.vehicleBookingId: string | null` (unique), `Event.vehicleBooking: VehicleBooking | null` (relation), `VehicleBooking.event: Event | null` (back-relation) — all later tasks read/write `vehicleBookingId` directly via Prisma Client.

- [ ] **Step 1: Add the field to `Event` and the back-relation to `VehicleBooking`**

In `prisma/schema.prisma`, find the `model Event {` block and add the new field + relation right after `createdAt`/`updatedAt` (before the existing relation fields):

```prisma
model Event {
  id             String        @id @default(cuid())
  title          String
  description    String?
  location       String?
  startsAt       DateTime
  endsAt         DateTime
  allDay         Boolean       @default(false)
  organizationId String
  isSectionWide  Boolean       @default(false)
  category       EventCategory @default(ALLGEMEIN)
  createdById    String
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  // Gesetzt, wenn dieser Termin automatisch aus einer Fahrzeug-Buchung erzeugt wurde (siehe
  // meine-feuerwehr/actions.ts) - sein bloßes Vorhandensein markiert den Termin als
  // "buchungsverwaltet" und schützt ihn vor normaler Bearbeitung/Löschung im Kalender
  // (kalender/[eventId]/bearbeiten/page.tsx, kalender/actions.ts).
  vehicleBookingId String?         @unique
  vehicleBooking   VehicleBooking? @relation(fields: [vehicleBookingId], references: [id], onDelete: SetNull)

  organization Organization   @relation(fields: [organizationId], references: [id])
  createdBy    User           @relation("EventCreatedBy", fields: [createdById], references: [id])
  zusagen      TerminZusage[]

  @@index([organizationId, startsAt])
  @@index([isSectionWide, startsAt])
}
```

Then find `model VehicleBooking {` and add the bare back-relation field (no `@relation` attributes needed on this side):

```prisma
model VehicleBooking {
  id        String   @id @default(cuid())
  vehicleId String
  userId    String
  startsAt  DateTime
  endsAt    DateTime
  createdAt DateTime @default(now())

  vehicle Vehicle @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  event   Event?

  @@index([vehicleId, startsAt])
}
```

- [ ] **Step 2: Generate the migration**

```bash
npx prisma migrate dev --name event_vehicle_booking_id
```

Expected: applies cleanly (purely additive nullable column + index, no data-loss warning), prints "Your database is now in sync with your schema."

- [ ] **Step 3: Check the generated migration's timestamp against the existing sequence**

```bash
ls prisma/migrations | sort | tail -3
```

Expected: the new folder (named with today's real timestamp, e.g. `20260801XXXXXX_event_vehicle_booking_id`) sorts *before* `20260812090000_atemschutz_sachbearbeiter`. If so, proceed to Step 4's rename. If it happens to already sort after (unlikely but possible depending on time of day), skip Step 4 entirely.

- [ ] **Step 4: Rename to the next fake-date slot and fix `_prisma_migrations` bookkeeping**

```bash
mv prisma/migrations/20260801*_event_vehicle_booking_id prisma/migrations/20260813090000_event_vehicle_booking_id
sha256sum prisma/migrations/20260813090000_event_vehicle_booking_id/migration.sql
```

Copy the printed checksum, then run (substituting `<CHECKSUM>` and `<OLD_NAME>` — the old name is whatever `ls prisma/migrations` showed before the rename, e.g. `20260801143022_event_vehicle_booking_id`):

```bash
npx prisma db execute --stdin --schema prisma/schema.prisma <<'EOF'
DELETE FROM "_prisma_migrations" WHERE migration_name = '<OLD_NAME>';

INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
VALUES (
  gen_random_uuid()::text,
  '<CHECKSUM>',
  '20260813090000_event_vehicle_booking_id',
  now(),
  now(),
  1
);
EOF
```

- [ ] **Step 5: Verify final migration order and schema**

```bash
docker compose -f docker-compose.dev.yml exec -T postgres psql -U ffapp -d ffapp -c "SELECT migration_name FROM \"_prisma_migrations\" ORDER BY migration_name;" -c "\d \"Event\""
```

Expected: `20260813090000_event_vehicle_booking_id` is the last row in the first query; the second query's output includes a `vehicleBookingId` column (nullable text) and a `Event_vehicleBookingId_key` unique index.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260813090000_event_vehicle_booking_id/
git commit -m "Add Event.vehicleBookingId for calendar-synced vehicle bookings"
```

---

### Task 2: Sync `Event` creation/deletion with `VehicleBooking` lifecycle

**Files:**
- Modify: `src/app/(app)/meine-feuerwehr/actions.ts`

**Interfaces:**
- Consumes: `prisma.vehicle`, `prisma.event`, `prisma.vehicleBooking` (Prisma Client, from Task 1's schema); `findOverlappingBooking` (existing, `@/lib/heimatfeuerwehr/vehicle-availability`); `canManageVehicleBooking` (existing, `@/lib/auth/permissions`).
- Produces: `cancelVehicleBooking(bookingId: string, redirectTo?: string): Promise<void>` — **signature change**: adds an optional second parameter (defaults to `/meine-feuerwehr`) so Task 9 (admin all-bookings view) can reuse this exact function without being redirected to the member overview page after deleting someone else's booking.

- [ ] **Step 1: Replace the full file content**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageVehicleBooking } from '@/lib/auth/permissions';
import { vehicleBookingSchema, parseVehicleBookingFormData } from '@/lib/validation/vehicle-booking.schema';
import { findOverlappingBooking } from '@/lib/heimatfeuerwehr/vehicle-availability';

export interface VehicleBookingFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

// Legt neben der VehicleBooking zusätzlich einen normalen Kalender-Termin an (Titel "Fahrzeug: X
// (Vorname Nachname)", in der eigenen Heimatfeuerwehr, category ALLGEMEIN) - verknüpft über
// Event.vehicleBookingId. Der Termin ist ab dann ein STANDARD-Termin im Hauptkalender (sichtbar,
// mit RSVP), aber vor normaler Bearbeitung/Löschung geschützt (siehe kalender/actions.ts und
// kalender/[eventId]/bearbeiten/page.tsx).
export async function createVehicleBooking(
  _prevState: VehicleBookingFormState,
  formData: FormData,
): Promise<VehicleBookingFormState> {
  const user = await requireUser();

  const parsed = vehicleBookingSchema.safeParse(parseVehicleBookingFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const vehicle = await prisma.vehicle.findUnique({ where: { id: data.vehicleId } });
  if (!vehicle || !vehicle.isActive || vehicle.organizationId !== user.homeOrganizationId) {
    return { fieldErrors: { vehicleId: ['Ausgewähltes Fahrzeug ist nicht verfügbar.'] } };
  }

  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);

  const overlap = await findOverlappingBooking(data.vehicleId, startsAt, endsAt);
  if (overlap) {
    return {
      error: `Das Fahrzeug ist in diesem Zeitraum bereits von ${overlap.user.firstName} ${overlap.user.lastName} gebucht.`,
    };
  }

  const booking = await prisma.vehicleBooking.create({
    data: { vehicleId: data.vehicleId, userId: user.id, startsAt, endsAt },
  });

  await prisma.event.create({
    data: {
      title: `Fahrzeug: ${vehicle.taktischeBezeichnung} (${user.name})`,
      startsAt,
      endsAt,
      organizationId: user.homeOrganizationId,
      isSectionWide: false,
      category: 'ALLGEMEIN',
      createdById: user.id,
      vehicleBookingId: booking.id,
    },
  });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/kalender');
  redirect('/meine-feuerwehr');
}

// redirectTo lässt admin/heimatfeuerwehr/page.tsx diese exakte Funktion wiederverwenden (statt
// sie zu duplizieren), ohne einen Admin nach dem Löschen fremder Buchungen auf /meine-feuerwehr
// statt zurück auf die Verwaltungsseite zu schicken.
export async function cancelVehicleBooking(bookingId: string, redirectTo = '/meine-feuerwehr'): Promise<void> {
  const user = await requireUser();

  const booking = await prisma.vehicleBooking.findUnique({
    where: { id: bookingId },
    include: { vehicle: { select: { organizationId: true } } },
  });
  if (!booking) {
    redirect(redirectTo);
  }
  assertPermission(canManageVehicleBooking(user, booking, booking.vehicle.organizationId));

  // Der verknüpfte Termin könnte theoretisch schon unabhängig gelöscht worden sein (z. B. direkt
  // über Prisma Studio, am eigentlich vorgesehenen Schutz vorbei) - daher erst nachsehen statt
  // blind zu löschen.
  const linkedEvent = await prisma.event.findUnique({ where: { vehicleBookingId: bookingId } });
  if (linkedEvent) {
    await prisma.event.delete({ where: { id: linkedEvent.id } });
  }

  await prisma.vehicleBooking.delete({ where: { id: bookingId } });
  revalidatePath('/meine-feuerwehr');
  revalidatePath('/admin/heimatfeuerwehr');
  revalidatePath('/kalender');
  redirect(redirectTo);
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output. (The existing call site in `meine-feuerwehr/page.tsx` — `cancelVehicleBooking.bind(null, booking.id)` — still type-checks since the new parameter is optional.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/actions.ts"
git commit -m "Sync VehicleBooking create/cancel with a linked Kalender Event"
```

---

### Task 3: Tag Kalender events with `isVehicleBooking`, protect `editable`

**Files:**
- Modify: `src/app/(app)/kalender/page.tsx`

**Interfaces:**
- Consumes: `event.vehicleBookingId` (from Task 1 — already returned by the existing unfiltered `prisma.event.findMany`, no query change needed since it has no explicit `select`).
- Produces: `CalendarEventInput.isVehicleBooking: boolean` (new field every downstream consumer in Tasks 4 reads); `CalendarEventInput.editable` now also requires `!event.vehicleBookingId`.

- [ ] **Step 1: Edit the event-mapping block**

In `src/app/(app)/kalender/page.tsx`, find the `.map((event) => {` block (around line 60) and change exactly two lines:

```ts
  const calendarEvents: CalendarEventInput[] = allEvents
    .filter((event) => event.category !== 'DROHNENGRUPPE' || canSeeDroneCategory)
    .map((event) => {
      const layer = event.category === 'DROHNENGRUPPE' ? 'drohnengruppe' : event.isSectionWide ? 'abschnitt' : 'own';
      return {
        id: event.id,
        title: event.title,
        start: event.startsAt.toISOString(),
        end: event.endsAt.toISOString(),
        allDay: event.allDay,
        editable: canManageEventsFor(user, event.organizationId) && !event.vehicleBookingId,
        backgroundColor: LAYER_COLORS[layer],
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        organizationName: event.organization.shortName ?? event.organization.name,
        category: event.category,
        layer,
        myRsvpStatus: myRsvpByEvent.get(event.id) ?? null,
        rsvpCounts: rsvpCountsByEvent.get(event.id) ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 },
        isVehicleBooking: event.vehicleBookingId !== null,
      };
    });
```

(Only the `editable:` line and the new trailing `isVehicleBooking:` line are new — everything else is unchanged.)

- [ ] **Step 2: Type-check (expect an error — this is intentional, fixed by Task 4)**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: an error like `Object literal may only specify known properties, and 'isVehicleBooking' does not exist in type 'CalendarEventInput'` — this is expected since Task 4 adds the field to the interface. Do not attempt to fix it here; proceed directly to Task 4.

---

### Task 4: `isVehicleBooking` on `CalendarEventInput` + shared icon in all three render sites

**Files:**
- Create: `src/components/calendar/vehicle-booking-icon.tsx`
- Modify: `src/components/calendar/calendar-view.tsx`
- Modify: `src/components/calendar/event-list-view.tsx`

**Interfaces:**
- Consumes: `CalendarEventInput.isVehicleBooking` (from Task 3).
- Produces: `VehicleBookingIcon({ className }: { className?: string })` — a small inline SVG, reused by both `calendar-view.tsx` and `event-list-view.tsx` so the three render sites (FullCalendar month chip, list row, mobile card) can't visually drift apart (same principle as the existing shared `RsvpBadge`).

- [ ] **Step 1: Create the shared icon component**

```tsx
/** Kleines Auto-Symbol, das einen automatisch aus einer Fahrzeug-Buchung erzeugten Kalender-
 * Termin kennzeichnet (siehe meine-feuerwehr/actions.ts, Event.vehicleBookingId). Handgerolltes
 * Inline-SVG statt einer Icon-Bibliothek, passend zur bestehenden Konvention dieser Codebase.
 * Von calendar-view.tsx (FullCalendar-Monatsraster-Chip) UND event-list-view.tsx (Zeile + mobile
 * Karte) genutzt, damit alle drei Darstellungen nicht auseinanderlaufen. */
export function VehicleBookingIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-label="Fahrzeug-Buchung"
    >
      <path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="2" y="13" width="20" height="5" rx="1" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="18" r="1.5" />
      <circle cx="17" cy="18" r="1.5" />
    </svg>
  );
}
```

- [ ] **Step 2: Add `isVehicleBooking` to `CalendarEventInput` and use the icon in `renderEventContent`**

In `src/components/calendar/calendar-view.tsx`:

1. Add the import at the top (with the other local imports):
```ts
import { VehicleBookingIcon } from './vehicle-booking-icon';
```

2. Add the field to the interface:
```ts
export interface CalendarEventInput {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  editable: boolean;
  backgroundColor?: string;
  description?: string;
  location?: string;
  organizationName?: string;
  category?: string;
  layer?: string;
  myRsvpStatus?: 'ZUGESAGT' | 'ABGESAGT' | 'UNKLAR' | null;
  rsvpCounts?: { ZUGESAGT: number; ABGESAGT: number; UNKLAR: number };
  isVehicleBooking?: boolean;
}
```

3. Update `renderEventContent` to show the icon:
```tsx
function renderEventContent(arg: EventContentArg) {
  const showRsvp = arg.view.type === 'dayGridMonth' && arg.event.extendedProps.category === 'DROHNENGRUPPE';
  const rsvpCounts = arg.event.extendedProps.rsvpCounts as CalendarEventInput['rsvpCounts'];
  const isVehicleBooking = arg.event.extendedProps.isVehicleBooking as boolean | undefined;

  return (
    <div className="w-full overflow-hidden px-1 py-0.5 text-white">
      <div className="truncate text-[11px] font-medium leading-tight">
        {!arg.event.allDay && `${arg.timeText} `}
        {isVehicleBooking && <VehicleBookingIcon className="mr-0.5 inline-block align-[-1px]" />}
        {arg.event.title}
      </div>
      {showRsvp && rsvpCounts && <RsvpBadge counts={rsvpCounts} compact />}
    </div>
  );
}
```

4. Thread `isVehicleBooking` into `extendedProps` in the `<FullCalendar>` `events` prop:
```tsx
          events={events.map((event) => ({
            ...event,
            extendedProps: {
              editable: event.editable,
              rsvpCounts: event.rsvpCounts,
              category: event.category,
              isVehicleBooking: event.isVehicleBooking,
            },
          }))}
```

- [ ] **Step 3: Use the icon in the list row and mobile card**

In `src/components/calendar/event-list-view.tsx`:

1. Add the import:
```ts
import { VehicleBookingIcon } from './vehicle-booking-icon';
```

2. In `EventListRow`, change the title cell:
```tsx
      <td className="break-words px-3 py-1">
        {event.isVehicleBooking && <VehicleBookingIcon className="mr-1 inline-block align-[-2px] text-neutral-500" />}
        {event.title}
      </td>
```

3. In `EventCard`, change the title span:
```tsx
        <span className="font-medium text-neutral-900">
          {event.isVehicleBooking && <VehicleBookingIcon className="mr-1 inline-block align-[-2px] text-neutral-500" />}
          {event.title}
        </span>
```

- [ ] **Step 4: Type-check (should now be clean, including Task 3's edit)**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/kalender/page.tsx" src/components/calendar/vehicle-booking-icon.tsx src/components/calendar/calendar-view.tsx src/components/calendar/event-list-view.tsx
git commit -m "Tag vehicle-booking events, block their edit-shortcut, add calendar icon"
```

---

### Task 5: Block normal editing of booking-linked events (page-level)

**Files:**
- Modify: `src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx`

**Interfaces:**
- Consumes: `event.vehicleBookingId` (Task 1).

- [ ] **Step 1: Add the protection branch right after the existing permission check**

In `src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx`, insert a new check immediately after the existing `if (!canManageEventsFor(...))` block (so a user without edit rights still sees the generic "keine Berechtigung" message first; only a user who *would* otherwise be allowed to edit sees this specific one):

```tsx
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canCreateSectionWideEvent, canManageEventsFor } from '@/lib/auth/permissions';
import { EventForm } from '@/components/calendar/event-form';
import { AddToCalendarLink } from '@/components/calendar/add-to-calendar-link';
import { toDatetimeLocalValue } from '@/lib/format';
import { deleteEvent, updateEvent } from '../../actions';

export default async function TerminBearbeitenPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireUser();
  const { eventId } = await params;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return <p className="text-neutral-700">Termin wurde nicht gefunden.</p>;
  }
  if (!canManageEventsFor(user, event.organizationId)) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, diesen Termin zu bearbeiten.</p>;
  }
  if (event.vehicleBookingId) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">Termin bearbeiten</h1>
        <p className="text-neutral-700">
          Dieser Termin gehört zu einer Fahrzeug-Buchung. Um ihn zu ändern oder zu stornieren, gehe zu{' '}
          <Link href="/meine-feuerwehr" className="text-brand hover:underline">
            Meine Feuerwehr
          </Link>
          .
        </p>
      </div>
    );
  }

  const organizations = await prisma.organization.findMany({
    where: { id: { in: user.feuerwehrAdminOrgIds } },
    orderBy: { name: 'asc' },
  });

  const boundUpdate = updateEvent.bind(null, event.id);
  const boundDelete = deleteEvent.bind(null, event.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">Termin bearbeiten</h1>
        <div className="flex items-center gap-3">
          <AddToCalendarLink eventId={event.id} />
          <Link href={`/kalender/${event.id}`} className="text-sm font-medium text-brand hover:underline">
            Zusage & Teilnehmerliste
          </Link>
        </div>
      </div>
      <EventForm
        organizations={organizations}
        canSectionWide={canCreateSectionWideEvent(user)}
        action={boundUpdate}
        submitLabel="Änderungen speichern"
        defaultValues={{
          title: event.title,
          description: event.description ?? '',
          location: event.location ?? '',
          startsAt: toDatetimeLocalValue(event.startsAt),
          endsAt: toDatetimeLocalValue(event.endsAt),
          allDay: event.allDay,
          organizationId: event.organizationId,
          isSectionWide: event.isSectionWide,
          category: event.category,
        }}
      />
      <form action={boundDelete}>
        <button type="submit" className="text-sm text-red-700 hover:underline">
          Termin löschen
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx"
git commit -m "Block the edit page for calendar-synced vehicle-booking events"
```

---

### Task 6: Block `updateEvent`/`deleteEvent` server-side (defense in depth)

**Files:**
- Modify: `src/app/(app)/kalender/actions.ts`

**Interfaces:**
- Consumes: `existing.vehicleBookingId` (Task 1); `assertPermission(condition, message?)` (existing, `@/lib/auth/permissions`).

- [ ] **Step 1: Add the guard to `updateEvent`, right after the existing `isSectionWide` check**

```ts
export async function updateEvent(
  eventId: string,
  _prevState: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const user = await requireUser();
  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) {
    return { error: 'Termin wurde nicht gefunden.' };
  }
  assertPermission(canManageEventsFor(user, existing.organizationId));
  if (existing.isSectionWide && !canCreateSectionWideEvent(user)) {
    return { error: 'Keine Berechtigung, diesen Abschnitt-weiten Termin zu bearbeiten.' };
  }
  if (existing.vehicleBookingId) {
    return { error: 'Dieser Termin gehört zu einer Fahrzeug-Buchung und kann hier nicht bearbeitet werden.' };
  }

  const parsed = eventSchema.safeParse(parseEventFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide && !canCreateSectionWideEvent(user)) {
    return { error: 'Keine Berechtigung für Abschnitt-weite Termine.' };
  }

  await prisma.event.update({
    where: { id: eventId },
    data: {
      title: data.title,
      description: data.description || null,
      location: data.location || null,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      allDay: data.allDay,
      organizationId: data.organizationId,
      isSectionWide: data.isSectionWide,
      category: data.category,
    },
  });

  revalidateCalendars();
  redirect('/kalender');
}
```

(Only the new `if (existing.vehicleBookingId)` block is added — everything else in the function is unchanged.)

- [ ] **Step 2: Add the guard to `deleteEvent`, right after the existing `isSectionWide` check**

```ts
export async function deleteEvent(eventId: string): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) {
    redirect('/kalender');
  }
  assertPermission(canManageEventsFor(user, existing.organizationId));
  if (existing.isSectionWide) {
    assertPermission(canCreateSectionWideEvent(user));
  }
  assertPermission(
    !existing.vehicleBookingId,
    'Dieser Termin gehört zu einer Fahrzeug-Buchung und kann hier nicht gelöscht werden.',
  );

  await prisma.event.delete({ where: { id: eventId } });
  revalidateCalendars();
  redirect('/kalender');
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/kalender/actions.ts"
git commit -m "Guard updateEvent/deleteEvent against editing vehicle-booking events"
```

---

### Task 7: Compact Fuhrpark widget on `/meine-feuerwehr`

**Files:**
- Modify: `src/app/(app)/meine-feuerwehr/page.tsx`

**Interfaces:**
- Produces: navigates to `/meine-feuerwehr/buchen?vehicleId=<id>` via a native GET `<form>` (no client JS needed — works even without hydration).

- [ ] **Step 1: Replace the Fuhrpark query and section**

Replace the `prisma.vehicle.findMany` call (drop the `bookings` include — no longer needed) and the whole Fuhrpark `<div>` block:

```tsx
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { getExpiryStatus, getFinnentestExpiryDate, type AtemschutzExpiryStatus } from '@/lib/heimatfeuerwehr/atemschutz-status';
import { cancelVehicleBooking } from './actions';

const STATUS_LABEL: Record<AtemschutzExpiryStatus, string> = {
  aktiv: 'Aktiv',
  laeuft_bald_ab: 'Läuft bald ab',
  abgelaufen: 'Abgelaufen',
  keine_angabe: 'Keine Angabe',
};

const STATUS_CLASS: Record<AtemschutzExpiryStatus, string> = {
  aktiv: 'bg-green-100 text-green-800',
  laeuft_bald_ab: 'bg-amber-100 text-amber-800',
  abgelaufen: 'bg-red-100 text-red-800',
  keine_angabe: 'bg-neutral-100 text-neutral-600',
};

function StatusBadge({ status }: { status: AtemschutzExpiryStatus }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function formatRange(startsAt: Date, endsAt: Date): string {
  const day = startsAt.toLocaleDateString('de-AT');
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${start}–${end}`;
}

export default async function MeineFeuerwehrPage() {
  const user = await requireUser();
  const now = new Date();

  const [me, vehicles, myBookings] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        istAtemschutzgeraeteTraeger: true,
        atemschutzUntersuchungAm: true,
        atemschutzGueltigBis: true,
        atemschutzFinnentestAm: true,
      },
    }),
    prisma.vehicle.findMany({
      where: { organizationId: user.homeOrganizationId, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
    }),
    prisma.vehicleBooking.findMany({
      where: { userId: user.id, endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      include: { vehicle: true },
    }),
  ]);

  const untersuchungStatus = getExpiryStatus(me.atemschutzGueltigBis);
  const finnentestStatus = getExpiryStatus(getFinnentestExpiryDate(me.atemschutzFinnentestAm));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-neutral-900">Meine Feuerwehr</h1>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Atemschutz</h2>
        <p className="text-sm text-neutral-700">
          Atemschutzgeräteträger:{' '}
          <strong className="font-medium">{me.istAtemschutzgeraeteTraeger ? 'Ja' : 'Nein'}</strong>
        </p>
        {me.istAtemschutzgeraeteTraeger && (
          <div className="mt-3 flex flex-col gap-2 text-sm text-neutral-700">
            <p className="flex flex-wrap items-center gap-2">
              Untersuchung <StatusBadge status={untersuchungStatus} />
              <span className="text-neutral-500">
                {me.atemschutzUntersuchungAm
                  ? `zuletzt am ${me.atemschutzUntersuchungAm.toLocaleDateString('de-AT')}`
                  : 'noch kein Termin erfasst'}
                {me.atemschutzGueltigBis && `, gültig bis ${me.atemschutzGueltigBis.toLocaleDateString('de-AT')}`}
              </span>
            </p>
            <p className="flex flex-wrap items-center gap-2">
              Finnentest <StatusBadge status={finnentestStatus} />
              <span className="text-neutral-500">
                {me.atemschutzFinnentestAm
                  ? `zuletzt am ${me.atemschutzFinnentestAm.toLocaleDateString('de-AT')}`
                  : 'noch kein Termin erfasst'}
              </span>
            </p>
          </div>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Fuhrpark</h2>
        {vehicles.length === 0 ? (
          <p className="text-sm text-neutral-500">Für deine Feuerwehr sind noch keine Fahrzeuge hinterlegt.</p>
        ) : (
          <form action="/meine-feuerwehr/buchen" method="get" className="flex flex-wrap items-center gap-3">
            <select name="vehicleId" className="rounded border border-neutral-300 px-3 py-2 text-sm">
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.taktischeBezeichnung} ({vehicle.kennzeichen})
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Ausborgen
            </button>
          </form>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Meine Buchungen</h2>
        {myBookings.length === 0 ? (
          <p className="text-sm text-neutral-500">Keine kommenden Buchungen.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-200">
            {myBookings.map((booking) => {
              const boundCancel = cancelVehicleBooking.bind(null, booking.id);
              return (
                <li key={booking.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-neutral-900">{booking.vehicle.taktischeBezeichnung}</span>{' '}
                    <span className="text-neutral-500">{formatRange(booking.startsAt, booking.endsAt)}</span>
                  </span>
                  <form action={boundCancel}>
                    <button type="submit" className="text-red-700 hover:underline">
                      Stornieren
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
```

Note: the `Link` import is no longer used (the "Fahrzeug ausborgen" link is gone, replaced by the form) — remove it from the import list, which the version above already does.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/page.tsx"
git commit -m "Replace Fuhrpark vehicle list with a compact select+Ausborgen widget"
```

---

### Task 8: `/meine-feuerwehr/buchen` reads `?vehicleId=` to pre-select

**Files:**
- Modify: `src/app/(app)/meine-feuerwehr/buchen/page.tsx`
- Modify: `src/app/(app)/meine-feuerwehr/buchen/booking-form.tsx`

**Interfaces:**
- Consumes: `?vehicleId=` query param (from Task 7's form submission).
- Produces: `BookingForm` gains a new optional prop `initialVehicleId?: string`.

- [ ] **Step 1: Update the page to read and validate the query param**

```tsx
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { createVehicleBooking } from '../actions';
import { BookingForm } from './booking-form';

export default async function FahrzeugBuchenPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicleId?: string }>;
}) {
  const user = await requireUser();
  const { vehicleId } = await searchParams;

  const vehicles = await prisma.vehicle.findMany({
    where: { organizationId: user.homeOrganizationId, isActive: true },
    orderBy: { taktischeBezeichnung: 'asc' },
    select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
  });

  const initialVehicleId = vehicleId && vehicles.some((v) => v.id === vehicleId) ? vehicleId : undefined;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Fahrzeug ausborgen</h1>
      {vehicles.length === 0 ? (
        <p className="text-sm text-neutral-500">Für deine Feuerwehr sind noch keine Fahrzeuge hinterlegt.</p>
      ) : (
        <BookingForm vehicles={vehicles} action={createVehicleBooking} initialVehicleId={initialVehicleId} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update the form to accept and use the new prop**

In `src/app/(app)/meine-feuerwehr/buchen/booking-form.tsx`, change the props interface and the `useForm` default:

```tsx
interface BookingFormProps {
  vehicles: VehicleOption[];
  action: (prevState: VehicleBookingFormState, formData: FormData) => Promise<VehicleBookingFormState>;
  initialVehicleId?: string;
}

export function BookingForm({ vehicles, action, initialVehicleId }: BookingFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<BookingFormValues>({
    defaultValues: { vehicleId: initialVehicleId ?? vehicles[0]?.id ?? '', date: '', startTime: '', endTime: '' },
  });
```

(Everything else in the file — the rest of the component body — is unchanged.)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/buchen/page.tsx" "src/app/(app)/meine-feuerwehr/buchen/booking-form.tsx"
git commit -m "Pre-select vehicle in booking form from ?vehicleId= query param"
```

---

### Task 9: Admin — all vehicle bookings for the selected Feuerwehr

**Files:**
- Modify: `src/app/(app)/admin/heimatfeuerwehr/page.tsx`

**Interfaces:**
- Consumes: `cancelVehicleBooking(bookingId, redirectTo?)` (Task 2's new signature) imported from `@/app/(app)/meine-feuerwehr/actions`.

- [ ] **Step 1: Add the import and a local date-range formatter**

At the top of `src/app/(app)/admin/heimatfeuerwehr/page.tsx`, add:

```ts
import { cancelVehicleBooking } from '@/app/(app)/meine-feuerwehr/actions';
```

Add this helper function near the top of the file, alongside the existing `toDateInputValue`:

```ts
function formatBookingRange(startsAt: Date, endsAt: Date): string {
  const day = startsAt.toLocaleDateString('de-AT');
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${start}–${end}`;
}
```

- [ ] **Step 2: Add the query to the existing `Promise.all`**

Change the `const [vehicles, members] = await Promise.all([...])` block to also fetch all bookings for the selected org:

```ts
  const [vehicles, members, allBookings] = await Promise.all([
    prisma.vehicle.findMany({
      where: { organizationId: selectedOrgId },
      orderBy: { taktischeBezeichnung: 'asc' },
    }),
    prisma.user.findMany({
      where: { homeOrganizationId: selectedOrgId, isActive: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        istAtemschutzgeraeteTraeger: true,
        atemschutzUntersuchungAm: true,
        atemschutzGueltigBis: true,
        atemschutzFinnentestAm: true,
      },
    }),
    prisma.vehicleBooking.findMany({
      where: { vehicle: { organizationId: selectedOrgId } },
      orderBy: { startsAt: 'desc' },
      include: {
        vehicle: { select: { taktischeBezeichnung: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);
```

- [ ] **Step 3: Add the new section, right after the closing `</div>` of the Atemschutz section and before the outer wrapping `</div>`**

```tsx
      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Fahrzeug-Buchungen</h2>
        <Table>
          <TableHeader>
            <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Fahrzeug
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Zeitraum
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Gebucht von
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Status
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {allBookings.map((booking) => {
              const past = booking.endsAt.getTime() < Date.now();
              const boundCancel = cancelVehicleBooking.bind(null, booking.id, `/admin/heimatfeuerwehr?org=${selectedOrgId}`);
              return (
                <TableRow key={booking.id} className="border-line">
                  <TableCell className="font-medium text-ink">{booking.vehicle.taktischeBezeichnung}</TableCell>
                  <TableCell className="text-ink-muted">{formatBookingRange(booking.startsAt, booking.endsAt)}</TableCell>
                  <TableCell className="text-ink-muted">
                    {booking.user.firstName} {booking.user.lastName}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        past
                          ? 'border-transparent bg-surface-sunken text-ink-faint'
                          : 'border-transparent bg-success-subtle text-success-text'
                      }
                    >
                      {past ? 'Vergangen' : 'Kommend'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <form action={boundCancel}>
                      <button type="submit" className="text-sm text-danger hover:underline">
                        Löschen
                      </button>
                    </form>
                  </TableCell>
                </TableRow>
              );
            })}
            {allBookings.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-ink-muted">
                  Keine Fahrzeug-Buchungen für diese Feuerwehr.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/heimatfeuerwehr/page.tsx"
git commit -m "Add all-vehicle-bookings management section to admin/heimatfeuerwehr"
```

---

### Task 10: Fix — Feuerwehr-only admins never see "Verwaltung" in the main nav

**Files:**
- Modify: `src/lib/nav-items.ts`

**Interfaces:**
- Consumes: `canAccessHeimatfeuerwehrAdmin` (existing, `@/lib/auth/permissions`, already used by `src/lib/admin/nav-items.ts`).

- [ ] **Step 1: Replace the file content**

```ts
import type { SessionUser } from '@/types/next-auth';
import { canAccessHeimatfeuerwehrAdmin, canManageNews, canViewDroneModule, isSiteAdmin } from '@/lib/auth/permissions';

export interface NavItem {
  href: string;
  label: string;
}

/** Shared by the desktop <Nav> and the mobile <MobileTabBar> so the permission-filtered item list
 * (up to 5 items now that "Meine Feuerwehr" is unconditional like Kalender) can never drift
 * between the two - MobileTabBar's --tab-count grid is dynamic, not hardcoded to 4. */
export function getNavItems(user: SessionUser): NavItem[] {
  const items: NavItem[] = [
    { href: '/kalender', label: 'Kalender' },
    { href: '/meine-feuerwehr', label: 'Meine Feuerwehr' },
  ];

  if (canViewDroneModule(user)) {
    items.push({ href: '/drohnen', label: 'Drohnengruppe' });
  }

  if (canManageNews(user)) {
    items.push({ href: '/news', label: 'News' });
  }

  // Bugfix: vorher nur `if (isSiteAdmin(user))` - ein reiner Feuerwehr-Admin (Membership-Admin
  // ohne Abschnittskommando-Admin) sah dadurch den Menüpunkt "Verwaltung" gar nicht und konnte
  // /admin/heimatfeuerwehr praktisch nicht erreichen, obwohl canAccessHeimatfeuerwehrAdmin(user)
  // bereits korrekt true zurückgab (per Live-Test mit einem echten Konto bestätigt). Site-Admins
  // landen weiterhin auf der Benutzerverwaltung, reine Feuerwehr-Admins direkt auf der einzigen
  // Verwaltungsseite, die sie tatsächlich sehen dürfen.
  if (isSiteAdmin(user)) {
    items.push({ href: '/admin/benutzer', label: 'Verwaltung' });
  } else if (canAccessHeimatfeuerwehrAdmin(user)) {
    items.push({ href: '/admin/heimatfeuerwehr', label: 'Verwaltung' });
  }

  return items;
}

/** Nested routes (e.g. /kalender/abschnitt under /kalender) would otherwise match more than one
 * item's prefix check; only the longest (most specific) match wins. */
export function getActiveNavHref(items: NavItem[], pathname: string): string | undefined {
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
```

- [ ] **Step 2: Verify the fix with a synthetic `SessionUser` (no test framework — plain Node script)**

```bash
cat > scratch-test-nav-fix.mjs << 'EOF'
import { getNavItems } from './src/lib/nav-items.ts';

const feuerwehrOnlyAdmin = {
  id: 'u2', email: 'b@b', name: 'FF Admin', homeOrganizationId: 'org-gablitz',
  homeOrganizationType: 'FEUERWEHR', feuerwehrAdminOrgIds: ['org-gablitz'],
  isAbschnittsAdmin: false, isAbschnittskommandoMitglied: false,
  isDrohnengruppeMember: false, droneGroupRole: null,
};

const items = getNavItems(feuerwehrOnlyAdmin);
console.log(items);
const verwaltung = items.find((i) => i.label === 'Verwaltung');
if (!verwaltung) throw new Error('FAIL: "Verwaltung" missing from nav for Feuerwehr-only admin');
if (verwaltung.href !== '/admin/heimatfeuerwehr') throw new Error(`FAIL: wrong href ${verwaltung.href}`);
console.log('PASS: Feuerwehr-only admin sees "Verwaltung" -> /admin/heimatfeuerwehr');
EOF
npx tsx scratch-test-nav-fix.mjs
rm scratch-test-nav-fix.mjs
```

Expected: prints the items array (5 entries: Kalender, Meine Feuerwehr, Verwaltung — no Drohnengruppe/News for this synthetic user), then `PASS: Feuerwehr-only admin sees "Verwaltung" -> /admin/heimatfeuerwehr`.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/nav-items.ts
git commit -m "Fix: Feuerwehr-only admins never saw the Verwaltung nav entry"
```

---

### Task 11: Full verification, CLAUDE.md, final commit

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full build**

```bash
npm run build
```

Expected: `✓ Compiled successfully`, all routes listed including `/meine-feuerwehr`, `/meine-feuerwehr/buchen`, `/admin/heimatfeuerwehr`, `/kalender/[eventId]/bearbeiten`.

- [ ] **Step 2: Start the dev server and seed test data**

Use `preview_start` with the `dev` launch config, then insert test data via `docker compose -f docker-compose.dev.yml exec -T postgres psql -U ffapp -d ffapp`:
- One active `Vehicle` row for a real Feuerwehr org.
- Log in as the seeded site admin, navigate to `/meine-feuerwehr` — confirm the compact select+"Ausborgen" widget renders (no per-vehicle card list).
- Navigate to `/meine-feuerwehr/buchen?vehicleId=<that vehicle's id>` directly — confirm the vehicle `<select>` defaults to it.
- Insert a `VehicleBooking` row directly via SQL (mirroring the vehicle-booking-availability tests from the V3 round) — this bypasses `createVehicleBooking`, so also insert a matching `Event` row with `vehicleBookingId` set to that booking's id, to simulate what the action would have produced.
- Navigate to `/kalender` — confirm the event appears with the vehicle icon next to its title.
- Navigate to `/kalender/<that event id>/bearbeiten` — confirm the blocking message renders instead of the edit form.
- Navigate to `/admin/heimatfeuerwehr?org=<that org id>` — confirm the new "Fahrzeug-Buchungen" section lists the booking with a "Löschen" button.
- Click "Löschen" (native form submit, works without hydration) — confirm both the `VehicleBooking` and the linked `Event` are gone (re-check `/kalender` and the DB directly).

- [ ] **Step 3: Clean up all test data**

```bash
docker compose -f docker-compose.dev.yml exec -T postgres psql -U ffapp -d ffapp -c "
DELETE FROM \"Event\" WHERE title LIKE 'Fahrzeug:%';
DELETE FROM \"VehicleBooking\" WHERE id = '<test booking id>';
DELETE FROM \"Vehicle\" WHERE id = '<test vehicle id>';
"
```

(Substitute the actual test ids used in Step 2. If the "Löschen" click in Step 2 already removed the booking/event, only the `Vehicle` row needs cleanup.)

- [ ] **Step 4: Stop the preview server**

Use `preview_stop` with the server id from Step 2.

- [ ] **Step 5: Update CLAUDE.md**

Add a new subsection under the existing "Module 4: Meine Feuerwehr" section (after the "Heimatfeuerwehr V3" paragraph), documenting: the compact Fuhrpark widget (native GET form, no client JS needed), the `Event.vehicleBookingId` sync + protection (page-level + server-action-level), the shared `VehicleBookingIcon`, the new admin all-bookings section, and the nav bugfix — written in the same style/depth as the existing V3 documentation in that file (see the file for the exact tone and level of detail to match).

- [ ] **Step 6: Stage everything and confirm before committing**

```bash
git status --short
```

Then use `AskUserQuestion` to confirm before the final commit/push, summarizing what was verified live (per Step 2) — **do not skip this**, and **do not forget the actual `git push` afterward** (this exact mistake happened once already this session).

- [ ] **Step 7: Commit and push**

```bash
git add CLAUDE.md
git commit -m "Document Heimatfeuerwehr V4: Fuhrpark widget, Kalender-Sync, admin bookings, nav fix"
git push origin main
```
