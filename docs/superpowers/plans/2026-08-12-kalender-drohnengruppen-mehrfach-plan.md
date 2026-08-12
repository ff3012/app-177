# Kalender: Mehrere Drohnengruppen + Bezirksweiter Termin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Kalender module handle all 4 `DroneGroup` rows (not just the hardcoded "AFKDO Purkersdorf" one a user happens to belong to) and add a district-wide ("bezirksweit") Drohnengruppen event type, visible to every drone-group member across all 4 groups, creatable/editable only by a Bezirksadmin or Bezirks-Drohnenadmin.

**Architecture:** No schema/migration changes. `Event.droneGroupId` stays nullable exactly as it is today; a `DROHNENGRUPPE`-category event with `droneGroupId = null` now means "bezirksweit, alle 4 Gruppen" — the same null-sentinel pattern `NewsMessage.audienceDroneGroupId` already uses. `Event.category`'s visibility/authorization rule becomes independent of `organizationId`/`isSectionWide` (which stay Abschnitt-scoped, ALLGEMEIN-only concepts): a new `canManageEvent` helper in `permissions.ts` centralizes create/edit/delete authorization so the three call sites (Server Actions, the calendar list page, the detail page) can't drift apart again. `organizationId`/`isSectionWide` on a `DROHNENGRUPPE` event become server-derived, not form-submitted.

**Tech Stack:** Next.js App Router Server Components/Actions, Prisma, zod, react-hook-form. No new dependencies.

**Design doc:** `docs/superpowers/specs/2026-08-12-kalender-drohnengruppen-mehrfach-design.md` (approved). This plan implements it task-by-task; read the design doc for the *why* behind each rule if a step's reasoning is unclear.

## Global Constraints

- **No Prisma schema change, no migration.** `Event.droneGroupId` is already nullable; reusing `null` for "bezirksweit" needs zero DB changes.
- **The existing Feuerwehr-Admin ALLGEMEIN-category flow must stay behaviorally unchanged** (Requirement 4 of the design doc): a plain Feuerwehr-Admin (only `feuerwehrAdminOrgIds`, no drone rights) must still see exactly the same Organisation dropdown, exactly the same Abschnitt-weit checkbox behavior, and exactly the same "create/edit/delete only for my own org(s)" enforcement as before this plan. Every task below that touches a file also touched by the ALLGEMEIN path calls this out explicitly.
- **Drohnengruppen-event creation/edit is admin-only**, never "any member of the group": use `canManageDroneGroupFor` (specific group) / a new `canManageBezirksWideDroneEvent` (bezirksweit), never the old "own membership" shortcut.
- **No test suite in this repo** (confirmed in root `CLAUDE.md`). Verify each task with `npx tsc --noEmit` (zero new errors) plus a manual check — either a standalone Node script against the dev database, or exercising the actual page/Server Action through the dev server. Steps below spell out the concrete check per task.
- **German UI copy**, matching the existing tone in `event-form.tsx`/`kalender/*` (short, direct, no exclamation marks).
- All file paths below are relative to the repo root.

---

### Task 1: `permissions.ts` — category-first `canViewEvent`, new `canManageBezirksWideDroneEvent` + `canManageEvent`

**Files:**
- Modify: `src/lib/auth/permissions.ts:128-153` (the `canViewEvent` doc-comment + function body), and insert two new exported functions after `canManageDroneGroupFor` (currently ending at line 101).

**Interfaces:**
- Produces: `canManageBezirksWideDroneEvent(user: SessionUser): boolean`
- Produces: `canManageEvent(user: SessionUser, event: { organizationId: string; category: string; droneGroupId: string | null }, droneGroup: { id: string; organizationId: string } | null): boolean`
- Modifies (signature unchanged, behavior changed): `canViewEvent(user: SessionUser, event: { organizationId: string; isSectionWide: boolean; category: string; eventAbschnittOrganizationId: string; droneGroupId: string | null }): boolean`
- Consumes: `isBezirksAdmin`, `canManageDroneGroupFor`, `canManageEventsFor`, `canViewDroneModule` — all already defined earlier in this same file.

- [ ] **Step 1: Add `canManageBezirksWideDroneEvent` right after `canManageDroneGroupFor` (after line 101)**

```ts
/**
 * Darf den bezirksweiten Drohnengruppen-Termin (droneGroupId === null, sichtbar für alle 4 Gruppen)
 * anlegen/bearbeiten/löschen: nur Bezirksadmin oder Bezirks-Drohnenadmin - bewusst kein
 * Abschnittsadmin und kein einzelner Admin Drohnengruppe, weil der Termin über die Grenzen einer
 * einzelnen Gruppe/eines einzelnen Abschnitts hinausgeht.
 */
export function canManageBezirksWideDroneEvent(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
}

/**
 * Einheitliche Anlegen/Bearbeiten/Löschen-Berechtigung für einen Termin - kategorieabhängig:
 * - Kategorie DROHNENGRUPPE, droneGroupId gesetzt: nur canManageDroneGroupFor der jeweiligen Gruppe
 *   (bewusst NICHT die bloße eigene Mitgliedschaft - ein einfaches Mitglied/Pilot ohne Admin-Rolle
 *   soll hierüber keine Termine anlegen dürfen, siehe Design-Spec Abschnitt 4.2).
 * - Kategorie DROHNENGRUPPE, droneGroupId null (bezirksweit): nur canManageBezirksWideDroneEvent.
 * - Kategorie ALLGEMEIN: unverändert canManageEventsFor - dieser Zweig darf durch die
 *   Drohnengruppen-Erweiterung nicht angefasst werden, ein Feuerwehr-Admin verwaltet weiterhin
 *   ausschließlich Termine der eigenen Feuerwehr(en).
 * `droneGroup` muss der Aufrufer selbst laden (null, wenn droneGroupId null ist oder die Gruppe aus
 * irgendeinem Grund nicht mehr existiert) - diese Funktion hat keinen DB-Zugriff.
 */
export function canManageEvent(
  user: SessionUser,
  event: { organizationId: string; category: string; droneGroupId: string | null },
  droneGroup: { id: string; organizationId: string } | null,
): boolean {
  if (event.category === 'DROHNENGRUPPE') {
    if (event.droneGroupId === null) return canManageBezirksWideDroneEvent(user);
    return droneGroup !== null && canManageDroneGroupFor(user, droneGroup);
  }
  return canManageEventsFor(user, event.organizationId);
}
```

- [ ] **Step 2: Replace `canViewEvent`'s doc-comment + body (lines 128-153) to check category first**

Replace:

```ts
/**
 * Sichtbarkeit eines einzelnen Termins - identische Regel wie die Kalenderübersicht-Query selbst
 * (eigene Feuerwehr ODER abschnittsweit INNERHALB DES EIGENEN ABSCHNITTS; Drohnengruppe-Kategorie
 * zusätzlich nur mit Modulzugriff). `eventAbschnittOrganizationId` muss der Aufrufer selbst via
 * getAbschnittOrganizationId(event.organization) berechnen - diese Funktion hat keinen DB-Zugriff.
 * Muss bei einer Änderung der Sichtbarkeitsregel in kalender/page.tsx mitgezogen werden.
 */
export function canViewEvent(
  user: SessionUser,
  event: {
    organizationId: string;
    isSectionWide: boolean;
    category: string;
    eventAbschnittOrganizationId: string;
    droneGroupId: string | null;
  },
): boolean {
  const visible =
    event.organizationId === user.homeOrganizationId ||
    (event.isSectionWide && event.eventAbschnittOrganizationId === user.homeAbschnittOrganizationId);
  if (!visible) return false;
  if (event.category === 'DROHNENGRUPPE') {
    return canViewDroneModule(user) && event.droneGroupId === user.droneGroupId;
  }
  return true;
}
```

with:

```ts
/**
 * Sichtbarkeit eines einzelnen Termins - kategorieabhängig, identische Regel wie die
 * Kalenderübersicht-Query selbst (muss bei einer Änderung hier immer mitgezogen werden,
 * siehe kalender/page.tsx):
 * - Kategorie DROHNENGRUPPE ist VÖLLIG UNABHÄNGIG von organizationId/isSectionWide (die für
 *   Drohnengruppen-Termine nur noch serverseitig abgeleitete, technische Werte sind, siehe
 *   kalender/actions.ts) - sichtbar mit Modulzugriff UND (droneGroupId null [bezirksweit, alle 4
 *   Gruppen] ODER droneGroupId exakt die eigene Gruppe).
 * - Kategorie ALLGEMEIN bleibt bei der alten Regel: eigene Feuerwehr ODER abschnittsweit
 *   innerhalb des eigenen Abschnitts. `eventAbschnittOrganizationId` muss der Aufrufer selbst via
 *   getAbschnittOrganizationId(event.organization) berechnen - diese Funktion hat keinen DB-Zugriff.
 */
export function canViewEvent(
  user: SessionUser,
  event: {
    organizationId: string;
    isSectionWide: boolean;
    category: string;
    eventAbschnittOrganizationId: string;
    droneGroupId: string | null;
  },
): boolean {
  if (event.category === 'DROHNENGRUPPE') {
    return canViewDroneModule(user) && (event.droneGroupId === null || event.droneGroupId === user.droneGroupId);
  }
  return (
    event.organizationId === user.homeOrganizationId ||
    (event.isSectionWide && event.eventAbschnittOrganizationId === user.homeAbschnittOrganizationId)
  );
}
```

- [ ] **Step 3: Verify with tsc**

Run: `npx tsc --noEmit`
Expected: the SAME set of errors as before this task (call sites in `kalender/actions.ts`/`kalender/page.tsx`/`kalender/[eventId]/page.tsx` still pass the old argument shapes to `canViewEvent`, which is unchanged, so this task alone should introduce zero new errors — `canManageEvent`/`canManageBezirksWideDroneEvent` are new exports nothing calls yet).

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/permissions.ts
git commit -m "Kalender: canViewEvent kategorieabhängig umbauen, canManageEvent/canManageBezirksWideDroneEvent hinzufügen"
```

---

### Task 2: `event.schema.ts` — allow `droneGroupId: null` for bezirksweit, make `organizationId` optional for DROHNENGRUPPE, add the sentinel constant

**Files:**
- Modify: `src/lib/validation/event.schema.ts` (full file, 50 lines — replace entirely, see below).

**Interfaces:**
- Produces: `export const BEZIRKSWEIT_DRONE_GROUP_VALUE = 'BEZIRKSWEIT'` — a string sentinel used by `<select>` elements (which can never submit a real `null`) to mean "bezirksweit"; consumed by Task 4's two page files (building `droneGroupOptions`) and by `parseEventFormData` below.
- Modifies: `eventSchema` — `organizationId` no longer has a bare `.min(1, ...)`; instead a new `.refine` requires it non-empty only when `category !== 'DROHNENGRUPPE'`. The old `.refine` requiring `droneGroupId` to be truthy for DROHNENGRUPPE is REMOVED (null is now a legitimate value for that category).
- Modifies: `parseEventFormData(formData: FormData)` — converts the `BEZIRKSWEIT_DRONE_GROUP_VALUE` sentinel (and empty string) to `null` for `droneGroupId`.
- Consumes: nothing new.

- [ ] **Step 1: Replace the full file content**

```ts
import { z } from 'zod';

export const EVENT_CATEGORIES = ['ALLGEMEIN', 'DROHNENGRUPPE'] as const;
export type EventCategoryOption = (typeof EVENT_CATEGORIES)[number];

/** Sentinel-Wert für die "Alle Drohnengruppen (bezirksweit)"-Option im Formular-<select> - ein
 * <select> kann nie ein echtes `null` übermitteln, deshalb dieser String, den parseEventFormData
 * unten wieder auf `null` zurückführt (== bezirksweit, siehe Event.droneGroupId in schema.prisma). */
export const BEZIRKSWEIT_DRONE_GROUP_VALUE = 'BEZIRKSWEIT';

export const eventSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich.').max(200),
    description: z.string().trim().max(2000).optional().or(z.literal('')),
    location: z.string().trim().max(200).optional().or(z.literal('')),
    startsAt: z.string().min(1, 'Start ist erforderlich.'),
    endsAt: z.string().min(1, 'Ende ist erforderlich.'),
    allDay: z.boolean(),
    organizationId: z.string(),
    isSectionWide: z.boolean(),
    category: z.enum(EVENT_CATEGORIES),
    droneGroupId: z.string().nullable(),
  })
  .refine((data) => new Date(data.endsAt).getTime() >= new Date(data.startsAt).getTime(), {
    message: 'Ende darf nicht vor dem Start liegen.',
    path: ['endsAt'],
  })
  .refine((data) => data.category === 'DROHNENGRUPPE' || data.organizationId.length > 0, {
    // Für Kategorie DROHNENGRUPPE wird organizationId serverseitig abgeleitet (siehe
    // kalender/actions.ts) - das Formular blendet die Organisation-Auswahl für diese Kategorie aus
    // (siehe event-form.tsx), ein leerer Wert ist dort also erwartet, nicht fehlerhaft.
    message: 'Organisation ist erforderlich.',
    path: ['organizationId'],
  });
// Absichtlich KEIN .refine mehr, das droneGroupId für Kategorie DROHNENGRUPPE als truthy verlangt:
// `droneGroupId === null` ist für diese Kategorie jetzt ein gültiger, eigener Zustand ("bezirksweit,
// alle 4 Gruppen" - siehe Design-Spec), kein fehlender Pflichtwert mehr.

export type EventInput = z.infer<typeof eventSchema>;

export function parseEventFormData(formData: FormData) {
  const rawCategory = String(formData.get('category') ?? 'ALLGEMEIN');
  const rawDroneGroupId = String(formData.get('droneGroupId') ?? '');
  return {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    location: String(formData.get('location') ?? ''),
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
    allDay: formData.get('allDay') === 'on',
    organizationId: String(formData.get('organizationId') ?? ''),
    isSectionWide: formData.get('isSectionWide') === 'on',
    category: (EVENT_CATEGORIES as readonly string[]).includes(rawCategory)
      ? (rawCategory as EventCategoryOption)
      : 'ALLGEMEIN',
    droneGroupId: rawDroneGroupId && rawDroneGroupId !== BEZIRKSWEIT_DRONE_GROUP_VALUE ? rawDroneGroupId : null,
  };
}
```

- [ ] **Step 2: Verify with tsc**

Run: `npx tsc --noEmit`
Expected: no new errors (the `EventInput` type is unchanged in shape — `organizationId` is still `string`, just without the runtime min-length baked into the base schema; `droneGroupId` was already `string | null`).

- [ ] **Step 3: Manual check — confirm the ALLGEMEIN regression guard directly against the schema**

Run this one-off script with `npx tsx`:

```ts
// scratch check, not committed
import { eventSchema } from './src/lib/validation/event.schema';

const allgemeinMissingOrg = eventSchema.safeParse({
  title: 'Test', description: '', location: '', startsAt: '2026-09-01T10:00', endsAt: '2026-09-01T11:00',
  allDay: false, organizationId: '', isSectionWide: false, category: 'ALLGEMEIN', droneGroupId: null,
});
console.log('ALLGEMEIN ohne organizationId (muss fehlschlagen):', allgemeinMissingOrg.success);

const droneBezirksweit = eventSchema.safeParse({
  title: 'Test', description: '', location: '', startsAt: '2026-09-01T10:00', endsAt: '2026-09-01T11:00',
  allDay: false, organizationId: '', isSectionWide: false, category: 'DROHNENGRUPPE', droneGroupId: null,
});
console.log('DROHNENGRUPPE bezirksweit ohne organizationId (muss erfolgreich sein):', droneBezirksweit.success);
```

Expected output: `false` then `true`. Delete the script afterward.

- [ ] **Step 4: Commit**

```bash
git add src/lib/validation/event.schema.ts
git commit -m "Kalender: droneGroupId=null als bezirksweit zulassen, organizationId nur für ALLGEMEIN Pflichtfeld"
```

---

### Task 3: `event-form.tsx` — hide Organisation/Abschnitt-weit for DROHNENGRUPPE, fix the Kategorie-switcher's visibility, default new pure-drone-admin submissions to DROHNENGRUPPE

**Files:**
- Modify: `src/components/calendar/event-form.tsx` (full file, 245 lines — replace entirely, see below).

**Interfaces:**
- Consumes: `EVENT_CATEGORIES`, `eventSchema`, `EventInput` from `@/lib/validation/event.schema` (unchanged import, no new import needed — this component intentionally stays unaware of `BEZIRKSWEIT_DRONE_GROUP_VALUE`; it treats `droneGroupOptions` as an opaque `{id, name}[]` list, and Task 4's pages are responsible for including the sentinel entry when relevant).
- Unchanged props: `EventFormProps` (`organizations`, `canSectionWide`, `droneGroupOptions`, `defaultValues`, `action`, `submitLabel`).

- [ ] **Step 1: Replace the full file content**

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { EVENT_CATEGORIES, eventSchema, type EventInput } from '@/lib/validation/event.schema';
import { DateTime15MinInput } from '@/components/ui/datetime-15min-input';
import type { EventFormState } from '@/app/(app)/kalender/actions';

interface OrganizationOption {
  id: string;
  name: string;
  type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO';
}

interface DroneGroupOption {
  id: string;
  name: string;
}

interface EventFormProps {
  organizations: OrganizationOption[];
  canSectionWide: boolean;
  droneGroupOptions: DroneGroupOption[];
  defaultValues?: Partial<EventInput>;
  action: (prevState: EventFormState, formData: FormData) => Promise<EventFormState>;
  submitLabel: string;
}

export function EventForm({
  organizations,
  canSectionWide,
  droneGroupOptions,
  defaultValues,
  action,
  submitLabel,
}: EventFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<EventInput>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      title: '',
      description: '',
      location: '',
      startsAt: '',
      endsAt: '',
      allDay: false,
      organizationId: organizations[0]?.id ?? '',
      isSectionWide: false,
      // Ein Nutzer ohne jede eigene Feuerwehr-Admin-Mitgliedschaft (reiner Bezirksadmin/Bezirks-
      // Drohnenadmin/Admin Drohnengruppe) hat organizations=[] - für den ist "Allgemein" gar keine
      // sinnvolle Standardauswahl (leeres Organisation-<select>), "Drohnengruppe" dagegen schon.
      category: organizations.length === 0 && droneGroupOptions.length > 0 ? 'DROHNENGRUPPE' : 'ALLGEMEIN',
      droneGroupId: droneGroupOptions[0]?.id ?? null,
      ...defaultValues,
    },
  });

  const selectedOrgId = watch('organizationId');
  const selectedOrg = organizations.find((org) => org.id === selectedOrgId);
  const showSectionWideOption = canSectionWide && selectedOrg?.type === 'ABSCHNITTSKOMMANDO';
  const category = watch('category');
  const startsAt = watch('startsAt');

  // "Drohnengruppe" nur als Kategorie-Option anbieten, wenn es überhaupt eine wählbare Gruppe gibt
  // (droneGroupOptions kommt bereits vorgefiltert vom Aufrufer - alle Gruppen, die dieser Nutzer
  // verwalten darf, plus ggf. der bezirksweite Sentinel-Eintrag) - sonst entstünde ein Termin ohne
  // droneGroupId, der für niemanden sichtbar wäre. Bearbeitet man einen bereits als Drohnengruppen-
  // Termin angelegten Eintrag, bleibt die Option erhalten, damit der aktuelle Wert im Select nicht
  // verlorengeht.
  const categoryOptions = EVENT_CATEGORIES.filter(
    (categoryOption) =>
      categoryOption !== 'DROHNENGRUPPE' ||
      droneGroupOptions.length > 0 ||
      defaultValues?.category === 'DROHNENGRUPPE',
  );
  // Der Kategorie-Umschalter selbst ist unabhängig von showSectionWideOption sichtbar (früher war er
  // daran gekoppelt, weil ein Drohnengruppen-Termin nur über eine als Organisation gewählte
  // Abschnittskommando-Organisation erreichbar war - das gilt nicht mehr, Drohnengruppe ist jetzt
  // eine eigenständige Kategorie unabhängig von der Organisation-Auswahl). categoryOptions.length > 1
  // heißt genau "DROHNENGRUPPE ist tatsächlich eine echte Option", da ALLGEMEIN nie herausgefiltert wird.
  const showCategorySelect = categoryOptions.length > 1;
  const isDroneCategory = category === 'DROHNENGRUPPE';

  // Ende übernimmt bei jeder Änderung von Start automatisch dessen Datum. Solange Ende noch gar
  // keine eigene Uhrzeit hat, wird zusätzlich Start + 15 Minuten als Uhrzeit vorgeschlagen; hat
  // Ende bereits eine (manuell oder zuvor automatisch gesetzte) Uhrzeit, bleibt nur das Datum synchron.
  useEffect(() => {
    if (!startsAt) return;
    const [startDate, startTime] = startsAt.split('T');
    if (!startDate || !startTime) return;

    const currentEnd = getValues('endsAt');
    const currentEndTime = currentEnd && currentEnd.includes('T') ? currentEnd.split('T')[1] : '';

    if (currentEndTime) {
      const newEnd = `${startDate}T${currentEndTime}`;
      if (newEnd !== currentEnd) setValue('endsAt', newEnd);
      return;
    }

    const suggestedEnd = new Date(`${startDate}T${startTime}`);
    suggestedEnd.setMinutes(suggestedEnd.getMinutes() + 15);
    const pad = (n: number) => String(n).padStart(2, '0');
    const newEnd = `${suggestedEnd.getFullYear()}-${pad(suggestedEnd.getMonth() + 1)}-${pad(suggestedEnd.getDate())}T${pad(suggestedEnd.getHours())}:${pad(suggestedEnd.getMinutes())}`;
    setValue('endsAt', newEnd);
  }, [startsAt, getValues, setValue]);

  function onSubmit(values: EventInput) {
    const formData = new FormData();
    formData.set('title', values.title);
    formData.set('description', values.description ?? '');
    formData.set('location', values.location ?? '');
    formData.set('startsAt', values.startsAt);
    formData.set('endsAt', values.endsAt);
    if (values.allDay) formData.set('allDay', 'on');
    formData.set('organizationId', values.organizationId);
    if (values.isSectionWide) formData.set('isSectionWide', 'on');
    formData.set('category', values.category);
    if (values.droneGroupId) formData.set('droneGroupId', values.droneGroupId);

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Titel</label>
        <input {...register('title')} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.title && <p className="text-sm text-red-700">{errors.title.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Beschreibung</label>
        <textarea {...register('description')} rows={3} className="rounded border border-neutral-300 px-3 py-2" />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Ort</label>
        <input {...register('location')} className="rounded border border-neutral-300 px-3 py-2" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Start</label>
          <Controller
            control={control}
            name="startsAt"
            render={({ field }) => <DateTime15MinInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
          />
          {errors.startsAt && <p className="text-sm text-red-700">{errors.startsAt.message}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Ende</label>
          <Controller
            control={control}
            name="endsAt"
            render={({ field }) => <DateTime15MinInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
          />
          {errors.endsAt && <p className="text-sm text-red-700">{errors.endsAt.message}</p>}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" {...register('allDay')} />
        Ganztägig
      </label>

      {!isDroneCategory && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Organisation</label>
          <select {...register('organizationId')} className="rounded border border-neutral-300 px-3 py-2">
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          {errors.organizationId && <p className="text-sm text-red-700">{errors.organizationId.message}</p>}
        </div>
      )}

      {showSectionWideOption && !isDroneCategory && (
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" {...register('isSectionWide')} />
          Abschnitt-weiter Termin (in allen Feuerwehr-Kalendern sichtbar)
        </label>
      )}

      {showCategorySelect && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Kategorie</label>
          <select {...register('category')} className="rounded border border-neutral-300 px-3 py-2">
            {categoryOptions.map((categoryOption) => (
              <option key={categoryOption} value={categoryOption}>
                {categoryOption === 'DROHNENGRUPPE' ? 'Drohnengruppe' : 'Allgemein'}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">
            Kategorie "Drohnengruppe" ist nur für Mitglieder der Drohnengruppe sichtbar.
          </p>
        </div>
      )}

      {isDroneCategory && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Drohnengruppe</label>
          <select {...register('droneGroupId')} className="rounded border border-neutral-300 px-3 py-2">
            {droneGroupOptions.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {serverError && <p className="text-sm text-red-700">{serverError}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? 'Speichern…' : submitLabel}
        </button>
        <Link href="/kalender" className="text-sm text-neutral-600 hover:underline">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
```

Notes on what changed vs. the original, and why each is safe for the ALLGEMEIN regression guard:
- The `useEffect` that force-set `isSectionWide` to `true` whenever `category === 'DROHNENGRUPPE'` is REMOVED — it's now moot because the Abschnitt-weit checkbox (and the field itself) is hidden and server-ignored for that category (Task 5 forces `isSectionWide: false` there regardless). It never ran for `category === 'ALLGEMEIN'`, so removing it doesn't touch the ALLGEMEIN path.
- `showCategorySelect` replaces the old gate (`showSectionWideOption`) on the Kategorie `<select>`. For an ALLGEMEIN-only Feuerwehr-Admin (no drone rights), `categoryOptions` was always `['ALLGEMEIN']` (length 1) regardless of the old or new gate — that user simply stops seeing a pointless single-option dropdown; their submitted `category` is still the unchanged default `'ALLGEMEIN'`.
- The Organisation `<select>` and the Abschnitt-weit checkbox are now wrapped in `!isDroneCategory` in addition to their existing conditions — for `category === 'ALLGEMEIN'` (the only category a plain Feuerwehr-Admin ever selects), `isDroneCategory` is always `false`, so both blocks render exactly as before.
- The dead `{errors.droneGroupId && ...}` paragraph is removed — after Task 2's schema change, `droneGroupId` can no longer produce a validation error (no refine references it anymore), so this branch could never fire even before this task; removing it is not a behavior change.

- [ ] **Step 2: Verify with tsc**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual check via dev server**

Start the dev server (`npm run dev`), sign in as a plain Feuerwehr-Admin test user, open `/kalender/neu`. Confirm: Organisation `<select>` is visible and populated, no Kategorie `<select>` is shown (only one category available), no Drohnengruppe `<select>`. This is the Requirement-4 regression check for this task.

- [ ] **Step 4: Commit**

```bash
git add src/components/calendar/event-form.tsx
git commit -m "Kalender-Formular: Organisation/Abschnitt-weit für Drohnengruppe-Kategorie ausblenden, Kategorie-Umschalter von Abschnitt-Auswahl entkoppeln"
```

---

### Task 4: `drone-group-options.ts` (new) + page-access widening in `kalender/neu/page.tsx` and `kalender/[eventId]/bearbeiten/page.tsx`

**Files:**
- Create: `src/lib/calendar/drone-group-options.ts`
- Modify: `src/app/(app)/kalender/neu/page.tsx` (full file, 46 lines — replace entirely)
- Modify: `src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx` (full file, 99 lines — replace entirely)

**Interfaces:**
- Produces (new file): `getManageableDroneGroupOptions(user: SessionUser): Promise<{ id: string; name: string }[]>` — all `DroneGroup` rows the user may manage (via `canManageDroneGroupFor`), plus the `BEZIRKSWEIT_DRONE_GROUP_VALUE` sentinel entry when `canManageBezirksWideDroneEvent(user)` is true.
- Consumes: `canManageDroneGroupFor`, `canManageBezirksWideDroneEvent`, `canCreateAnySectionWideEvent`, `canManageEvent`, `isBezirksAdmin`, `isDroneGroupAdmin` from `@/lib/auth/permissions`; `BEZIRKSWEIT_DRONE_GROUP_VALUE` from `@/lib/validation/event.schema`; `prisma.droneGroup` (fields `id`, `name`, `organizationId`).

- [ ] **Step 1: Create `src/lib/calendar/drone-group-options.ts`**

```ts
import { prisma } from '@/lib/db/prisma';
import { canManageBezirksWideDroneEvent, canManageDroneGroupFor } from '@/lib/auth/permissions';
import { BEZIRKSWEIT_DRONE_GROUP_VALUE } from '@/lib/validation/event.schema';
import type { SessionUser } from '@/types/next-auth';

export interface DroneGroupFormOption {
  id: string;
  name: string;
}

/**
 * Drohnengruppen, für die dieser Nutzer im Kalender-Formular einen Termin anlegen/bearbeiten darf.
 * Lädt alle 4 Gruppen und filtert einzeln über canManageDroneGroupFor (bewusst nicht mehr nur die
 * eigene Mitgliedschaft - siehe canManageEvent in permissions.ts und Design-Spec Abschnitt 4.2).
 * Ergänzt am Ende den bezirksweiten Sentinel-Eintrag, wenn der Nutzer den bezirksweiten
 * Drohnengruppen-Termin anlegen darf (Bezirksadmin/Bezirks-Drohnenadmin).
 */
export async function getManageableDroneGroupOptions(user: SessionUser): Promise<DroneGroupFormOption[]> {
  const groups = await prisma.droneGroup.findMany({
    select: { id: true, name: true, organizationId: true },
    orderBy: { name: 'asc' },
  });
  const options: DroneGroupFormOption[] = groups
    .filter((group) => canManageDroneGroupFor(user, group))
    .map((group) => ({ id: group.id, name: group.name }));
  if (canManageBezirksWideDroneEvent(user)) {
    options.push({ id: BEZIRKSWEIT_DRONE_GROUP_VALUE, name: 'Alle Drohnengruppen (bezirksweit)' });
  }
  return options;
}
```

- [ ] **Step 2: Replace `src/app/(app)/kalender/neu/page.tsx`**

```tsx
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canCreateAnySectionWideEvent, isBezirksAdmin, isDroneGroupAdmin } from '@/lib/auth/permissions';
import { getManageableDroneGroupOptions } from '@/lib/calendar/drone-group-options';
import { EventForm } from '@/components/calendar/event-form';
import { createEvent } from '../actions';

export default async function NeuerTerminPage({
  searchParams,
}: {
  searchParams: Promise<{ sectionWide?: string }>;
}) {
  const user = await requireUser();

  // Erweitert gegenüber vorher (nur feuerwehrAdminOrgIds.length > 0): ein reiner Admin Drohnengruppe
  // oder ein reiner Bezirksadmin/Bezirks-Drohnenadmin ohne eigene Feuerwehr-Admin-Mitgliedschaft muss
  // diese Seite ebenfalls erreichen können, um einen Drohnengruppen- bzw. bezirksweiten Termin
  // anzulegen (siehe Design-Spec Requirement 3). Ein plain Feuerwehr-Admin bleibt unverändert erlaubt.
  const canReachPage =
    user.feuerwehrAdminOrgIds.length > 0 || isDroneGroupAdmin(user) || isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
  if (!canReachPage) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, Termine anzulegen.</p>;
  }

  const { sectionWide } = await searchParams;
  const canSectionWide = canCreateAnySectionWideEvent(user);

  const [organizations, droneGroupOptions] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: user.feuerwehrAdminOrgIds } },
      orderBy: { name: 'asc' },
    }),
    getManageableDroneGroupOptions(user),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Neuer Termin</h1>
      <EventForm
        organizations={organizations}
        canSectionWide={canSectionWide}
        droneGroupOptions={droneGroupOptions}
        action={createEvent}
        submitLabel="Termin anlegen"
        defaultValues={canSectionWide && sectionWide === '1' ? { isSectionWide: true } : undefined}
      />
    </div>
  );
}
```

- [ ] **Step 3: Replace `src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx`**

```tsx
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canCreateAnySectionWideEvent, canManageEvent } from '@/lib/auth/permissions';
import { getManageableDroneGroupOptions } from '@/lib/calendar/drone-group-options';
import { BEZIRKSWEIT_DRONE_GROUP_VALUE } from '@/lib/validation/event.schema';
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

  // Vorher: canManageEventsFor(user, event.organizationId) - das war für Drohnengruppen-Termine
  // falsch (blockte jeden Admin Drohnengruppe ohne eigene Feuerwehr-Admin-Mitgliedschaft von seinen
  // EIGENEN Gruppen-Terminen). canManageEvent verzweigt jetzt korrekt nach event.category.
  const droneGroup =
    event.category === 'DROHNENGRUPPE' && event.droneGroupId
      ? await prisma.droneGroup.findUnique({
          where: { id: event.droneGroupId },
          select: { id: true, organizationId: true },
        })
      : null;
  if (!canManageEvent(user, event, droneGroup)) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, diesen Termin zu bearbeiten.</p>;
  }
  if (event.vehicleBookingId) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">Termin bearbeiten</h1>
        <p className="text-neutral-700">
          Dieser Termin gehört zu einer Fahrzeug-Reservierung. Um ihn zu ändern oder zu stornieren, gehe zu{' '}
          <Link href="/meine-feuerwehr" className="text-brand hover:underline">
            Meine Feuerwehr
          </Link>
          .
        </p>
      </div>
    );
  }
  if (event.icsUid) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">Termin bearbeiten</h1>
        <p className="text-neutral-700">
          Dieser Termin stammt aus einem importierten Kalender (Verwaltung → Heimatfeuerwehr) und wird
          automatisch mit der Quelle synchronisiert. Änderungen sind nur im Quellkalender möglich.
        </p>
      </div>
    );
  }

  const [organizations, droneGroupOptions] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: user.feuerwehrAdminOrgIds } },
      orderBy: { name: 'asc' },
    }),
    getManageableDroneGroupOptions(user),
  ]);

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
        canSectionWide={canCreateAnySectionWideEvent(user)}
        droneGroupOptions={droneGroupOptions}
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
          droneGroupId: event.droneGroupId ?? (event.category === 'DROHNENGRUPPE' ? BEZIRKSWEIT_DRONE_GROUP_VALUE : null),
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

Regression note for both pages: for a plain Feuerwehr-Admin, `canReachPage`/`canManageEvent` still resolve identically to the old `feuerwehrAdminOrgIds.length > 0`/`canManageEventsFor(...)` checks, since none of `isDroneGroupAdmin`/`isBezirksAdmin`/`user.isBezirksDrohnenAdmin` apply to them and `canManageEvent`'s `ALLGEMEIN` branch is a direct call to the untouched `canManageEventsFor`.

- [ ] **Step 4: Verify with tsc**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual check via dev server**

Using 4 test accounts (one per `DroneGroup`, each with `droneGroupRole: 'ADMIN'`), open `/kalender/neu` as each — confirm the Drohnengruppe `<select>` shows exactly that user's own group (not the other 3). Then log in as the Bezirksadmin/Bezirks-Drohnenadmin seeded account and confirm the dropdown shows all 4 groups plus "Alle Drohnengruppen (bezirksweit)". Then log in as a plain Feuerwehr-Admin test user with zero drone rights and confirm `/kalender/neu` still shows the Organisation-based form exactly as before (Requirement-4 check).

- [ ] **Step 6: Commit**

```bash
git add src/lib/calendar/drone-group-options.ts "src/app/(app)/kalender/neu/page.tsx" "src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx"
git commit -m "Kalender: droneGroupOptions auf alle verwaltbaren Gruppen + bezirksweit erweitern, Seitenzugriff für reine Drohnengruppen-/Bezirksadmins öffnen"
```

---

### Task 5: `kalender/actions.ts` — restructure `createEvent`/`updateEvent`/`deleteEvent` for the DROHNENGRUPPE category

**Files:**
- Modify: `src/app/(app)/kalender/actions.ts` (full file, 185 lines — replace entirely).

**Interfaces:**
- Consumes: `canManageEvent` (new, from Task 1), `canManageEventsFor`, `canCreateSectionWideEvent`, `assertPermission` from `@/lib/auth/permissions`; `eventSchema`, `parseEventFormData` from `@/lib/validation/event.schema`; `prisma.droneGroup.findUnique({ select: { id: true, organizationId: true } })`.
- Removed: the `assertMayUseDroneGroup` helper and the `canManageDroneGroupFor`/`SessionUser` imports it alone needed — superseded by `canManageEvent`.
- Unchanged: `EventFormState`, `revalidateCalendars`, `resolveAbschnittOrganizationId` (still used by the ALLGEMEIN `isSectionWide` branch).

- [ ] **Step 1: Replace the full file content**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateSectionWideEvent, canManageEvent, canManageEventsFor } from '@/lib/auth/permissions';
import { eventSchema, parseEventFormData } from '@/lib/validation/event.schema';
import { deleteEventFromGoogleCalendar, pushEventToGoogleCalendar } from '@/lib/calendar/google-calendar-push';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';

export interface EventFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

function revalidateCalendars() {
  revalidatePath('/kalender');
}

/** Der Abschnitt, in dem ein Termin dieser besitzenden Organisation abschnittsweit sichtbar wäre. */
async function resolveAbschnittOrganizationId(organizationId: string): Promise<string> {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { id: true, type: true, parentId: true },
  });
  return getAbschnittOrganizationId(organization);
}

/** Lädt die Drohnengruppe für eine (ggf. null) droneGroupId - null bleibt null (bezirksweit),
 * eine gesetzte id, die nicht mehr existiert, wird ebenfalls zu null (canManageEvent lehnt das dann
 * über den droneGroup===null-Zweig ab, statt mit einem ungefangenen Fehler abzubrechen). */
async function loadDroneGroup(droneGroupId: string | null) {
  if (!droneGroupId) return null;
  return prisma.droneGroup.findUnique({ where: { id: droneGroupId }, select: { id: true, organizationId: true } });
}

export async function createEvent(_prevState: EventFormState, formData: FormData): Promise<EventFormState> {
  const user = await requireUser();
  const parsed = eventSchema.safeParse(parseEventFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.category === 'DROHNENGRUPPE') {
    const droneGroup = await loadDroneGroup(data.droneGroupId);
    if (!canManageEvent(user, data, droneGroup)) {
      return { error: 'Keine Berechtigung, für diese Drohnengruppe Termine anzulegen.' };
    }

    // organizationId/isSectionWide sind für diese Kategorie keine Formularfelder mehr (siehe
    // event-form.tsx) - serverseitig abgeleitet: die Organisation der Gruppe, oder bei bezirksweit
    // (droneGroupId null) der Abschnitt des anlegenden Nutzers, rein als technischer FK-Wert, nicht
    // als Sichtbarkeitskriterium (siehe canViewEvent, das für DROHNENGRUPPE beide Felder ignoriert).
    const organizationId = droneGroup ? droneGroup.organizationId : user.homeAbschnittOrganizationId;

    const created = await prisma.event.create({
      data: {
        title: data.title,
        description: data.description || null,
        location: data.location || null,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        allDay: data.allDay,
        organizationId,
        isSectionWide: false,
        category: data.category,
        droneGroupId: data.droneGroupId,
        createdById: user.id,
      },
    });
    await pushEventToGoogleCalendar(created);

    revalidateCalendars();
    redirect('/kalender');
  }

  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide) {
    const abschnittOrganizationId = await resolveAbschnittOrganizationId(data.organizationId);
    if (!canCreateSectionWideEvent(user, abschnittOrganizationId)) {
      return { error: 'Keine Berechtigung für Abschnitt-weite Termine in diesem Abschnitt.' };
    }
  }

  const created = await prisma.event.create({
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
      droneGroupId: null,
      createdById: user.id,
    },
  });
  await pushEventToGoogleCalendar(created);

  revalidateCalendars();
  redirect('/kalender');
}

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

  if (existing.category === 'DROHNENGRUPPE') {
    const existingDroneGroup = await loadDroneGroup(existing.droneGroupId);
    assertPermission(canManageEvent(user, existing, existingDroneGroup));
  } else {
    assertPermission(canManageEventsFor(user, existing.organizationId));
    if (existing.isSectionWide) {
      const existingAbschnittOrganizationId = await resolveAbschnittOrganizationId(existing.organizationId);
      if (!canCreateSectionWideEvent(user, existingAbschnittOrganizationId)) {
        return { error: 'Keine Berechtigung, diesen Abschnitt-weiten Termin zu bearbeiten.' };
      }
    }
  }
  if (existing.vehicleBookingId) {
    return { error: 'Dieser Termin gehört zu einer Fahrzeug-Reservierung und kann hier nicht bearbeitet werden.' };
  }
  if (existing.icsUid) {
    return { error: 'Dieser Termin stammt aus einem importierten Kalender und kann hier nicht bearbeitet werden.' };
  }

  const parsed = eventSchema.safeParse(parseEventFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.category === 'DROHNENGRUPPE') {
    const droneGroup = await loadDroneGroup(data.droneGroupId);
    if (!canManageEvent(user, data, droneGroup)) {
      return { error: 'Keine Berechtigung, für diese Drohnengruppe Termine anzulegen.' };
    }

    const organizationId = droneGroup ? droneGroup.organizationId : user.homeAbschnittOrganizationId;
    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        title: data.title,
        description: data.description || null,
        location: data.location || null,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        allDay: data.allDay,
        organizationId,
        isSectionWide: false,
        category: data.category,
        droneGroupId: data.droneGroupId,
      },
    });
    await pushEventToGoogleCalendar(updated);

    revalidateCalendars();
    redirect('/kalender');
  }

  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide) {
    const abschnittOrganizationId = await resolveAbschnittOrganizationId(data.organizationId);
    if (!canCreateSectionWideEvent(user, abschnittOrganizationId)) {
      return { error: 'Keine Berechtigung für Abschnitt-weite Termine in diesem Abschnitt.' };
    }
  }

  const updated = await prisma.event.update({
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
      droneGroupId: null,
    },
  });
  await pushEventToGoogleCalendar(updated);

  revalidateCalendars();
  redirect('/kalender');
}

export async function deleteEvent(eventId: string): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) {
    redirect('/kalender');
  }

  if (existing.category === 'DROHNENGRUPPE') {
    const droneGroup = await loadDroneGroup(existing.droneGroupId);
    assertPermission(canManageEvent(user, existing, droneGroup));
  } else {
    assertPermission(canManageEventsFor(user, existing.organizationId));
    if (existing.isSectionWide) {
      const abschnittOrganizationId = await resolveAbschnittOrganizationId(existing.organizationId);
      assertPermission(canCreateSectionWideEvent(user, abschnittOrganizationId));
    }
  }
  assertPermission(
    !existing.vehicleBookingId,
    'Dieser Termin gehört zu einer Fahrzeug-Reservierung und kann hier nicht gelöscht werden.',
  );
  assertPermission(
    !existing.icsUid,
    'Dieser Termin stammt aus einem importierten Kalender und kann hier nicht gelöscht werden.',
  );

  await deleteEventFromGoogleCalendar(existing);
  await prisma.event.delete({ where: { id: eventId } });
  revalidateCalendars();
  redirect('/kalender');
}
```

Regression note: every ALLGEMEIN-category branch above (the code after the `if (data.category === 'DROHNENGRUPPE') { ...; redirect(...) }` early-exit in `createEvent`/`updateEvent`, and the `else` branch in `updateEvent`/`deleteEvent`'s permission check) is byte-for-byte the pre-existing logic, just reached via an added `if`/`else` rather than running unconditionally — same checks, same order, same error messages, same Prisma payload shape for a plain Feuerwehr-Admin's ALLGEMEIN event.

- [ ] **Step 2: Verify with tsc**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual check via dev server — the 4 authorization edges from the design doc**

As the dev server runs, exercise these cases (using the same test accounts from Task 4, Step 5):
1. A group-1 Admin Drohnengruppe creates a `DROHNENGRUPPE` event picking group 1 → succeeds; the created `Event.organizationId` equals group 1's `DroneGroup.organizationId`, `isSectionWide` is `false`.
2. That same group-1 admin tries to create one picking group 2 (only possible by tampering with the submitted `droneGroupId`, e.g. via a raw `fetch` POST to the Server Action, since the UI dropdown never offers group 2) → rejected with "Keine Berechtigung, für diese Drohnengruppe Termine anzulegen."
3. The Bezirksadmin/Bezirks-Drohnenadmin test account creates a bezirksweit event (droneGroupId sentinel) → succeeds; `Event.droneGroupId` is `null` in the DB.
4. A plain Feuerwehr-Admin creates/edits/deletes an ALLGEMEIN event for their own org exactly as before (Requirement-4 check) → succeeds unchanged; the same admin attempting another org's event is still rejected the same way as before this plan.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/kalender/actions.ts"
git commit -m "Kalender: createEvent/updateEvent/deleteEvent für Kategorie DROHNENGRUPPE über canManageEvent absichern, organizationId/isSectionWide serverseitig ableiten"
```

---

### Task 6: `CalendarEventInput` + `kalender/page.tsx` — fetch/filter/editable fix so bezirksweite und fremde-Feuerwehr-Drohnengruppen-Termine überhaupt geladen werden

**Files:**
- Modify: `src/components/calendar/calendar-view.tsx:15-31` (the `CalendarEventInput` interface only).
- Modify: `src/app/(app)/kalender/page.tsx` (full file, 135 lines — replace entirely).

**Interfaces:**
- Modifies: `CalendarEventInput` — adds `isDistrictWideDrone?: boolean` (same optional-boolean convention as the existing `isVehicleBooking?: boolean`). Consumed by Task 8's label rendering in `event-list-view.tsx` and `kalender/[eventId]/page.tsx`.
- Consumes: `canManageEvent`, `canViewDroneModule`, `isBezirksAdmin`, `isDroneGroupAdmin` from `@/lib/auth/permissions`.

- [ ] **Step 1: Add the new field to `CalendarEventInput` in `calendar-view.tsx`**

In the interface (currently lines 15-31), add one line right after `isVehicleBooking?: boolean;`:

```ts
  isVehicleBooking?: boolean;
  isDistrictWideDrone?: boolean;
```

- [ ] **Step 2: Replace the full file content of `kalender/page.tsx`**

```tsx
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageEvent, canViewDroneModule, isBezirksAdmin, isDroneGroupAdmin } from '@/lib/auth/permissions';
import { KalenderWithLayers, type CalendarLayer, type IcsLink } from '@/components/calendar/kalender-with-layers';
import type { CalendarEventInput } from '@/components/calendar/calendar-view';
import { LAYER_COLORS } from '@/lib/calendar/layer-colors';
import { LEGACY_COMBINED_ICS_ABSCHNITT_NUMMER } from '@/lib/organizations/abschnitt';
import { CollapsingPageTitle } from '@/components/layout/collapsing-page-title';

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

export default async function KalenderPage() {
  const user = await requireUser();
  // Vorab berechnet (statt wie vorher erst nach der Event-Query), weil die Query selbst jetzt eine
  // dritte, drohnengruppen-eigene OR-Bedingung braucht - ohne die würde ein bezirksweiter oder ein
  // Termin einer fremden (Abschnitt-)Feuerwehr innerhalb der eigenen Drohnengruppe gar nicht erst aus
  // der DB geladen, unabhängig vom späteren .filter().
  const canSeeDroneCategory = canViewDroneModule(user);

  const [organization, homeAbschnitt, allEvents, droneGroups] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.homeOrganizationId } }),
    prisma.organization.findUnique({
      where: { id: user.homeAbschnittOrganizationId },
      select: { nummer: true },
    }),
    prisma.event.findMany({
      where: {
        OR: [
          { organizationId: user.homeOrganizationId },
          {
            isSectionWide: true,
            organization: {
              OR: [{ id: user.homeAbschnittOrganizationId }, { parentId: user.homeAbschnittOrganizationId }],
            },
          },
          // Drohnengruppen-Termine sind komplett unabhängig von Organisation/Abschnitt sichtbar (siehe
          // canViewEvent) - eigene Gruppe ODER bezirksweit (droneGroupId null), unabhängig davon, bei
          // welcher Feuerwehr/Abschnitt das Event technisch "organizationId" trägt.
          ...(canSeeDroneCategory
            ? [{ category: 'DROHNENGRUPPE' as const, OR: [{ droneGroupId: user.droneGroupId }, { droneGroupId: null }] }]
            : []),
        ],
      },
      include: { organization: true },
      orderBy: { startsAt: 'asc' },
    }),
    // Nur für die editable-Berechnung unten gebraucht (canManageEvent braucht die organizationId der
    // JEWEILIGEN Gruppe eines Events, nicht die des Events selbst - bei bezirksweiten Terminen weichen
    // die ab). Wird nur geladen, wenn überhaupt Drohnengruppen-Termine sichtbar sein können.
    canSeeDroneCategory
      ? prisma.droneGroup.findMany({ select: { id: true, organizationId: true } })
      : Promise.resolve([]),
  ]);

  const droneGroupsById = new Map(droneGroups.map((group) => [group.id, group]));

  const eventIds = allEvents.map((event) => event.id);
  const [rsvpGroups, ownRsvps] = await Promise.all([
    eventIds.length > 0
      ? prisma.terminZusage.groupBy({ by: ['eventId', 'status'], where: { eventId: { in: eventIds } }, _count: true })
      : Promise.resolve([]),
    eventIds.length > 0
      ? prisma.terminZusage.findMany({
          where: { eventId: { in: eventIds }, userId: user.id },
          select: { eventId: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  const rsvpCountsByEvent = new Map<string, { ZUGESAGT: number; ABGESAGT: number; UNKLAR: number }>();
  for (const group of rsvpGroups) {
    const counts = rsvpCountsByEvent.get(group.eventId) ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 };
    counts[group.status] = group._count;
    rsvpCountsByEvent.set(group.eventId, counts);
  }
  const myRsvpByEvent = new Map(ownRsvps.map((rsvp) => [rsvp.eventId, rsvp.status]));

  // Erweitert gegenüber vorher (nur feuerwehrAdminOrgIds.length > 0), analog zur Zugriffsprüfung in
  // kalender/neu/page.tsx: ein reiner Admin Drohnengruppe oder ein reiner Bezirksadmin/Bezirks-
  // Drohnenadmin ohne eigene Feuerwehr-Admin-Mitgliedschaft muss den "Neuer Termin"-Button ebenfalls
  // sehen. Ein plain Feuerwehr-Admin bleibt unverändert erlaubt.
  const canCreateAnyEvent =
    user.feuerwehrAdminOrgIds.length > 0 || isDroneGroupAdmin(user) || isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;

  const layers: CalendarLayer[] = [
    { key: 'own', label: 'Meine Feuerwehr' },
    { key: 'abschnitt', label: 'Abschnitt-Kalender' },
  ];
  if (canSeeDroneCategory) {
    layers.push({ key: 'drohnengruppe', label: 'Drohnengruppe' });
  }

  const calendarEvents: CalendarEventInput[] = allEvents
    .filter(
      (event) =>
        event.category !== 'DROHNENGRUPPE' ||
        (canSeeDroneCategory && (event.droneGroupId === null || event.droneGroupId === user.droneGroupId)),
    )
    .map((event) => {
      const layer = event.category === 'DROHNENGRUPPE' ? 'drohnengruppe' : event.isSectionWide ? 'abschnitt' : 'own';
      const droneGroup = event.droneGroupId ? droneGroupsById.get(event.droneGroupId) ?? null : null;
      return {
        id: event.id,
        title: event.title,
        start: event.startsAt.toISOString(),
        end: event.endsAt.toISOString(),
        allDay: event.allDay,
        editable: canManageEvent(user, event, droneGroup) && !event.vehicleBookingId && !event.icsUid,
        backgroundColor: LAYER_COLORS[layer],
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        organizationName: event.organization.shortName ?? event.organization.name,
        category: event.category,
        layer,
        myRsvpStatus: myRsvpByEvent.get(event.id) ?? null,
        rsvpCounts: rsvpCountsByEvent.get(event.id) ?? { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 },
        isVehicleBooking: event.vehicleBookingId !== null,
        isDistrictWideDrone: event.category === 'DROHNENGRUPPE' && event.droneGroupId === null,
      };
    });

  const combinedIcsToken = process.env.ABSCHNITTS_ICS_TOKEN;

  const icsLinks: IcsLink[] = [
    {
      label: 'Kalender abonnieren (.ics)',
      href: `/kalender/ics/${organization.icsToken}`,
      copyText: `${baseUrl()}/kalender/ics/${organization.icsToken}`,
    },
  ];
  // Der kombinierte Abschnitts-Feed hängt an einem einzigen Umgebungs-Token und liefert ausschließlich
  // die Termine des Abschnitts Purkersdorf (siehe LEGACY_COMBINED_ICS_ABSCHNITT_NUMMER). Nutzern der
  // übrigen 6 Abschnitte darf er deshalb gar nicht erst angeboten werden - sie bekämen sonst einen
  // fremden Kalender unter dem Label "Abschnitt-Kalender".
  const showCombinedIcsLink = homeAbschnitt?.nummer === LEGACY_COMBINED_ICS_ABSCHNITT_NUMMER;

  if (combinedIcsToken && showCombinedIcsLink) {
    icsLinks.push({
      label: 'Abschnitt-Kalender abonnieren (.ics)',
      href: `/kalender/ics/${combinedIcsToken}`,
      copyText: `${baseUrl()}/kalender/ics/${combinedIcsToken}`,
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CollapsingPageTitle title={`Kalender – ${organization.shortName ?? organization.name}`} />
        {canCreateAnyEvent && (
          <Link href="/kalender/neu" className="self-start rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark sm:self-auto">
            Neuer Termin
          </Link>
        )}
      </div>
      <KalenderWithLayers events={calendarEvents} layers={layers} icsLinks={icsLinks} />
    </div>
  );
}
```

Regression note: for a user with `canSeeDroneCategory === false` (not a drone-module member at all — the overwhelming majority of users, including every plain Feuerwehr-Admin), the query's third `OR` branch is `[]` (spread of an empty array), `droneGroups` resolves to `[]`, and the `.filter`/`.map`/`editable` logic for their own ALLGEMEIN events is untouched — `canManageEvent(user, event, null)` for an ALLGEMEIN event calls the same `canManageEventsFor(user, event.organizationId)` as the old `canManageEventsFor(user, event.organizationId)` call did directly.

- [ ] **Step 3: Verify with tsc**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual check via dev server**

As a group-1 drone member (not admin), confirm `/kalender` shows group 1's events plus any bezirksweit event, but not group 2/3/4's events. As the group-1 Admin Drohnengruppe, confirm their own group's events show `editable: true` (double-click routes to `/kalender/.../bearbeiten` instead of opening the read-only detail view) while a bezirksweit event (created by the Bezirksadmin) shows `editable: false` for this user. As the Bezirksadmin, confirm the bezirksweit event shows `editable: true`.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/calendar-view.tsx "src/app/(app)/kalender/page.tsx"
git commit -m "Kalenderübersicht: bezirksweite/fremde Drohnengruppen-Termine laden, editable-Berechnung über canManageEvent korrigieren"
```

---

### Task 7: `push/audience.ts` — invert the DROHNENGRUPPE defensive guard so it means "all 4 groups", not "nobody"

**Files:**
- Modify: `src/lib/push/audience.ts:44-98` (the `resolveEventAudienceUserIds` function and its doc-comment only — `resolveAudienceUserIds` above it, for the News module, is untouched).

**Interfaces:**
- Signature unchanged: `resolveEventAudienceUserIds(event: { organizationId: string; isSectionWide: boolean; category: string; droneGroupId: string | null }): Promise<string[]>`.
- Consumes: `prisma.user.findMany`, `getAbschnittOrganizationId` (both already imported in this file).

- [ ] **Step 1: Replace lines 44-98 (the doc-comment + function body)**

Replace:

```ts
/**
 * Zielgruppe für die "Push-Benachrichtigung jetzt senden"-Option auf der Termin-Detailseite -
 * bewusst dieselbe Sichtbarkeitsregel wie canViewEvent/die Kalenderübersicht-Query (eigene
 * Feuerwehr ODER abschnittsweit, Drohnengruppe-Kategorie zusätzlich nur Mitglieder), nicht die
 * ORGANIZATION/DROHNENGRUPPE-Unterscheidung von NewsMessage, da ein Termin abschnittsweit sein
 * kann, ohne eine eigene NewsAudienceType-Zeile zu haben.
 */
export async function resolveEventAudienceUserIds(event: {
  organizationId: string;
  isSectionWide: boolean;
  category: string;
  droneGroupId: string | null;
}): Promise<string[]> {
  // Defensiv: sollte nach Task 8 nie eintreten (jedes DROHNENGRUPPE-Event trägt eine droneGroupId),
  // aber `droneMembership: { droneGroupId: undefined }` würde in Prisma dieses Feld GAR NICHT
  // filtern (nested-relation-Filter mit undefined = "kein Filter auf dieses Feld", nicht "kein
  // Treffer") und damit wieder auf alle Gruppen zurückweiten - exakt der Bug, der hier behoben wird.
  // Per Live-Test bestätigt (siehe Task-12-Report), nicht nur angenommen: lieber niemanden
  // benachrichtigen als versehentlich wieder bezirksweit an alle Drohnengruppen zu pushen.
  if (event.category === 'DROHNENGRUPPE' && !event.droneGroupId) return [];

  // Die Organisations-/Abschnittshälfte der Sichtbarkeitsregel - identisch zu canViewEvent:
  // eigene Feuerwehr ODER (abschnittsweit UND im selben Abschnitt). Bei einem abschnittsweiten Termin
  // umfasst die Abschnittsbedingung die eigene-Feuerwehr-Bedingung bereits vollständig.
  let visibilityWhere: Prisma.UserWhereInput;
  if (event.isSectionWide) {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: event.organizationId },
      select: { type: true, id: true, parentId: true },
    });
    const abschnittOrganizationId = getAbschnittOrganizationId(organization);
    visibilityWhere = {
      homeOrganization: { OR: [{ id: abschnittOrganizationId }, { parentId: abschnittOrganizationId }] },
    };
  } else {
    visibilityWhere = { homeOrganizationId: event.organizationId };
  }

  // Bei Kategorie DROHNENGRUPPE kommt die Gruppenbedingung ZUSÄTZLICH zur obigen Hälfte dazu (UND,
  // nicht STATT) - genau wie in canViewEvent. Vorher wurde nur auf die Gruppe gefiltert, wodurch ein
  // NICHT abschnittsweiter Drohnengruppen-Termin einer einzelnen Feuerwehr an alle Mitglieder der
  // Gruppe über alle ihre Feuerwehren hinweg gepusht wurde - also auch an Leute, die den Termin gar
  // nicht öffnen können.
  const members = await prisma.user.findMany({
    where: {
      isActive: true,
      ...visibilityWhere,
      ...(event.category === 'DROHNENGRUPPE'
        ? { droneMembership: { is: { droneGroupId: event.droneGroupId as string } } }
        : {}),
    },
    select: { id: true },
  });
  return members.map((member) => member.id);
}
```

with:

```ts
/**
 * Zielgruppe für die "Push-Benachrichtigung jetzt senden"-Option auf der Termin-Detailseite -
 * bewusst dieselbe Sichtbarkeitsregel wie canViewEvent/die Kalenderübersicht-Query:
 * - Kategorie DROHNENGRUPPE ist VÖLLIG UNABHÄNGIG von organizationId/isSectionWide (siehe
 *   canViewEvent) - Zielgruppe ist ausschließlich über die Drohnengruppen-Mitgliedschaft bestimmt:
 *   die eine Gruppe (droneGroupId gesetzt) oder JEDE Gruppe (droneGroupId null, bezirksweit).
 * - Kategorie ALLGEMEIN bleibt bei der alten organisations-/abschnittsbasierten Regel.
 * Nicht die ORGANIZATION/DROHNENGRUPPE-Unterscheidung von NewsMessage, da ein Termin abschnittsweit
 * sein kann, ohne eine eigene NewsAudienceType-Zeile zu haben.
 */
export async function resolveEventAudienceUserIds(event: {
  organizationId: string;
  isSectionWide: boolean;
  category: string;
  droneGroupId: string | null;
}): Promise<string[]> {
  if (event.category === 'DROHNENGRUPPE') {
    // droneGroupId null bedeutet bezirksweit (alle 4 Gruppen) - genau wie bei canViewEvent und bei
    // NewsMessage.audienceDroneGroupId (siehe Kommentar dort im Schema), NICHT mehr "niemand". Das
    // `is: {...}` (statt eines nackten `droneGroupId: ...`) verlangt weiterhin, dass die
    // droneMembership-Relation überhaupt existiert - ein Feld auf undefined setzen würde Prisma bei
    // einem verschachtelten Relations-Filter dazu bringen, dieses Feld GAR NICHT zu filtern (siehe
    // resolveAudienceUserIds oben für den bereits live bestätigten Prisma-Bug dieser Form).
    const members = await prisma.user.findMany({
      where: {
        isActive: true,
        droneMembership: { is: { droneGroupId: event.droneGroupId ?? undefined } },
      },
      select: { id: true },
    });
    return members.map((member) => member.id);
  }

  // Die Organisations-/Abschnittshälfte der Sichtbarkeitsregel - identisch zu canViewEvent:
  // eigene Feuerwehr ODER (abschnittsweit UND im selben Abschnitt). Bei einem abschnittsweiten Termin
  // umfasst die Abschnittsbedingung die eigene-Feuerwehr-Bedingung bereits vollständig.
  let visibilityWhere: Prisma.UserWhereInput;
  if (event.isSectionWide) {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: event.organizationId },
      select: { type: true, id: true, parentId: true },
    });
    const abschnittOrganizationId = getAbschnittOrganizationId(organization);
    visibilityWhere = {
      homeOrganization: { OR: [{ id: abschnittOrganizationId }, { parentId: abschnittOrganizationId }] },
    };
  } else {
    visibilityWhere = { homeOrganizationId: event.organizationId };
  }

  const members = await prisma.user.findMany({
    where: { isActive: true, ...visibilityWhere },
    select: { id: true },
  });
  return members.map((member) => member.id);
}
```

Note the one subtlety carried over from the code being replaced: `droneGroupId: event.droneGroupId ?? undefined` inside the `is: {...}` filter, NOT a plain `droneGroupId: event.droneGroupId`. `event.droneGroupId` is `string | null`; when it's `null` (bezirksweit), `?? undefined` turns it into `undefined`, and inside a Prisma nested-relation `is: {...}` filter an `undefined` field is a real, intentional "don't filter on this field" — the existing `resolveAudienceUserIds` function directly above already relies on and documents this exact same live-tested behavior for `NewsMessage`'s identical null-means-all-groups case. Passing a literal `null` instead of `undefined` here would be wrong: Prisma would treat that as "match rows where `droneGroupId IS NULL`", i.e. zero users (nobody's own `droneGroupId` column is ever `NULL`), not "match every group".

- [ ] **Step 2: Verify with tsc**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual check — one-off script against the dev database**

```ts
// scratch check, not committed
import { resolveEventAudienceUserIds } from './src/lib/push/audience';

async function main() {
  const bezirksweit = await resolveEventAudienceUserIds({
    organizationId: 'irrelevant-for-this-category',
    isSectionWide: false,
    category: 'DROHNENGRUPPE',
    droneGroupId: null,
  });
  console.log('Bezirksweit - Anzahl Empfänger (muss = Summe aller 4 Gruppen-Mitgliederzahlen sein):', bezirksweit.length);

  // Ersetze durch eine echte, in der Dev-DB existierende DroneGroup-id einer einzelnen Gruppe:
  const singleGroup = await resolveEventAudienceUserIds({
    organizationId: 'irrelevant-for-this-category',
    isSectionWide: false,
    category: 'DROHNENGRUPPE',
    droneGroupId: 'REPLACE_WITH_REAL_DRONE_GROUP_ID',
  });
  console.log('Einzelne Gruppe - Anzahl Empfänger (muss NUR deren Mitglieder sein):', singleGroup.length);
}

main();
```

Run with `npx tsx <script-path>` against the dev database (`docker compose -f docker-compose.dev.yml up -d`, `.env` pointed at it). Cross-check both counts against `SELECT COUNT(*) FROM "User" u JOIN "DrohnengruppeMembership" m ON m."userId" = u.id WHERE u."isActive" = true [AND m."droneGroupId" = '...']` via `npm run db:studio` or a direct `psql` query. Delete the script afterward.

- [ ] **Step 4: Commit**

```bash
git add src/lib/push/audience.ts
git commit -m "Push-Audience: droneGroupId=null für DROHNENGRUPPE-Termine als bezirksweit (alle 4 Gruppen) statt niemand behandeln"
```

---

### Task 8: "Bezirksweit"-Label + Bearbeiten-Sichtbarkeit auf der Detailseite und in den 3 Listen-/Karten-Komponenten

**Files:**
- Modify: `src/app/(app)/kalender/[eventId]/page.tsx` (full file — replace entirely).
- Modify: `src/components/calendar/event-list-view.tsx` (3 targeted edits: `EventListRow`, `EventCard`, `DesktopEventRow`).

**Interfaces:**
- Consumes: `CalendarEventInput.isDistrictWideDrone` (added in Task 6), `canManageEvent` (from Task 1).
- No new exports.

- [ ] **Step 1: Replace the full file content of `kalender/[eventId]/page.tsx`**

```tsx
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageEvent, canViewEvent } from '@/lib/auth/permissions';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';
import { AddToCalendarLink } from '@/components/calendar/add-to-calendar-link';
import { EventRsvpButtons } from '@/components/calendar/event-rsvp-buttons';
import { SendEventPushButton } from '@/components/calendar/send-event-push-button';
import type { RsvpStatusOption } from '@/lib/validation/rsvp.schema';

const STATUS_LABEL: Record<RsvpStatusOption, string> = {
  ZUGESAGT: 'Zugesagt',
  ABGESAGT: 'Abgesagt',
  UNKLAR: 'Unklar',
};

const STATUS_BADGE_CLASS: Record<RsvpStatusOption, string> = {
  ZUGESAGT: 'bg-green-100 text-green-800',
  ABGESAGT: 'bg-red-100 text-red-800',
  UNKLAR: 'bg-neutral-200 text-neutral-700',
};

function formatEventTime(startsAt: Date, endsAt: Date, allDay: boolean): string {
  if (allDay) return 'Ganztägig';
  const start = startsAt.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  const end = endsAt.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  return `${start} – ${end}`;
}

export default async function TerminDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireUser();
  const { eventId } = await params;

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organization: true } });
  if (!event) {
    return <p className="text-neutral-700">Termin wurde nicht gefunden.</p>;
  }
  if (!canViewEvent(user, { ...event, eventAbschnittOrganizationId: getAbschnittOrganizationId(event.organization) })) {
    return <p className="text-neutral-700">Du hast keine Berechtigung, diesen Termin zu sehen.</p>;
  }

  // Vorher: canManageEventsFor(user, event.organizationId) an beiden Stellen unten (Bearbeiten-Link,
  // Push-Benachrichtigung-Sektion) - das war für Drohnengruppen-Termine falsch (blockte jeden Admin
  // Drohnengruppe ohne eigene Feuerwehr-Admin-Mitgliedschaft von seinen EIGENEN Gruppen-Terminen).
  const droneGroup =
    event.category === 'DROHNENGRUPPE' && event.droneGroupId
      ? await prisma.droneGroup.findUnique({
          where: { id: event.droneGroupId },
          select: { id: true, organizationId: true },
        })
      : null;
  const canManageThisEvent = canManageEvent(user, event, droneGroup);
  const isDistrictWideDrone = event.category === 'DROHNENGRUPPE' && event.droneGroupId === null;

  const zusagen = await prisma.terminZusage.findMany({
    where: { eventId },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
  });

  const counts: Record<RsvpStatusOption, number> = { ZUGESAGT: 0, ABGESAGT: 0, UNKLAR: 0 };
  for (const zusage of zusagen) counts[zusage.status] += 1;

  const ownZusage = zusagen.find((zusage) => zusage.user.id === user.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-neutral-900">{event.title}</h1>
          {isDistrictWideDrone && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Bezirksweit
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <AddToCalendarLink eventId={event.id} />
          {canManageThisEvent && !event.vehicleBookingId && !event.icsUid && (
            <Link href={`/kalender/${event.id}/bearbeiten`} className="text-sm text-brand hover:underline">
              Bearbeiten
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-white p-4 text-sm shadow-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Zeit</dt>
          <dd className="text-neutral-800">{formatEventTime(event.startsAt, event.endsAt, event.allDay)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Organisation</dt>
          <dd className="text-neutral-800">{event.organization.shortName ?? event.organization.name}</dd>
        </div>
        {event.location && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Ort</dt>
            <dd className="text-neutral-800">{event.location}</dd>
          </div>
        )}
        {event.description && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Beschreibung</dt>
            <dd className="whitespace-pre-wrap text-neutral-800">{event.description}</dd>
          </div>
        )}
      </div>

      {canManageThisEvent && (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">Push-Benachrichtigung</h2>
          <SendEventPushButton eventId={event.id} />
        </div>
      )}

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

      {!event.vehicleBookingId && (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900">
            Teilnehmerliste
            <span className="flex gap-1.5 text-xs font-normal">
              {(Object.keys(STATUS_LABEL) as RsvpStatusOption[]).map((status) => (
                <span key={status} className={`rounded px-1.5 py-0.5 ${STATUS_BADGE_CLASS[status]}`}>
                  {STATUS_LABEL[status]}: {counts[status]}
                </span>
              ))}
            </span>
          </h2>
          {zusagen.length === 0 ? (
            <p className="text-sm text-neutral-500">Noch keine Zusagen.</p>
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
}
```

Regression note: for an ALLGEMEIN event, `droneGroup` is `null` (the ternary's condition is category-gated) and `canManageEvent(user, event, null)` takes the exact same `canManageEventsFor(user, event.organizationId)` path the old direct call took — identical result for a plain Feuerwehr-Admin.

- [ ] **Step 2: Add the "Bezirksweit" pill to `EventListRow` in `event-list-view.tsx`**

Find (inside `EventListRow`, the `<td className="break-words px-3 py-1">` for the title):

```tsx
      <td className="break-words px-3 py-1">
        {event.isVehicleBooking && <VehicleBookingIcon className="mr-1 inline-block align-[-2px] text-neutral-500" />}
        {event.title}
      </td>
```

Replace with:

```tsx
      <td className="break-words px-3 py-1">
        {event.isVehicleBooking && <VehicleBookingIcon className="mr-1 inline-block align-[-2px] text-neutral-500" />}
        {event.isDistrictWideDrone && (
          <span className="mr-1 rounded bg-neutral-100 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Bezirksweit
          </span>
        )}
        {event.title}
      </td>
```

- [ ] **Step 3: Add the "Bezirksweit" pill to `EventCard` in `event-list-view.tsx`**

Find (inside `EventCard`, the title `<span>`):

```tsx
        <span className="font-medium text-neutral-900">
          {event.isVehicleBooking && <VehicleBookingIcon className="mr-1 inline-block align-[-2px] text-neutral-500" />}
          {event.title}
        </span>
```

Replace with:

```tsx
        <span className="font-medium text-neutral-900">
          {event.isVehicleBooking && <VehicleBookingIcon className="mr-1 inline-block align-[-2px] text-neutral-500" />}
          {event.isDistrictWideDrone && (
            <span className="mr-1 rounded bg-neutral-100 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              Bezirksweit
            </span>
          )}
          {event.title}
        </span>
```

- [ ] **Step 4: Add the "Bezirksweit" pill to `DesktopEventRow` in `event-list-view.tsx`**

Find (inside `DesktopEventRow`, the title row's flex container):

```tsx
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-neutral-900">
            {event.isVehicleBooking && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Fahrzeug
              </span>
            )}
            <Link href={`/kalender/${event.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
              {event.title}
            </Link>
          </div>
```

Replace with:

```tsx
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-neutral-900">
            {event.isVehicleBooking && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Fahrzeug
              </span>
            )}
            {event.isDistrictWideDrone && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Bezirksweit
              </span>
            )}
            <Link href={`/kalender/${event.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
              {event.title}
            </Link>
          </div>
```

- [ ] **Step 5: Verify with tsc**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual check via dev server**

Open a bezirksweit event's detail page as the Bezirksadmin: confirm the "Bezirksweit" pill next to the title, the "Bearbeiten" link, and the "Push-Benachrichtigung" section are all visible. Open the same event as a plain group-1 drone member (not admin): confirm the pill still shows, but neither "Bearbeiten" nor "Push-Benachrichtigung" appear. In the Kalender list view (`/kalender`, Listenansicht, all three breakpoints — resize the browser or use the mobile/tablet/desktop dev-server preview), confirm the "Bezirksweit" pill renders next to that event's title in the mobile card, the tablet table row, and the desktop month-group row.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/kalender/[eventId]/page.tsx" src/components/calendar/event-list-view.tsx
git commit -m "Kalender: Bezirksweit-Label in Detailansicht + Listenansichten, Bearbeiten/Push-Sichtbarkeit auf Detailseite über canManageEvent korrigieren"
```

---

## File Structure Summary

| File | Change |
|---|---|
| `src/lib/auth/permissions.ts` | `canViewEvent` restructured (category-first); new `canManageBezirksWideDroneEvent`, `canManageEvent` |
| `src/lib/validation/event.schema.ts` | `droneGroupId: null` valid for DROHNENGRUPPE; `organizationId` required only for ALLGEMEIN; new `BEZIRKSWEIT_DRONE_GROUP_VALUE` sentinel |
| `src/components/calendar/event-form.tsx` | Organisation/Abschnitt-weit hidden for DROHNENGRUPPE category; Kategorie-switcher visibility decoupled from Abschnitt selection |
| `src/lib/calendar/drone-group-options.ts` | **New.** `getManageableDroneGroupOptions(user)` shared by both form pages |
| `src/app/(app)/kalender/neu/page.tsx` | Page-access gate widened; droneGroupOptions via new shared helper |
| `src/app/(app)/kalender/[eventId]/bearbeiten/page.tsx` | Page-access check fixed (`canManageEvent` instead of `canManageEventsFor`); droneGroupOptions via new shared helper; bezirksweit defaultValues mapping |
| `src/app/(app)/kalender/actions.ts` | `createEvent`/`updateEvent`/`deleteEvent` branch on category; DROHNENGRUPPE branch uses `canManageEvent`, auto-derives `organizationId`/`isSectionWide` |
| `src/components/calendar/calendar-view.tsx` | `CalendarEventInput.isDistrictWideDrone?: boolean` added |
| `src/app/(app)/kalender/page.tsx` | Query gains a drone-specific OR-branch; filter/editable fixed via `canManageEvent`; access-gate widened |
| `src/lib/push/audience.ts` | `resolveEventAudienceUserIds`'s DROHNENGRUPPE branch inverted: null → all 4 groups, not nobody |
| `src/app/(app)/kalender/[eventId]/page.tsx` | Bearbeiten-link/Push-section visibility fixed via `canManageEvent`; "Bezirksweit" label |
| `src/components/calendar/event-list-view.tsx` | "Bezirksweit" pill added to `EventListRow`, `EventCard`, `DesktopEventRow` |

**Explicitly out of scope** (per the design doc's Non-Goals, unchanged by this plan): `.ics` feeds (still exclude the DROHNENGRUPPE category entirely, token-authenticated so they can't check module membership), Google-Kalender-Rückschreiben (`google-calendar-push.ts` doesn't branch on `category` at all), FullCalendar's month-grid cell rendering (`calendar-view.tsx`'s `renderEventContent` — space-constrained, no label added there, only in the list/card/detail views per the approved design), and any change to how many `DroneGroup` rows exist (still exactly 4, seeded — no admin UI to add a 5th).

## Self-Review

**Spec coverage** — every requirement in the design doc maps to a task:
- Req. 1 (members see their own group's events, not just AFKDO Purkersdorf): Task 6 (query fix) + Task 1 (`canViewEvent` restructure) + Task 4 (droneGroupOptions widened for creation).
- Req. 2 (only an Admin Drohnengruppe of a group, not any member, may create/edit that group's events): Task 1 (`canManageEvent` uses `canManageDroneGroupFor`, never bare membership) + Task 5.
- Req. 3 (bezirksweit event, all 4 groups, Bezirksadmin/Bezirks-Drohnenadmin only): Task 1 (`canManageBezirksWideDroneEvent`, `canViewEvent`'s `droneGroupId === null` branch) + Task 2 (schema allows null) + Task 4 (sentinel option, page-access widening) + Task 5 (actions) + Task 6 (query/editable) + Task 7 (push audience) + Task 8 (label).
- Req. 4 (Feuerwehr-Admin's own-org-only ALLGEMEIN behavior stays unchanged): called out explicitly with a "Regression note" in Tasks 1, 3, 4, 5, 6, 8 — every one of them touches a file the ALLGEMEIN path also runs through.

**Placeholder scan** — no TBD/TODO, no "add error handling" without code, no "similar to Task N" without repeating the actual code. Every step has a complete, pasteable code block or an exact find/replace pair.

**Type consistency** — `canManageEvent(user, event, droneGroup)`'s signature is identical everywhere it's called (Tasks 4, 5, 6, 8): `event` is always `{ organizationId: string; category: string; droneGroupId: string | null }` (a Prisma `Event` row satisfies this structurally) and `droneGroup` is always `{ id: string; organizationId: string } | null`. `getManageableDroneGroupOptions`'s return type (`DroneGroupFormOption[]`, `{id, name}`) matches `EventForm`'s existing `DroneGroupOption` interface shape exactly (both `{id: string, name: string}`), so no adapter is needed between Task 4's new helper and the unmodified prop type in Task 3. `CalendarEventInput.isDistrictWideDrone` (Task 6) is consumed with the identical name in Task 8 — no `isDistrictWide`/`isBezirksweit` naming drift.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-12-kalender-drohnengruppen-mehrfach-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
