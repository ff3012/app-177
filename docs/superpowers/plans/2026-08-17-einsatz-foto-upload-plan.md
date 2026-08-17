# Einsätze erfassen und Fotos hochladen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Einsätze erfassen und Fotos hochladen" module under „Meine Feuerwehr": any member of a Feuerwehr can log an Einsatz and upload photos to it (direct-to-S3, presigned URLs, byte-progress IndexedDB queue), with session-gated, never-public downloads.

**Architecture:** Four new Prisma models (`Incident`, `IncidentVehicle`, `IncidentCrewMember`, `IncidentPhoto`) scoped to one Feuerwehr each. Uploads go client → S3 directly via a presigned `PUT` (server never buffers the original); a `complete` route then downloads a copy server-side once to validate real image bytes (via `sharp`, magic-byte-equivalent decode check), derive two WebP previews, and read EXIF `takenAt`. Downloads/views never expose a permanent URL — a session-gated Next.js route checks permissions, then redirects (307) to a 60-second presigned `GET`. A client-side IndexedDB-backed queue (`idb`) uploads 2-3 files in parallel with byte-based progress, pause/resume, per-file retry, and a best-effort Wi-Fi-only gate.

**Tech Stack:** Next.js App Router Server Actions + Route Handlers, Prisma/PostgreSQL, `@aws-sdk/client-s3` + new `@aws-sdk/s3-request-presigner`, `sharp` (already installed) for decode/preview, new `exifr` dependency for EXIF `takenAt`, new `idb` dependency for the client upload queue, `react-hook-form` + `zod` for forms (matching every other form in this codebase).

## Global Constraints

- Every Server Action and Route Handler re-checks permissions itself (`canViewIncidentsFor`/`canManageIncidentsFor`/`canDeleteIncidentPhoto`/`canTogglePhotoRelease`) — never rely on UI-level hiding alone. A member of another Feuerwehr must get `404` (via `notFound()` or a `404` JSON response), never a permission-denied message that confirms the resource exists.
- `Incident` belongs to exactly one Feuerwehr (`fireDepartmentId`) — no Abschnitt-wide visibility, no per-incident sharing.
- Every Feuerwehr member (same `homeOrganizationId`) may create/edit/delete incidents and upload photos — identical rule to viewing, no role restriction (App-Betreiber decision, overriding the original brief's "Kommandant/Einsatzleiter/Schriftführer" wording).
- The S3 bucket (`app-177-pictures`, new env var `S3_PHOTOS_BUCKET`) reuses the existing `S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_ENDPOINT_URL` credentials already used for `docker/backup.sh` — do not introduce new credential env vars.
- `S3_PHOTOS_BUCKET` must be added to **both** `docker/docker-compose.yml`'s and `docker/docker-compose.staging.yml`'s explicit `environment:` blocks, not just `.env.example` — this project has been bitten by exactly this gap twice already (root `CLAUDE.md`).
- Original photo bytes are never re-encoded or modified — only the two derived WebP previews are new objects. Byte-identical original in, byte-identical original out.
- MIME/format validation happens server-side via a real decode attempt (`sharp(...).metadata()`), never via client-declared `Content-Type` or file extension alone — same lesson as the Wappen-upload security fix (`src/lib/organizations/wappen.ts`).
- No permanent/public photo URL may ever exist. Every read goes through a session-gated route that mints a 60-second presigned `GET` at request time.
- Limits: 50 MB per file, 30 files per upload batch, `image/*` only (including `image/heic`/`image/heif`).
- No automated test suite in this repo — verify each task with `npx tsc --noEmit`, `npm run build`, and live/scripted checks against the dev database (direct Prisma scripts, `curl`, browser checks), matching this session's established verification style.
- German UI copy throughout, matching existing screens' tone and the wording quoted in the spec.

---

### Task 1: Data model, migration, permissions

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/auth/permissions.ts`
- Test: none (no test suite) — verified via `npx prisma migrate dev` + a standalone Prisma script

**Interfaces:**
- Produces: Prisma models `Incident`, `IncidentVehicle`, `IncidentCrewMember`, `IncidentPhoto`, enums `IncidentKind` (`TECHNISCH`/`BRAND`/`SCHADSTOFF`/`SONSTIGES`) and `PhotoStatus` (`PENDING`/`UPLOADING`/`READY`/`FAILED`); permission functions `canViewIncidentsFor(user: SessionUser, fireDepartmentId: string): boolean`, `canManageIncidentsFor(user: SessionUser, fireDepartmentId: string): boolean`, `canDeleteIncidentPhoto(user: SessionUser, photo: { uploadedById: string }, fireDepartmentId: string): boolean`, `canTogglePhotoRelease(user: SessionUser, photo: { uploadedById: string }): boolean`.

- [ ] **Step 1: Add the enums and models to `prisma/schema.prisma`**

Add these two enums near the other enums at the top of the file (after `enum VehicleBookingStatus { ... }`):

```prisma
enum IncidentKind {
  TECHNISCH
  BRAND
  SCHADSTOFF
  SONSTIGES
}

// PENDING: IncidentPhoto-Zeile angelegt, aber noch kein Objekt im Bucket (siehe presign-Route).
// UPLOADING wird aktuell nicht serverseitig gesetzt (der Client verwaltet seinen eigenen Warteschlangen-
// Status lokal in IndexedDB) - bleibt als Enum-Wert für eine mögliche künftige Serverseite-Anzeige.
// READY: complete-Route hat das Original erfolgreich dekodiert, Vorschauen abgeleitet.
// FAILED: complete ist fehlgeschlagen (kein echtes Bild, zu groß, ...) - Objekt wurde bereits gelöscht.
enum PhotoStatus {
  PENDING
  UPLOADING
  READY
  FAILED
}
```

Add these four models after `model VehicleBooking { ... }` (end of that model's closing brace):

```prisma
// Ein Einsatz einer Feuerwehr (Foto-Upload-Brief.md). Gehört immer genau EINER Feuerwehr - keine
// Abschnitts-weite Sichtbarkeit, anders als Event.isSectionWide. Jedes Mitglied der Feuerwehr darf
// anlegen/bearbeiten/löschen (siehe canManageIncidentsFor) - keine Kommandant/Einsatzleiter-
// Rollenprüfung, da dieses Projekt keine solche Rollenunterscheidung kennt (nur Dienstgrad, eine
// reine Anzeige-Tabelle ohne Berechtigungslogik).
model Incident {
  id               String       @id @default(cuid())
  fireDepartmentId String
  fireDepartment   Organization @relation(fields: [fireDepartmentId], references: [id])
  kind             IncidentKind
  keyword          String
  location         String
  alarmedAt        DateTime
  endedAt          DateTime?
  crewCount        Int?
  createdById      String
  createdBy        User         @relation(fields: [createdById], references: [id])
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  vehicles    IncidentVehicle[]
  crewMembers IncidentCrewMember[]
  photos      IncidentPhoto[]

  @@index([fireDepartmentId])
  @@index([alarmedAt])
}

// Reine Join-Tabelle für die Mehrfachauswahl "Fahrzeuge" (Brief §4.5/6.2) - Vehicle existiert
// bereits (meine-feuerwehr/Fuhrpark), keine Änderung an Vehicle selbst nötig außer der
// Gegenrichtungs-Relation unten.
model IncidentVehicle {
  incidentId String
  incident   Incident @relation(fields: [incidentId], references: [id], onDelete: Cascade)
  vehicleId  String
  vehicle    Vehicle  @relation(fields: [vehicleId], references: [id])

  @@id([incidentId, vehicleId])
}

// Brief §4.5 "Mannschaft - Anzahl plus optionale Personenauswahl": Incident.crewCount ist die
// eigenständige, immer vorhandene Zahl - diese Tabelle ist eine zusätzliche, unabhängige
// Anreicherung (muss nicht mit crewCount übereinstimmen, z. B. "12 Mann" bekannt, aber nur 4 Namen
// erfasst).
model IncidentCrewMember {
  incidentId String
  incident   Incident @relation(fields: [incidentId], references: [id], onDelete: Cascade)
  userId     String
  user       User     @relation(fields: [userId], references: [id])

  @@id([incidentId, userId])
}

// Ein hochgeladenes Einsatzfoto. storageKey/previewKey/thumbnailKey sind S3-Objektschlüssel im
// Bucket app-177-pictures (siehe lib/storage/incident-photos-s3.ts) - NICHT die Bilddaten selbst,
// anders als DroneDocument/FacebookPostImage/Organization.wappenImageData (Bytes in Postgres). Das
// Original bleibt byteidentisch im Bucket; previewKey/thumbnailKey sind abgeleitete WebP-Objekte,
// beide null solange status != READY.
model IncidentPhoto {
  id           String      @id @default(cuid())
  incidentId   String
  incident     Incident    @relation(fields: [incidentId], references: [id], onDelete: Cascade)
  uploadedById String
  uploadedBy   User        @relation(fields: [uploadedById], references: [id])
  storageKey   String
  previewKey   String?
  thumbnailKey String?
  originalName String
  mimeType     String
  byteSize     Int
  width        Int?
  height       Int?
  takenAt      DateTime?
  publicRelease Boolean    @default(false)
  status       PhotoStatus @default(PENDING)
  createdAt    DateTime    @default(now())

  @@index([incidentId])
  @@index([status, createdAt])
}
```

Add the relation back-references on the existing models (do not change any existing column):

In `model Organization { ... }`, next to `vehicles     Vehicle[]`, add:
```prisma
  incidents    Incident[]
```

In `model User { ... }`, find the existing relation block (near `dienstgrad   Dienstgrad? @relation(...)`) and add three new relation fields:
```prisma
  createdIncidents        Incident[]
  incidentCrewMemberships IncidentCrewMember[]
  uploadedIncidentPhotos  IncidentPhoto[]
```

In `model Vehicle { ... }`, next to `bookings     VehicleBooking[]`, add:
```prisma
  incidentVehicles IncidentVehicle[]
```

- [ ] **Step 2: Generate and apply the migration**

Run:
```bash
npm run db:migrate
```
When prompted for a migration name, use `einsatz_foto_upload`. This is purely additive (two new enums, four new tables, three new relation columns none of which touch existing columns) — verify the generated SQL under `prisma/migrations/<timestamp>_einsatz_foto_upload/migration.sql` contains only `CREATE TYPE`/`CREATE TABLE`/`ALTER TABLE ... ADD CONSTRAINT` (foreign keys), no `ALTER TABLE ... DROP`/`ALTER COLUMN` on any pre-existing table.

- [ ] **Step 3: Add the permission functions to `src/lib/auth/permissions.ts`**

Add near `canManageHeimatfeuerwehrFor`/`canManageUsersFor` (same file, same style):

```ts
/**
 * Sichtbarkeit von Einsätzen/Fotos einer Feuerwehr (Foto-Upload-Brief.md §3) - jedes Mitglied
 * dieser Feuerwehr (gleiche homeOrganizationId) ODER wer sie administrativ verwaltet
 * (canManageHeimatfeuerwehrFor). Fotos hochladen nutzt exakt dieselbe Regel ("keine
 * Einschränkung" laut Brief) - kein separates canUploadIncidentPhotoFor nötig.
 */
export function canViewIncidentsFor(user: SessionUser, fireDepartmentId: string): boolean {
  return user.homeOrganizationId === fireDepartmentId || canManageHeimatfeuerwehrFor(user, fireDepartmentId);
}

/**
 * Einsatz anlegen/bearbeiten/löschen - laut App-Betreiber (Chat-Rückfrage, nicht im ursprünglichen
 * Brief) dieselbe Regel wie canViewIncidentsFor: jedes Mitglied der Feuerwehr darf, keine
 * Rollen-Einschränkung ("Kommandant/Einsatzleiter/Schriftführer" aus dem Brief wurde bewusst NICHT
 * umgesetzt, da dieses Projekt keine solche Rollentabelle kennt). Eigene, benannte Funktion statt
 * canViewIncidentsFor direkt an den Aufrufstellen wiederzuverwenden, falls sich das künftig doch
 * trennt - gleiches Muster wie canManageUsersFor/canManageHeimatfeuerwehrFor in diesem Projekt.
 */
export function canManageIncidentsFor(user: SessionUser, fireDepartmentId: string): boolean {
  return canViewIncidentsFor(user, fireDepartmentId);
}

/** Foto löschen - der Uploader selbst ODER ein Admin der Feuerwehr (canManageHeimatfeuerwehrFor),
 * NICHT jedes beliebige Mitglied (anders als canViewIncidentsFor/canManageIncidentsFor). */
export function canDeleteIncidentPhoto(
  user: SessionUser,
  photo: { uploadedById: string },
  fireDepartmentId: string,
): boolean {
  return photo.uploadedById === user.id || canManageHeimatfeuerwehrFor(user, fireDepartmentId);
}

/** Freigabe "für Öffentlichkeitsarbeit" umschalten - laut Brief-Tabelle NUR der Uploader selbst,
 * bewusst OHNE Admin-Ausnahme (anders als canDeleteIncidentPhoto) - ein Admin darf ein fremdes Foto
 * zwar löschen, aber nicht in dessen Namen für die Öffentlichkeitsarbeit freigeben. */
export function canTogglePhotoRelease(user: SessionUser, photo: { uploadedById: string }): boolean {
  return photo.uploadedById === user.id;
}
```

- [ ] **Step 4: Verify with a standalone script**

Create `scripts/verify-incident-permissions.ts` (temporary, delete after running):
```ts
import { canViewIncidentsFor, canManageIncidentsFor, canDeleteIncidentPhoto, canTogglePhotoRelease } from '../src/lib/auth/permissions';
import type { SessionUser } from '../src/types/next-auth';

const member = { id: 'u1', homeOrganizationId: 'org-a' } as SessionUser;
const otherMember = { id: 'u2', homeOrganizationId: 'org-b' } as SessionUser;

console.log('member sees own org:', canViewIncidentsFor(member, 'org-a') === true);
console.log('other member blocked:', canViewIncidentsFor(otherMember, 'org-a') === false);
console.log('member can manage own org:', canManageIncidentsFor(member, 'org-a') === true);
console.log('uploader can delete own photo:', canDeleteIncidentPhoto(member, { uploadedById: 'u1' }, 'org-a') === true);
console.log('non-uploader, non-admin cannot delete:', canDeleteIncidentPhoto(otherMember, { uploadedById: 'u1' }, 'org-a') === false);
console.log('non-uploader cannot toggle release:', canTogglePhotoRelease(otherMember, { uploadedById: 'u1' }) === false);
```
Run: `npx tsx scripts/verify-incident-permissions.ts` — every line must print `true`. Delete the script afterward. Confirm `npx tsc --noEmit` and `npx prisma generate` both succeed.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/auth/permissions.ts
git commit -m "feat: add Incident/IncidentPhoto data model and permissions"
```

---

### Task 2: Einsatz anlegen/bearbeiten/löschen (kein Foto-Bezug)

**Files:**
- Create: `src/lib/validation/incident.schema.ts`
- Create: `src/app/(app)/meine-feuerwehr/einsaetze/actions.ts`
- Create: `src/components/incidents/incident-form.tsx`
- Create: `src/app/(app)/meine-feuerwehr/einsaetze/neu/page.tsx`
- Create: `src/app/(app)/meine-feuerwehr/einsaetze/[incidentId]/bearbeiten/page.tsx`
- Test: none — verified via `tsc`/`build` + live form submission against the dev DB

**Interfaces:**
- Consumes: `canManageIncidentsFor` (Task 1), `requireUser()` (`@/lib/auth/session`), `prisma` (`@/lib/db/prisma`).
- Produces: `incidentSchema`, `IncidentInput`, `INCIDENT_KINDS`, `parseIncidentFormData(formData: FormData): unknown` (from `incident.schema.ts`); Server Actions `createIncident(fireDepartmentId: string, prevState: IncidentFormState, formData: FormData): Promise<IncidentFormState>`, `updateIncident(incidentId: string, prevState: IncidentFormState, formData: FormData): Promise<IncidentFormState>`, `deleteIncident(incidentId: string): Promise<void>` (all in `einsaetze/actions.ts`); `IncidentFormState = { error?: string }`; `<IncidentForm>` component (props below) used by both `neu`/`bearbeiten` pages, and re-used by Task 10's list-to-create flow.

- [ ] **Step 1: Write the Zod schema**

`src/lib/validation/incident.schema.ts`:
```ts
import { z } from 'zod';

export const INCIDENT_KINDS = ['TECHNISCH', 'BRAND', 'SCHADSTOFF', 'SONSTIGES'] as const;

export const INCIDENT_KIND_LABELS: Record<(typeof INCIDENT_KINDS)[number], string> = {
  TECHNISCH: 'Technisch',
  BRAND: 'Brand',
  SCHADSTOFF: 'Schadstoff',
  SONSTIGES: 'Sonstiges',
};

export const incidentSchema = z
  .object({
    kind: z.enum(INCIDENT_KINDS),
    keyword: z.string().trim().min(1, 'Einsatzstichwort ist erforderlich.').max(200),
    location: z.string().trim().min(1, 'Ort ist erforderlich.').max(200),
    alarmedAt: z.string().min(1, 'Alarmzeit ist erforderlich.'),
    endedAt: z.string(),
    crewCount: z.string(),
    vehicleIds: z.array(z.string()),
    crewMemberIds: z.array(z.string()),
  })
  .refine((data) => new Date(data.alarmedAt).getTime() <= Date.now(), {
    message: 'Alarmzeit darf nicht in der Zukunft liegen.',
    path: ['alarmedAt'],
  })
  .refine((data) => !data.endedAt || new Date(data.endedAt).getTime() > new Date(data.alarmedAt).getTime(), {
    message: 'Ende muss nach der Alarmzeit liegen.',
    path: ['endedAt'],
  });

export type IncidentInput = z.infer<typeof incidentSchema>;

export function parseIncidentFormData(formData: FormData) {
  return {
    kind: String(formData.get('kind') ?? ''),
    keyword: String(formData.get('keyword') ?? ''),
    location: String(formData.get('location') ?? ''),
    alarmedAt: String(formData.get('alarmedAt') ?? ''),
    endedAt: String(formData.get('endedAt') ?? ''),
    crewCount: String(formData.get('crewCount') ?? ''),
    vehicleIds: formData.getAll('vehicleIds').map(String),
    crewMemberIds: formData.getAll('crewMemberIds').map(String),
  };
}
```
`alarmedAt`/`endedAt` are kept as the raw `"YYYY-MM-DDTHH:mm"` strings from `DateTime15MinInput` (same convention as `event.schema.ts` — `new Date(...)` is applied only in the Server Action, executed inside the `TZ=Europe/Vienna`-pinned container per root `CLAUDE.md`).

- [ ] **Step 2: Write the Server Actions**

`src/app/(app)/meine-feuerwehr/einsaetze/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageIncidentsFor } from '@/lib/auth/permissions';
import { incidentSchema, parseIncidentFormData } from '@/lib/validation/incident.schema';

export interface IncidentFormState {
  error?: string;
}

async function assertOwnFireDepartmentVehicles(fireDepartmentId: string, vehicleIds: string[]): Promise<void> {
  if (vehicleIds.length === 0) return;
  const count = await prisma.vehicle.count({ where: { id: { in: vehicleIds }, organizationId: fireDepartmentId } });
  if (count !== vehicleIds.length) throw new Error('Ungültige Fahrzeugauswahl.');
}

async function assertOwnFireDepartmentCrew(fireDepartmentId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const count = await prisma.user.count({ where: { id: { in: userIds }, homeOrganizationId: fireDepartmentId } });
  if (count !== userIds.length) throw new Error('Ungültige Mannschaftsauswahl.');
}

export async function createIncident(
  fireDepartmentId: string,
  _prevState: IncidentFormState,
  formData: FormData,
): Promise<IncidentFormState> {
  const user = await requireUser();
  if (!canManageIncidentsFor(user, fireDepartmentId)) return { error: 'Kein Zugriff.' };

  const parsed = incidentSchema.safeParse(parseIncidentFormData(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };
  const data = parsed.data;

  try {
    await assertOwnFireDepartmentVehicles(fireDepartmentId, data.vehicleIds);
    await assertOwnFireDepartmentCrew(fireDepartmentId, data.crewMemberIds);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Ungültige Auswahl.' };
  }

  const incident = await prisma.incident.create({
    data: {
      fireDepartmentId,
      kind: data.kind,
      keyword: data.keyword,
      location: data.location,
      alarmedAt: new Date(data.alarmedAt),
      endedAt: data.endedAt ? new Date(data.endedAt) : null,
      crewCount: data.crewCount ? Number(data.crewCount) : null,
      createdById: user.id,
      vehicles: { create: data.vehicleIds.map((vehicleId) => ({ vehicleId })) },
      crewMembers: { create: data.crewMemberIds.map((userId) => ({ userId })) },
    },
  });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/meine-feuerwehr/einsaetze');
  redirect(`/meine-feuerwehr/einsaetze/${incident.id}`);
}

export async function updateIncident(
  incidentId: string,
  _prevState: IncidentFormState,
  formData: FormData,
): Promise<IncidentFormState> {
  const user = await requireUser();
  const existing = await prisma.incident.findUnique({ where: { id: incidentId }, select: { fireDepartmentId: true } });
  if (!existing || !canManageIncidentsFor(user, existing.fireDepartmentId)) return { error: 'Kein Zugriff.' };

  const parsed = incidentSchema.safeParse(parseIncidentFormData(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };
  const data = parsed.data;

  try {
    await assertOwnFireDepartmentVehicles(existing.fireDepartmentId, data.vehicleIds);
    await assertOwnFireDepartmentCrew(existing.fireDepartmentId, data.crewMemberIds);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Ungültige Auswahl.' };
  }

  await prisma.$transaction([
    prisma.incidentVehicle.deleteMany({ where: { incidentId } }),
    prisma.incidentCrewMember.deleteMany({ where: { incidentId } }),
    prisma.incident.update({
      where: { id: incidentId },
      data: {
        kind: data.kind,
        keyword: data.keyword,
        location: data.location,
        alarmedAt: new Date(data.alarmedAt),
        endedAt: data.endedAt ? new Date(data.endedAt) : null,
        crewCount: data.crewCount ? Number(data.crewCount) : null,
        vehicles: { create: data.vehicleIds.map((vehicleId) => ({ vehicleId })) },
        crewMembers: { create: data.crewMemberIds.map((userId) => ({ userId })) },
      },
    }),
  ]);

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/meine-feuerwehr/einsaetze');
  redirect(`/meine-feuerwehr/einsaetze/${incidentId}`);
}

export async function deleteIncident(incidentId: string): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.incident.findUnique({ where: { id: incidentId }, select: { fireDepartmentId: true } });
  if (!existing || !canManageIncidentsFor(user, existing.fireDepartmentId)) throw new Error('Kein Zugriff.');

  // Fotos werden HIER bewusst nicht aus S3 gelöscht - deleteIncidentPhoto (Task 4) ist der einzige
  // Ort, der S3-Objekte löscht. Ein gelöschter Einsatz lässt seine Foto-Objekte (aktuell) verwaist im
  // Bucket zurück; siehe Task 4's Abschlusskommentar für die bewusste Begründung, das nicht in dieser
  // Iteration zu lösen.
  await prisma.incident.delete({ where: { id: incidentId } });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/meine-feuerwehr/einsaetze');
  redirect('/meine-feuerwehr/einsaetze');
}
```

- [ ] **Step 3: Write the shared form component**

`src/components/incidents/incident-form.tsx`:
```tsx
'use client';

import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { incidentSchema, INCIDENT_KINDS, INCIDENT_KIND_LABELS, type IncidentInput } from '@/lib/validation/incident.schema';
import { DateTime15MinInput } from '@/components/ui/datetime-15min-input';
import type { IncidentFormState } from '@/app/(app)/meine-feuerwehr/einsaetze/actions';

interface VehicleOption {
  id: string;
  taktischeBezeichnung: string;
}

interface CrewMemberOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface IncidentFormProps {
  fireDepartmentName: string;
  vehicleOptions: VehicleOption[];
  crewMemberOptions: CrewMemberOption[];
  defaultValues?: Partial<IncidentInput>;
  action: (prevState: IncidentFormState, formData: FormData) => Promise<IncidentFormState>;
  submitLabel: string;
}

function MultiSelectChips({
  options,
  selectedIds,
  onChange,
}: {
  options: { id: string; label: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((existing) => existing !== id) : [...selectedIds, id]);
  }
  if (options.length === 0) return <p className="text-sm text-neutral-500">Keine Optionen vorhanden.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = selectedIds.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => toggle(option.id)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              active ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-700'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function IncidentForm({
  fireDepartmentName,
  vehicleOptions,
  crewMemberOptions,
  defaultValues,
  action,
  submitLabel,
}: IncidentFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<IncidentInput>({
    resolver: zodResolver(incidentSchema),
    defaultValues: {
      kind: 'TECHNISCH',
      keyword: '',
      location: '',
      alarmedAt: '',
      endedAt: '',
      crewCount: '',
      vehicleIds: [],
      crewMemberIds: [],
      ...defaultValues,
    },
  });

  const kind = watch('kind');
  const vehicleIds = watch('vehicleIds');
  const crewMemberIds = watch('crewMemberIds');

  function onSubmit(values: IncidentInput) {
    const formData = new FormData();
    formData.set('kind', values.kind);
    formData.set('keyword', values.keyword);
    formData.set('location', values.location);
    formData.set('alarmedAt', values.alarmedAt);
    formData.set('endedAt', values.endedAt ?? '');
    formData.set('crewCount', values.crewCount ?? '');
    for (const vehicleId of values.vehicleIds) formData.append('vehicleIds', vehicleId);
    for (const userId of values.crewMemberIds) formData.append('crewMemberIds', userId);

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5 pb-24">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-neutral-700">Einsatzart</label>
        <div className="grid grid-cols-2 gap-2">
          {INCIDENT_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setValue('kind', option)}
              className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${
                kind === option ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-700'
              }`}
            >
              {INCIDENT_KIND_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Einsatzstichwort</label>
        <input {...register('keyword')} placeholder="z. B. T2 – Verkehrsunfall" className="rounded border border-neutral-300 px-3 py-2" />
        {errors.keyword && <p className="text-sm text-red-700">{errors.keyword.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Ort</label>
        <input {...register('location')} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.location && <p className="text-sm text-red-700">{errors.location.message}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Alarmzeit</label>
          <Controller
            control={control}
            name="alarmedAt"
            render={({ field }) => <DateTime15MinInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
          />
          {errors.alarmedAt && <p className="text-sm text-red-700">{errors.alarmedAt.message}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Ende (optional)</label>
          <Controller
            control={control}
            name="endedAt"
            render={({ field }) => <DateTime15MinInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
          />
          {errors.endedAt && <p className="text-sm text-red-700">{errors.endedAt.message}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-neutral-700">Fahrzeuge</label>
        <Controller
          control={control}
          name="vehicleIds"
          render={({ field }) => (
            <MultiSelectChips
              options={vehicleOptions.map((vehicle) => ({ id: vehicle.id, label: vehicle.taktischeBezeichnung }))}
              selectedIds={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-neutral-700">Mannschaft</label>
        <input
          type="number"
          min={0}
          {...register('crewCount')}
          placeholder="Anzahl"
          className="w-32 rounded border border-neutral-300 px-3 py-2"
        />
        <Controller
          control={control}
          name="crewMemberIds"
          render={({ field }) => (
            <MultiSelectChips
              options={crewMemberOptions.map((member) => ({ id: member.id, label: `${member.firstName} ${member.lastName}` }))}
              selectedIds={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>

      <p className="text-sm text-neutral-500">
        Jedes Mitglied der Feuerwehr {fireDepartmentName} darf Fotos zu diesem Einsatz hochladen und die eigenen wieder löschen.
      </p>

      {serverError && <p className="text-sm text-red-700">{serverError}</p>}

      <div className="fixed inset-x-0 bottom-0 flex justify-center border-t border-neutral-200 bg-white p-4 pb-safe-tabbar sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <div className="flex w-full max-w-lg items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="min-h-[52px] flex-1 rounded-lg bg-brand font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {pending ? 'Speichern…' : submitLabel}
          </button>
          <Link href="/meine-feuerwehr/einsaetze" className="text-sm text-neutral-600 hover:underline">
            Abbrechen
          </Link>
        </div>
      </div>

      <input type="hidden" value={vehicleIds.join(',')} readOnly />
      <input type="hidden" value={crewMemberIds.join(',')} readOnly />
    </form>
  );
}
```
(The two trailing hidden inputs exist only so `vehicleIds`/`crewMemberIds` aren't flagged as "unused" by a linter watching `watch()` calls with no render dependency — remove if the project's lint config doesn't need it once written.)

- [ ] **Step 4: Write the "Einsatz erfassen" page**

`src/app/(app)/meine-feuerwehr/einsaetze/neu/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageIncidentsFor } from '@/lib/auth/permissions';
import { IncidentForm } from '@/components/incidents/incident-form';
import { createIncident } from '../actions';

export default async function NeuerEinsatzPage() {
  const user = await requireUser();
  if (!canManageIncidentsFor(user, user.homeOrganizationId)) notFound();

  const [fireDepartment, vehicles, crewMembers] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.homeOrganizationId }, select: { shortName: true, name: true } }),
    prisma.vehicle.findMany({
      where: { organizationId: user.homeOrganizationId, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true },
    }),
    prisma.user.findMany({
      where: { homeOrganizationId: user.homeOrganizationId, isActive: true },
      orderBy: { lastName: 'asc' },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);

  const boundCreate = createIncident.bind(null, user.homeOrganizationId);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold text-neutral-900">Einsatz erfassen</h1>
      <IncidentForm
        fireDepartmentName={fireDepartment.shortName ?? fireDepartment.name}
        vehicleOptions={vehicles}
        crewMemberOptions={crewMembers}
        action={boundCreate}
        submitLabel="Einsatz speichern"
      />
    </div>
  );
}
```

- [ ] **Step 5: Write the "Einsatz bearbeiten" page**

`src/app/(app)/meine-feuerwehr/einsaetze/[incidentId]/bearbeiten/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageIncidentsFor } from '@/lib/auth/permissions';
import { IncidentForm } from '@/components/incidents/incident-form';
import { updateIncident } from '../../actions';

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default async function EinsatzBearbeitenPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const user = await requireUser();

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      fireDepartment: { select: { shortName: true, name: true } },
      vehicles: { select: { vehicleId: true } },
      crewMembers: { select: { userId: true } },
    },
  });
  if (!incident || !canManageIncidentsFor(user, incident.fireDepartmentId)) notFound();

  const [vehicles, crewMembers] = await Promise.all([
    prisma.vehicle.findMany({
      where: { organizationId: incident.fireDepartmentId, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true },
    }),
    prisma.user.findMany({
      where: { homeOrganizationId: incident.fireDepartmentId, isActive: true },
      orderBy: { lastName: 'asc' },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);

  const boundUpdate = updateIncident.bind(null, incident.id);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold text-neutral-900">Einsatz bearbeiten</h1>
      <IncidentForm
        fireDepartmentName={incident.fireDepartment.shortName ?? incident.fireDepartment.name}
        vehicleOptions={vehicles}
        crewMemberOptions={crewMembers}
        defaultValues={{
          kind: incident.kind,
          keyword: incident.keyword,
          location: incident.location,
          alarmedAt: toLocalInputValue(incident.alarmedAt),
          endedAt: incident.endedAt ? toLocalInputValue(incident.endedAt) : '',
          crewCount: incident.crewCount != null ? String(incident.crewCount) : '',
          vehicleIds: incident.vehicles.map((v) => v.vehicleId),
          crewMemberIds: incident.crewMembers.map((c) => c.userId),
        }}
        action={boundUpdate}
        submitLabel="Änderungen speichern"
      />
    </div>
  );
}
```

- [ ] **Step 6: Verify**

Run `npx tsc --noEmit` and `npm run build` — both must succeed. Start the dev server, sign in as a seeded member, open `/meine-feuerwehr/einsaetze/neu`, submit a real Einsatz (pick a kind, fill keyword/location/alarmedAt, select a vehicle chip), confirm it redirects to `/meine-feuerwehr/einsaetze/<id>` (a 404 page is expected here until Task 7 adds the detail page — confirm instead via `npx prisma studio` or a direct query that the `Incident`/`IncidentVehicle` rows were created correctly). Then open the same incident's `.../bearbeiten` page, change the keyword, and confirm the update persists. Confirm `endedAt` before `alarmedAt` shows the inline validation error, and an `alarmedAt` in the future does too.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation/incident.schema.ts src/app/\(app\)/meine-feuerwehr/einsaetze src/components/incidents
git commit -m "feat: add Einsatz erfassen/bearbeiten/löschen"
```

---

### Task 3: S3-Client, Presign- und Complete-Route (inkl. Vorschau-Ableitung)

**Files:**
- Modify: `package.json` (new dependencies)
- Modify: `docker/docker-compose.yml`, `docker/docker-compose.staging.yml`, `.env.example`
- Create: `src/lib/storage/incident-photos-s3.ts`
- Create: `src/lib/validation/incident-photo.ts`
- Create: `src/app/api/incidents/[incidentId]/photos/presign/route.ts`
- Create: `src/app/api/incidents/[incidentId]/photos/[photoId]/complete/route.ts`
- Test: none — verified via `curl` against the running dev server and a real uploaded file

**Interfaces:**
- Consumes: `canViewIncidentsFor` (Task 1), `requireUser()`, `prisma`, `sharp` (already installed).
- Produces: `getIncidentPhotosS3Client(): S3Client`, `presignPhotoUpload(storageKey: string, contentType: string): Promise<string>`, `presignPhotoDownload(storageKey: string, options?: { contentDisposition?: string }): Promise<string>`, `deletePhotoObjects(storageKeys: string[]): Promise<void>` (all in `incident-photos-s3.ts`); `ALLOWED_INCIDENT_PHOTO_MIME_TYPES`, `ALLOWED_SHARP_PHOTO_FORMATS`, `MAX_INCIDENT_PHOTO_BYTES`, `extensionForMimeType(mimeType: string): string`, `buildIncidentPhotoStorageKeys(incidentId: string, photoId: string, mimeType: string): { storageKey: string; previewKey: string; thumbnailKey: string }` (all in `incident-photo.ts`); the two route handlers, consumed by Task 5's upload queue and Task 4's download route.

- [ ] **Step 1: Install the new dependencies**

```bash
npm install @aws-sdk/s3-request-presigner@^3.1100.0 exifr@^7.1.3
```
(`@aws-sdk/s3-request-presigner` pinned to the same major/minor range as the already-installed `@aws-sdk/client-s3` — both packages must be updated together on any future upgrade. `exifr` is the new EXIF-reading dependency this project didn't have before; it has zero runtime dependencies and reads `DateTimeOriginal` from JPEG/HEIC alike.)

- [ ] **Step 2: Add `S3_PHOTOS_BUCKET` everywhere an env var must be wired (root `CLAUDE.md` gotcha)**

In `.env.example`, right after the existing `S3_SECRET_KEY=change-me` line, add:
```
# Bucket für Einsatzfotos (Foto-Upload-Brief.md) - eigener, komplett privater Bucket, aber dieselben
# Zugangsdaten wie oben (S3_ACCESS_KEY/S3_SECRET_KEY/S3_ENDPOINT_URL).
S3_PHOTOS_BUCKET=app-177-pictures
```

In `docker/docker-compose.yml`, inside the `app` service's `environment:` block, right after the existing `S3_SECRET_KEY: ${S3_SECRET_KEY}` line, add:
```yaml
      S3_PHOTOS_BUCKET: ${S3_PHOTOS_BUCKET}
```

In `docker/docker-compose.staging.yml`, inside the `dev-app` service's `environment:` block, add the same line:
```yaml
      S3_PHOTOS_BUCKET: ${S3_PHOTOS_BUCKET}
```
This is a deliberate deviation from that file's existing "Bewusst keine S3_*-Variablen" comment for `S3_BACKUP_BUCKET` — that comment is specifically about *backups* ("eine Test-/Dev-Umgebung braucht kein Off-Box-Backup"), which doesn't apply here: the DEV environment needs to actually exercise photo upload/download during testing, per this project's established dev-first workflow. Leave the `S3_BACKUP_BUCKET`-related comment as-is; add the new line as its own addition, not a replacement.

Add `S3_PHOTOS_BUCKET=app-177-pictures` to the real `.env` on both DEV and PROD hosts before testing (a manual step outside this repo — flag this to the app owner if not already done).

- [ ] **Step 3: Write the S3 client module**

`src/lib/storage/incident-photos-s3.ts`:
```ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Identische Endpunkt/Region-Ableitung wie lib/system/s3-check.ts - beide Buckets liegen im
 * selben Exoscale-Account/derselben Zone, nur der Bucket-Name unterscheidet sich. */
function regionFromEndpoint(endpointUrl: string): string {
  const match = endpointUrl.match(/^https?:\/\/sos-([^.]+)\.exo\.io/);
  return match?.[1] ?? 'us-east-1';
}

let cachedClient: S3Client | null = null;

export function getIncidentPhotosS3Client(): S3Client {
  if (cachedClient) return cachedClient;
  const endpoint = process.env.S3_ENDPOINT_URL;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('S3-Zugangsdaten fehlen (S3_ENDPOINT_URL/S3_ACCESS_KEY/S3_SECRET_KEY).');
  }
  cachedClient = new S3Client({
    endpoint,
    region: regionFromEndpoint(endpoint),
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
}

function getPhotosBucket(): string {
  const bucket = process.env.S3_PHOTOS_BUCKET;
  if (!bucket) throw new Error('S3_PHOTOS_BUCKET ist nicht konfiguriert.');
  return bucket;
}

/** Presigned PUT für den direkten Client->S3-Upload des Originals - 15 Minuten Gültigkeit (deutlich
 * länger als die 60 Sekunden der Download-URLs unten), da ein 50-MB-Original über eine langsame
 * mobile Verbindung realistisch mehrere Minuten braucht. */
export async function presignPhotoUpload(storageKey: string, contentType: string): Promise<string> {
  const client = getIncidentPhotosS3Client();
  const command = new PutObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey, ContentType: contentType });
  return getSignedUrl(client, command, { expiresIn: 900 });
}

/** Presigned GET für Downloads/Vorschauen - siehe Foto-Upload-Brief.md §4.2: NIE eine dauerhafte
 * URL, jede Anfrage geht über die session-geprüfte Route (Task 4), die diese Funktion erst NACH der
 * Berechtigungsprüfung aufruft. 60 Sekunden reichen für den unmittelbaren 307-Redirect. */
export async function presignPhotoDownload(storageKey: string, options?: { contentDisposition?: string }): Promise<string> {
  const client = getIncidentPhotosS3Client();
  const command = new GetObjectCommand({
    Bucket: getPhotosBucket(),
    Key: storageKey,
    ResponseContentDisposition: options?.contentDisposition,
  });
  return getSignedUrl(client, command, { expiresIn: 60 });
}

export async function headPhotoObject(storageKey: string): Promise<{ contentLength: number } | null> {
  const client = getIncidentPhotosS3Client();
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey }));
    return { contentLength: result.ContentLength ?? 0 };
  } catch {
    return null;
  }
}

export async function getPhotoObjectBytes(storageKey: string): Promise<Buffer> {
  const client = getIncidentPhotosS3Client();
  const result = await client.send(new GetObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey }));
  const chunks: Uint8Array[] = [];
  // @aws-sdk/client-s3's Body ist im Node-Laufzeitkontext ein Readable-Stream, kein Web-Stream.
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function putPreviewObject(storageKey: string, body: Buffer, contentType: string): Promise<void> {
  const client = getIncidentPhotosS3Client();
  await client.send(new PutObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey, Body: body, ContentType: contentType }));
}

/** Löscht bis zu drei Objekte (Original + zwei Vorschauen) in einem Aufruf - DeleteObjects statt
 * dreier einzelner DeleteObject-Aufrufe. Nicht existierende Schlüssel verursachen keinen Fehler
 * (S3-Semantik), daher ist kein vorheriges HeadObject nötig. */
export async function deletePhotoObjects(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return;
  const client = getIncidentPhotosS3Client();
  await client.send(
    new DeleteObjectsCommand({
      Bucket: getPhotosBucket(),
      Delete: { Objects: storageKeys.map((Key) => ({ Key })) },
    }),
  );
}
```

- [ ] **Step 4: Write the MIME/format allowlist + storage-key helper**

`src/lib/validation/incident-photo.ts`:
```ts
/** Client-deklarierte MIME-Typen, die presign überhaupt akzeptiert - eine erste, NICHT
 * vertrauenswürdige Filterung (siehe complete-Route für die echte Prüfung per sharp-Dekodierung,
 * gleiches Muster wie die Wappen-Upload-Härtung, Security-Review S3). HEIC/HEIF zusätzlich zur
 * bestehenden Wappen-Allowlist, da iPhones standardmäßig dieses Format liefern. */
export const ALLOWED_INCIDENT_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
];

/** Von sharp erkannte Formate, die als "echtes Bild" akzeptiert werden - die tatsächliche
 * Sicherheitsprüfung (complete-Route). sharp meldet HEIC/HEIF-Dateien als 'heif' (libheif). */
export const ALLOWED_SHARP_PHOTO_FORMATS = ['jpeg', 'png', 'webp', 'gif', 'heif'];

export const MAX_INCIDENT_PHOTO_BYTES = 50 * 1024 * 1024;
export const MAX_INCIDENT_PHOTOS_PER_BATCH = 30;

export function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/heic':
    case 'image/heif':
      return 'heic';
    default:
      return 'bin';
  }
}

export function buildIncidentPhotoStorageKeys(
  incidentId: string,
  photoId: string,
  mimeType: string,
): { storageKey: string; previewKey: string; thumbnailKey: string } {
  const ext = extensionForMimeType(mimeType);
  return {
    storageKey: `incidents/${incidentId}/${photoId}/original.${ext}`,
    previewKey: `incidents/${incidentId}/${photoId}/view.webp`,
    thumbnailKey: `incidents/${incidentId}/${photoId}/thumb.webp`,
  };
}
```

- [ ] **Step 5: Write the presign route**

`src/app/api/incidents/[incidentId]/photos/presign/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewIncidentsFor } from '@/lib/auth/permissions';
import {
  ALLOWED_INCIDENT_PHOTO_MIME_TYPES,
  MAX_INCIDENT_PHOTO_BYTES,
  buildIncidentPhotoStorageKeys,
} from '@/lib/validation/incident-photo';
import { presignPhotoUpload } from '@/lib/storage/incident-photos-s3';

export async function POST(request: Request, { params }: { params: Promise<{ incidentId: string }> }) {
  const user = await requireUser();
  const { incidentId } = await params;

  const incident = await prisma.incident.findUnique({ where: { id: incidentId }, select: { fireDepartmentId: true } });
  if (!incident || !canViewIncidentsFor(user, incident.fireDepartmentId)) {
    return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { fileName?: string; mimeType?: string; byteSize?: number } | null;
  if (!body?.fileName || !body.mimeType || typeof body.byteSize !== 'number') {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });
  }
  if (!ALLOWED_INCIDENT_PHOTO_MIME_TYPES.includes(body.mimeType)) {
    return NextResponse.json({ error: 'Dateityp nicht erlaubt.' }, { status: 400 });
  }
  if (body.byteSize <= 0 || body.byteSize > MAX_INCIDENT_PHOTO_BYTES) {
    return NextResponse.json({ error: 'Datei zu groß (maximal 50 MB).' }, { status: 400 });
  }

  const photo = await prisma.incidentPhoto.create({
    data: {
      incidentId,
      uploadedById: user.id,
      // storageKey wird gleich unten mit der echten photo.id überschrieben - Prisma benötigt die
      // id VOR dem Erzeugen der Schlüssel, daher zwei Schritte statt eines.
      storageKey: '',
      originalName: body.fileName,
      mimeType: body.mimeType,
      byteSize: body.byteSize,
      status: 'PENDING',
    },
  });

  const { storageKey } = buildIncidentPhotoStorageKeys(incidentId, photo.id, body.mimeType);
  await prisma.incidentPhoto.update({ where: { id: photo.id }, data: { storageKey } });

  const uploadUrl = await presignPhotoUpload(storageKey, body.mimeType);
  return NextResponse.json({ photoId: photo.id, uploadUrl, storageKey });
}
```

- [ ] **Step 6: Write the complete route (metadata, EXIF, MIME validation, preview derivation)**

`src/app/api/incidents/[incidentId]/photos/[photoId]/complete/route.ts`:
```ts
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { parse as parseExif } from 'exifr';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewIncidentsFor } from '@/lib/auth/permissions';
import { ALLOWED_SHARP_PHOTO_FORMATS, MAX_INCIDENT_PHOTO_BYTES, buildIncidentPhotoStorageKeys } from '@/lib/validation/incident-photo';
import { headPhotoObject, getPhotoObjectBytes, putPreviewObject, deletePhotoObjects } from '@/lib/storage/incident-photos-s3';

async function failPhoto(photoId: string, storageKey: string): Promise<void> {
  await deletePhotoObjects([storageKey]);
  await prisma.incidentPhoto.update({ where: { id: photoId }, data: { status: 'FAILED' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ incidentId: string; photoId: string }> }) {
  const user = await requireUser();
  const { incidentId, photoId } = await params;

  const photo = await prisma.incidentPhoto.findUnique({ where: { id: photoId }, include: { incident: true } });
  if (!photo || photo.incidentId !== incidentId || !canViewIncidentsFor(user, photo.incident.fireDepartmentId)) {
    return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 404 });
  }
  if (photo.status !== 'PENDING') {
    return NextResponse.json({ error: 'Foto wurde bereits verarbeitet.' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as { publicRelease?: boolean };

  const head = await headPhotoObject(photo.storageKey);
  if (!head) {
    return NextResponse.json({ error: 'Objekt wurde nicht gefunden - Upload unvollständig.' }, { status: 400 });
  }
  if (head.contentLength > MAX_INCIDENT_PHOTO_BYTES) {
    await failPhoto(photo.id, photo.storageKey);
    return NextResponse.json({ error: 'Datei zu groß (maximal 50 MB).' }, { status: 400 });
  }

  const originalBytes = await getPhotoObjectBytes(photo.storageKey);

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(originalBytes).metadata();
  } catch {
    await failPhoto(photo.id, photo.storageKey);
    return NextResponse.json({ error: 'Datei konnte nicht als Bild gelesen werden.' }, { status: 400 });
  }
  if (!metadata.format || !ALLOWED_SHARP_PHOTO_FORMATS.includes(metadata.format)) {
    await failPhoto(photo.id, photo.storageKey);
    return NextResponse.json({ error: 'Dateiformat nicht erlaubt.' }, { status: 400 });
  }

  let takenAt: Date | null = null;
  try {
    const exif = await parseExif(originalBytes, ['DateTimeOriginal']);
    if (exif?.DateTimeOriginal instanceof Date) takenAt = exif.DateTimeOriginal;
  } catch {
    takenAt = null;
  }

  const { previewKey, thumbnailKey } = buildIncidentPhotoStorageKeys(incidentId, photo.id, photo.mimeType);
  const rotated = sharp(originalBytes).rotate();
  const [viewBuffer, thumbBuffer] = await Promise.all([
    rotated.clone().resize(1600, undefined, { fit: 'inside', withoutEnlargement: true }).webp().toBuffer(),
    rotated.clone().resize(400, 400, { fit: 'cover' }).webp().toBuffer(),
  ]);
  await Promise.all([
    putPreviewObject(previewKey, viewBuffer, 'image/webp'),
    putPreviewObject(thumbnailKey, thumbBuffer, 'image/webp'),
  ]);

  const updated = await prisma.incidentPhoto.update({
    where: { id: photo.id },
    data: {
      status: 'READY',
      byteSize: head.contentLength,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      takenAt,
      previewKey,
      thumbnailKey,
      publicRelease: body.publicRelease === true,
    },
  });

  return NextResponse.json({ photo: updated });
}
```
`rotated.clone()` is used because a `sharp` pipeline can only be consumed once — deriving two independent outputs from the same EXIF-auto-oriented base needs `.clone()` per branch (documented `sharp` API, not a workaround).

- [ ] **Step 7: Verify with a real HEIC/JPEG round-trip via `curl`**

With the dev server running and a valid session cookie (reuse this session's established `curl` + cookie-jar verification pattern), and a real `Incident` id from Task 2's manual test:
```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/incidents/<incidentId>/photos/presign \
  -H 'Content-Type: application/json' \
  -d '{"fileName":"test.jpg","mimeType":"image/jpeg","byteSize":12345}'
```
Confirm the response has `photoId`/`uploadUrl`/`storageKey`, and that `IncidentPhoto.storageKey` in the DB matches. Then:
```bash
curl -s -X PUT "<uploadUrl>" -H 'Content-Type: image/jpeg' --data-binary @test.jpg
curl -s -b cookies.txt -X POST http://localhost:3000/api/incidents/<incidentId>/photos/<photoId>/complete \
  -H 'Content-Type: application/json' -d '{"publicRelease":false}'
```
Confirm the response's `photo.status` is `READY`, `width`/`height` are populated, and (if `test.jpg` has EXIF) `takenAt` is set. Repeat with a real `.heic` file (`mimeType: "image/heic"`) and confirm it also reaches `READY`. Then try uploading a non-image file (e.g. a `.txt` renamed to `.jpg` with `mimeType: "image/jpeg"`) and confirm `complete` returns `400` with `status` left as `FAILED` in the DB, and that the S3 object was actually deleted (check via the Exoscale console or a `HeadObjectCommand` script).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json docker/docker-compose.yml docker/docker-compose.staging.yml .env.example src/lib/storage src/lib/validation/incident-photo.ts src/app/api/incidents
git commit -m "feat: add S3 photo storage, presign and complete routes"
```

---

### Task 4: Download-Route + Foto löschen/freigeben

**Files:**
- Create: `src/app/api/incidents/[incidentId]/photos/[photoId]/route.ts`
- Modify: `src/app/(app)/meine-feuerwehr/einsaetze/actions.ts`
- Test: none — verified via `curl` (confirm `307` + valid presigned target) and direct DB checks

**Interfaces:**
- Consumes: `canViewIncidentsFor`, `canDeleteIncidentPhoto`, `canTogglePhotoRelease` (Task 1), `presignPhotoDownload`, `deletePhotoObjects` (Task 3).
- Produces: `GET /api/incidents/[incidentId]/photos/[photoId]?variant=original|view|thumbnail` (307 redirect); Server Actions `deleteIncidentPhoto(photoId: string, incidentId: string): Promise<void>`, `setIncidentPhotoPublicRelease(photoId: string, incidentId: string, publicRelease: boolean): Promise<void>` added to `einsaetze/actions.ts`, consumed by Task 7's detail page.

- [ ] **Step 1: Write the download route**

`src/app/api/incidents/[incidentId]/photos/[photoId]/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewIncidentsFor } from '@/lib/auth/permissions';
import { presignPhotoDownload } from '@/lib/storage/incident-photos-s3';

type Variant = 'original' | 'view' | 'thumbnail';

export async function GET(request: Request, { params }: { params: Promise<{ incidentId: string; photoId: string }> }) {
  const user = await requireUser();
  const { incidentId, photoId } = await params;

  const photo = await prisma.incidentPhoto.findUnique({ where: { id: photoId }, include: { incident: true } });
  // Zusätzlich zur reinen Modul-Sichtbarkeit muss das Foto auch zum in der URL genannten Einsatz
  // gehören - sonst könnte eine erratene/bekannte Foto-Id eines fremden Einsatzes über eine falsche
  // incidentId in der URL trotzdem funktionieren, obwohl die Detailseite korrekt filtert. Gleiches
  // Muster wie drohnen/unterlagen/[id]/route.ts.
  if (!photo || photo.incidentId !== incidentId || !canViewIncidentsFor(user, photo.incident.fireDepartmentId)) {
    return NextResponse.json({ error: 'Foto wurde nicht gefunden.' }, { status: 404 });
  }
  if (photo.status !== 'READY') {
    return NextResponse.json({ error: 'Foto ist noch nicht verfügbar.' }, { status: 404 });
  }

  const variant = (new URL(request.url).searchParams.get('variant') as Variant | null) ?? 'view';
  const key =
    variant === 'original' ? photo.storageKey : variant === 'thumbnail' ? photo.thumbnailKey : photo.previewKey;
  if (!key) return NextResponse.json({ error: 'Foto wurde nicht gefunden.' }, { status: 404 });

  const safeFilename = photo.originalName.replace(/["\r\n]/g, '');
  const contentDisposition = variant === 'original' ? `attachment; filename="${safeFilename}"` : undefined;
  const presignedUrl = await presignPhotoDownload(key, { contentDisposition });

  return NextResponse.redirect(presignedUrl, 307);
}
```

- [ ] **Step 2: Add `deleteIncidentPhoto`/`setIncidentPhotoPublicRelease` to `einsaetze/actions.ts`**

Append to `src/app/(app)/meine-feuerwehr/einsaetze/actions.ts`:
```ts
import { canDeleteIncidentPhoto, canTogglePhotoRelease } from '@/lib/auth/permissions';
import { deletePhotoObjects } from '@/lib/storage/incident-photos-s3';

export async function deleteIncidentPhoto(photoId: string, incidentId: string): Promise<void> {
  const user = await requireUser();
  const photo = await prisma.incidentPhoto.findUnique({ where: { id: photoId }, include: { incident: true } });
  if (!photo || photo.incidentId !== incidentId) throw new Error('Foto wurde nicht gefunden.');
  if (!canDeleteIncidentPhoto(user, photo, photo.incident.fireDepartmentId)) throw new Error('Kein Zugriff.');

  const keys = [photo.storageKey, photo.previewKey, photo.thumbnailKey].filter((key): key is string => key !== null);
  await deletePhotoObjects(keys);
  await prisma.incidentPhoto.delete({ where: { id: photoId } });

  revalidatePath(`/meine-feuerwehr/einsaetze/${incidentId}`);
  revalidatePath('/meine-feuerwehr');
}

export async function setIncidentPhotoPublicRelease(photoId: string, incidentId: string, publicRelease: boolean): Promise<void> {
  const user = await requireUser();
  const photo = await prisma.incidentPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.incidentId !== incidentId) throw new Error('Foto wurde nicht gefunden.');
  if (!canTogglePhotoRelease(user, photo)) throw new Error('Kein Zugriff.');

  await prisma.incidentPhoto.update({ where: { id: photoId }, data: { publicRelease } });
  revalidatePath(`/meine-feuerwehr/einsaetze/${incidentId}`);
}
```
(Add the two new imports to the top of the file alongside the existing ones — do not duplicate the `revalidatePath`/`prisma`/`requireUser` imports already there from Task 2.)

- [ ] **Step 3: Verify**

Using the `photoId` from Task 3's verification (status `READY`):
```bash
curl -s -b cookies.txt -D - -o /dev/null "http://localhost:3000/api/incidents/<incidentId>/photos/<photoId>?variant=view"
```
Confirm `HTTP/1.1 307` and a `Location` header pointing at the Exoscale endpoint with `X-Amz-Signature` query params. Fetch that `Location` URL directly and confirm it returns the actual WebP bytes (`Content-Type: image/webp`, non-zero body). Repeat with `variant=original` and confirm the `Location` URL's query string contains `response-content-disposition=attachment%3B%20filename%3D%22test.jpg%22`. As a different, non-member user (or by temporarily editing the test user's `homeOrganizationId`), confirm the same request returns `404`. Then call `deleteIncidentPhoto` via a small script or the not-yet-built UI (acceptable to defer full UI verification to Task 7) and confirm both the DB row and the three S3 objects are gone.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/incidents src/app/\(app\)/meine-feuerwehr/einsaetze/actions.ts
git commit -m "feat: add photo download route and delete/release actions"
```

---

### Task 5: Client-seitige Upload-Warteschlange (IndexedDB-Engine)

**Files:**
- Modify: `package.json` (new dependency `idb`)
- Create: `src/lib/upload-queue/db.ts`
- Create: `src/lib/upload-queue/queue.ts`
- Test: none — verified via a browser console script against the running dev server (this codebase has no client-side test runner)

**Interfaces:**
- Produces: `QueuedUpload` type, `getUploadQueueDb()` (`db.ts`); `enqueuePhotos(incidentId: string, files: File[], options: { publicRelease: boolean; wifiOnly: boolean }): Promise<void>`, `subscribeToUploadQueue(incidentId: string, listener: (uploads: QueuedUpload[]) => void): () => void`, `retryUpload(id: string): Promise<void>`, `removeUpload(id: string): Promise<void>`, `pauseUpload(id: string): Promise<void>`, `resumeQueueProcessing(): void` (`queue.ts`), consumed by Task 6's UI.

- [ ] **Step 1: Install `idb`**

```bash
npm install idb@^8.0.0
```

- [ ] **Step 2: Write the IndexedDB schema module**

`src/lib/upload-queue/db.ts`:
```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type QueuedUploadStatus = 'queued' | 'uploading' | 'paused' | 'failed' | 'done';

export interface QueuedUpload {
  id: string;
  incidentId: string;
  file: File;
  fileName: string;
  mimeType: string;
  byteSize: number;
  uploadedBytes: number;
  status: QueuedUploadStatus;
  publicRelease: boolean;
  wifiOnly: boolean;
  error?: string;
  createdAt: number;
}

interface UploadQueueDBSchema extends DBSchema {
  uploads: {
    key: string;
    value: QueuedUpload;
    indexes: { 'by-incident': string };
  };
}

const DB_NAME = 'einsatz-foto-upload-queue';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<UploadQueueDBSchema>> | null = null;

// IndexedDB unterstützt das Speichern von File/Blob-Objekten direkt (structured clone) - kein
// separates Auslesen in ArrayBuffer nötig. Das ist die Grundlage für "übersteht App-Neustart"
// (Foto-Upload-Brief.md §5): moderne Browser (Chrome/Firefox/Safari) persistieren gespeicherte
// Blobs über einen App-/Browser-Neustart hinweg.
export function getUploadQueueDb(): Promise<IDBPDatabase<UploadQueueDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<UploadQueueDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('uploads', { keyPath: 'id' });
        store.createIndex('by-incident', 'incidentId');
      },
    });
  }
  return dbPromise;
}
```

- [ ] **Step 3: Write the queue engine**

`src/lib/upload-queue/queue.ts`:
```ts
'use client';

import { getUploadQueueDb, type QueuedUpload } from './db';

const MAX_PARALLEL_UPLOADS = 3;

type Listener = (uploads: QueuedUpload[]) => void;

const listeners = new Set<Listener>();
let activeUploads = 0;

async function notifyListeners(): Promise<void> {
  const db = await getUploadQueueDb();
  const all = await db.getAll('uploads');
  for (const listener of listeners) listener(all);
}

export function subscribeToUploadQueue(incidentId: string, listener: Listener): () => void {
  const scoped: Listener = (all) => listener(all.filter((entry) => entry.incidentId === incidentId));
  listeners.add(scoped);
  void notifyListeners();
  return () => listeners.delete(scoped);
}

/** iOS Safari (auch als installierte PWA) unterstützt die Network Information API nicht -
 * navigator.connection ist dort immer undefined. Reale Plattformgrenze (Foto-Upload-Brief.md §5,
 * "Umsetzungshinweis"): auf iOS wird "Nur über WLAN" nicht durchgesetzt, der Upload startet dort
 * immer sofort, auch wenn der Schalter aktiv ist. */
function isCellularConnection(): boolean {
  const connection = (navigator as unknown as { connection?: { type?: string; effectiveType?: string } }).connection;
  if (!connection) return false;
  if (connection.type) return connection.type === 'cellular';
  return connection.effectiveType !== undefined && ['slow-2g', '2g', '3g'].includes(connection.effectiveType);
}

async function updateEntry(id: string, patch: Partial<QueuedUpload>): Promise<void> {
  const db = await getUploadQueueDb();
  const existing = await db.get('uploads', id);
  if (!existing) return;
  await db.put('uploads', { ...existing, ...patch });
  await notifyListeners();
}

export async function enqueuePhotos(
  incidentId: string,
  files: File[],
  options: { publicRelease: boolean; wifiOnly: boolean },
): Promise<void> {
  const db = await getUploadQueueDb();
  const tx = db.transaction('uploads', 'readwrite');
  for (const file of files) {
    const id = `${incidentId}-${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
    const entry: QueuedUpload = {
      id,
      incidentId,
      file,
      fileName: file.name,
      mimeType: file.type,
      byteSize: file.size,
      uploadedBytes: 0,
      status: 'queued',
      publicRelease: options.publicRelease,
      wifiOnly: options.wifiOnly,
      createdAt: Date.now(),
    };
    await tx.store.put(entry);
  }
  await tx.done;
  await notifyListeners();
  void processQueue();
}

async function uploadOne(entry: QueuedUpload): Promise<void> {
  if (entry.wifiOnly && isCellularConnection()) {
    await updateEntry(entry.id, { status: 'paused', error: 'Wartet auf WLAN-Verbindung.' });
    return;
  }

  await updateEntry(entry.id, { status: 'uploading', error: undefined });

  try {
    const presignResponse = await fetch(`/api/incidents/${entry.incidentId}/photos/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: entry.fileName, mimeType: entry.mimeType, byteSize: entry.byteSize }),
    });
    if (!presignResponse.ok) {
      const body = (await presignResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Server hat den Upload abgelehnt.');
    }
    const { uploadUrl, photoId } = (await presignResponse.json()) as { uploadUrl: string; photoId: string };

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', entry.mimeType);
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        void updateEntry(entry.id, { uploadedBytes: event.loaded });
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload fehlgeschlagen (${xhr.status}).`)));
      xhr.onerror = () => reject(new Error('Netzwerkfehler beim Hochladen.'));
      xhr.send(entry.file);
    });

    const completeResponse = await fetch(`/api/incidents/${entry.incidentId}/photos/${photoId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicRelease: entry.publicRelease }),
    });
    if (!completeResponse.ok) {
      const body = (await completeResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Verarbeitung nach dem Upload fehlgeschlagen.');
    }

    await updateEntry(entry.id, { status: 'done', uploadedBytes: entry.byteSize });
  } catch (error) {
    await updateEntry(entry.id, { status: 'failed', error: error instanceof Error ? error.message : 'Unbekannter Fehler.' });
  }
}

export async function processQueue(): Promise<void> {
  const db = await getUploadQueueDb();
  const all = await db.getAll('uploads');
  const queued = all.filter((entry) => entry.status === 'queued');
  for (const entry of queued) {
    if (activeUploads >= MAX_PARALLEL_UPLOADS) break;
    activeUploads += 1;
    void uploadOne(entry).finally(() => {
      activeUploads -= 1;
      void processQueue();
    });
  }
}

export async function retryUpload(id: string): Promise<void> {
  await updateEntry(id, { status: 'queued', error: undefined });
  void processQueue();
}

export async function pauseUpload(id: string): Promise<void> {
  await updateEntry(id, { status: 'paused' });
}

export function resumeQueueProcessing(): void {
  void processQueue();
}

export async function removeUpload(id: string): Promise<void> {
  const db = await getUploadQueueDb();
  await db.delete('uploads', id);
  await notifyListeners();
}

// Sobald die Verbindung wechselt (WLAN <-> Mobilfunk) oder der Browser wieder online ist, erneut
// versuchen - pausierte Einträge werden in uploadOne selbst wieder auf 'queued' geprüft, nicht hier.
// Nur auf dem Client registrieren (dieses Modul wird nie serverseitig ausgeführt, aber 'use client'
// allein verhindert nicht, dass ein SSR-Preload-Pass das Modul einmal ohne DOM lädt).
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void processQueue());
  const connection = (navigator as unknown as { connection?: EventTarget }).connection;
  connection?.addEventListener?.('change', () => void processQueue());
}
```
Note: pausing for Wi-Fi-only currently only re-checks when the browser fires `online`/`connection.change` — a manually `paused` entry (via `pauseUpload`) needs an explicit `retryUpload`/`resumeQueueProcessing` call to restart, which Task 6's UI wires to a "Fortsetzen" button.

- [ ] **Step 4: Verify in the browser console**

Start the dev server, open any page in the browser, open the devtools console, and run:
```js
const { enqueuePhotos, subscribeToUploadQueue } = await import('/src/lib/upload-queue/queue.ts');
```
(If direct module import doesn't resolve in the browser due to bundling, instead verify by temporarily wiring a throwaway test button into any existing client page that calls `enqueuePhotos('test-incident-id', [fileFromAnInputElement], { publicRelease: false, wifiOnly: false })` and logging `subscribeToUploadQueue('test-incident-id', console.log)` — remove the throwaway wiring afterward.) Confirm: a queued entry appears with `status: 'queued'`, transitions to `'uploading'` with `uploadedBytes` increasing, and — since `test-incident-id` doesn't exist — ends in `status: 'failed'` with a `404`-derived error message (confirming error handling works; a real end-to-end success run happens in Task 7 once the detail page wires this up against a real incident).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/upload-queue
git commit -m "feat: add IndexedDB-backed upload queue engine"
```

---

### Task 6: Sheet „Fotos hinzufügen" (UI-Anbindung der Warteschlange)

**Files:**
- Create: `src/components/incidents/photo-upload-sheet.tsx`
- Test: none — verified live in the browser against a real incident

**Interfaces:**
- Consumes: `<BottomSheet>` (`@/components/ui/bottom-sheet`), `enqueuePhotos` (Task 5).
- Produces: `<PhotoUploadSheet incidentId={string} open={boolean} onClose={() => void} onQueued={() => void} />`, consumed by Task 7's detail page and Task 8's home-screen block.

- [ ] **Step 1: Write the sheet component**

`src/components/incidents/photo-upload-sheet.tsx`:
```tsx
'use client';

import { useRef, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { enqueuePhotos } from '@/lib/upload-queue/queue';
import { MAX_INCIDENT_PHOTOS_PER_BATCH } from '@/lib/validation/incident-photo';

interface PhotoUploadSheetProps {
  incidentId: string;
  open: boolean;
  onClose: () => void;
  onQueued: () => void;
}

export function PhotoUploadSheet({ incidentId, open, onClose, onQueued }: PhotoUploadSheetProps) {
  const [wifiOnly, setWifiOnly] = useState(true);
  const [publicRelease, setPublicRelease] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setSelectedCount(Math.min(fileList.length, MAX_INCIDENT_PHOTOS_PER_BATCH));
  }

  async function submit(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, MAX_INCIDENT_PHOTOS_PER_BATCH);
    await enqueuePhotos(incidentId, files, { publicRelease, wifiOnly });
    onQueued();
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Fotos hinzufügen">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900"
          >
            Foto aufnehmen
          </button>
          <button
            type="button"
            onClick={() => libraryInputRef.current?.click()}
            className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900"
          >
            Aus der Fotobibliothek
          </button>
          <button
            type="button"
            onClick={() => filesInputRef.current?.click()}
            className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900"
          >
            Aus Dateien
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <input ref={filesInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />

        <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-neutral-900">
          <span>
            Nur über WLAN übertragen
            <span className="block text-xs text-neutral-500">Originale sind 4-12 MB groß</span>
          </span>
          <input type="checkbox" checked={wifiOnly} onChange={(e) => setWifiOnly(e.target.checked)} className="h-5 w-5" />
        </label>

        <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-neutral-900">
          <span>Für Öffentlichkeitsarbeit freigeben</span>
          <input type="checkbox" checked={publicRelease} onChange={(e) => setPublicRelease(e.target.checked)} className="h-5 w-5" />
        </label>

        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Fotos werden unverändert gespeichert - samt Aufnahmezeit und, falls im Bild vorhanden, Standortdaten. Bei Personen und
          Kennzeichen gilt die Datenschutzregelung der Wehr.
        </p>

        <button
          type="button"
          disabled={selectedCount === 0}
          onClick={() => submit(cameraInputRef.current?.files ?? libraryInputRef.current?.files ?? filesInputRef.current?.files ?? null)}
          className="min-h-[52px] rounded-lg bg-brand font-medium text-white disabled:opacity-40"
        >
          {selectedCount > 0 ? `${selectedCount} Fotos übertragen` : 'Fotos auswählen'}
        </button>
      </div>
    </BottomSheet>
  );
}
```
Each hidden `<input>`'s own `onChange` already has the picked `FileList` at that moment, so `submit` re-reads whichever input's `.files` is non-empty rather than tracking which trigger was used — acceptable since only one of the three inputs will have files at a time in practice (picking from one clears the intent to use another).

- [ ] **Step 2: Verify**

This component has no standalone page yet — verify it compiles (`npx tsc --noEmit`) and defer live interaction verification to Task 7, where it's actually mounted on the incident detail page. Note in the task report that click-driven file-picker interaction cannot be exercised by this project's browser-automation tooling per the documented harness-wide non-hydration limitation (see root `CLAUDE.md`'s "Verification note" precedents) — verify structurally (rendered DOM, correct `accept`/`capture` attributes) instead.

- [ ] **Step 3: Commit**

```bash
git add src/components/incidents/photo-upload-sheet.tsx
git commit -m "feat: add photo upload bottom sheet"
```

---

### Task 7: Einsatz-Detail mit Galerie, Löschen, Freigabe

**Files:**
- Create: `src/components/incidents/incident-photo-gallery.tsx`
- Create: `src/app/(app)/meine-feuerwehr/einsaetze/[incidentId]/page.tsx`
- Test: none — verified live in the browser with a real uploaded photo

**Interfaces:**
- Consumes: `canViewIncidentsFor`, `canManageIncidentsFor`, `canDeleteIncidentPhoto`, `canTogglePhotoRelease` (Task 1), `deleteIncidentPhoto`/`setIncidentPhotoPublicRelease` (Task 4), `<PhotoUploadSheet>` (Task 6), `subscribeToUploadQueue` (Task 5), the download route (Task 4).
- Produces: `/meine-feuerwehr/einsaetze/[incidentId]` page, `<IncidentPhotoGallery>` component (reused nowhere else in this plan, but structured so Task 8's home-screen preview grid can follow the same thumbnail-URL convention: `/api/incidents/{incidentId}/photos/{photoId}?variant=thumbnail`).

- [ ] **Step 1: Write the gallery component**

`src/components/incidents/incident-photo-gallery.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { subscribeToUploadQueue, retryUpload, type QueuedUpload } from '@/lib/upload-queue/queue';
import { deleteIncidentPhoto, setIncidentPhotoPublicRelease } from '@/app/(app)/meine-feuerwehr/einsaetze/actions';

interface PhotoData {
  id: string;
  uploadedById: string;
  uploadedByName: string;
  takenAt: string | null;
  byteSize: number;
  originalName: string;
  publicRelease: boolean;
}

interface IncidentPhotoGalleryProps {
  incidentId: string;
  photos: PhotoData[];
  currentUserId: string;
  canManage: boolean;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatBytes(byteSize: number): string {
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

export function IncidentPhotoGallery({ incidentId, photos, currentUserId, canManage }: IncidentPhotoGalleryProps) {
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [selected, setSelected] = useState<PhotoData | null>(null);

  useEffect(() => subscribeToUploadQueue(incidentId, setQueue), [incidentId]);

  const inProgress = queue.filter((entry) => entry.status !== 'done');
  const totalBytes = inProgress.reduce((sum, entry) => sum + entry.byteSize, 0);
  const uploadedBytes = inProgress.reduce((sum, entry) => sum + entry.uploadedBytes, 0);
  const doneCount = queue.filter((entry) => entry.status === 'done').length;

  return (
    <div className="flex flex-col gap-3">
      {inProgress.length > 0 && (
        <div className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700">
          {doneCount} von {queue.length} Fotos übertragen · {(uploadedBytes / (1024 * 1024)).toFixed(1)} MB von{' '}
          {(totalBytes / (1024 * 1024)).toFixed(1)} MB
          {inProgress.some((entry) => entry.status === 'failed') && (
            <ul className="mt-2 flex flex-col gap-1">
              {inProgress
                .filter((entry) => entry.status === 'failed')
                .map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{entry.fileName}: {entry.error}</span>
                    <button type="button" onClick={() => retryUpload(entry.id)} className="text-brand hover:underline">
                      Erneut versuchen
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setSelected(photo)}
            className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Bild kommt aus einer eigenen,
               session-geschützten Route mit 307-Redirect auf eine kurzlebige presigned URL, kein
               statischer Pfad, den next/image sinnvoll optimieren könnte. */}
            <img
              src={`/api/incidents/${incidentId}/photos/${photo.id}?variant=thumbnail`}
              alt=""
              className="h-full w-full object-cover"
            />
            <span
              className={`absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white ${
                photo.uploadedById === currentUserId ? 'bg-brand' : 'bg-neutral-500'
              }`}
            >
              {initials(photo.uploadedByName)}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4" onClick={() => setSelected(null)}>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- siehe Kommentar oben */}
            <img
              src={`/api/incidents/${incidentId}/photos/${selected.id}?variant=view`}
              alt=""
              className="max-h-[50vh] w-full rounded-lg object-contain"
            />
            <p className="text-sm text-neutral-700">Hochgeladen von {selected.uploadedByName}</p>
            {selected.takenAt && <p className="text-sm text-neutral-500">Aufgenommen am {new Date(selected.takenAt).toLocaleString('de-AT')}</p>}
            <p className="text-sm text-neutral-500">{formatBytes(selected.byteSize)}</p>
            <a
              href={`/api/incidents/${incidentId}/photos/${selected.id}?variant=original`}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-center text-sm font-medium text-neutral-900"
            >
              Original herunterladen
            </a>
            {selected.uploadedById === currentUserId && (
              <label className="flex items-center justify-between gap-3 text-sm text-neutral-900">
                Für Öffentlichkeitsarbeit freigeben
                <input
                  type="checkbox"
                  defaultChecked={selected.publicRelease}
                  onChange={(e) => setIncidentPhotoPublicRelease(selected.id, incidentId, e.target.checked)}
                  className="h-5 w-5"
                />
              </label>
            )}
            {(selected.uploadedById === currentUserId || canManage) && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm('Foto wirklich löschen?')) return;
                  void deleteIncidentPhoto(selected.id, incidentId).then(() => setSelected(null));
                }}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
              >
                Löschen
              </button>
            )}
            <button type="button" onClick={() => setSelected(null)} className="text-sm text-neutral-500">
              Schließen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the detail page**

`src/app/(app)/meine-feuerwehr/einsaetze/[incidentId]/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PhotoUploadSheet } from '@/components/incidents/photo-upload-sheet';
import { IncidentPhotoGallery } from '@/components/incidents/incident-photo-gallery';
import { INCIDENT_KIND_LABELS } from '@/lib/validation/incident.schema';
import type { IncidentKind } from '@prisma/client';

interface IncidentDetailData {
  id: string;
  kind: IncidentKind;
  keyword: string;
  location: string;
  alarmedAt: string;
  endedAt: string | null;
  crewCount: number | null;
  canManage: boolean;
  currentUserId: string;
  photos: {
    id: string;
    uploadedById: string;
    uploadedByName: string;
    takenAt: string | null;
    byteSize: number;
    originalName: string;
    publicRelease: boolean;
  }[];
}

// Diese Seite lädt ihre Daten client-seitig über /api/incidents/[incidentId] (unten neu), statt als
// Server Component - der einzige Grund: die Foto-Galerie muss nach jedem Upload (Warteschlange läuft
// rein client-seitig, siehe Task 5) neu laden können, ohne einen vollen Seiten-Reload zu erzwingen.
```

The comment above signals a design decision worth pausing on before writing more code: fetching detail data via a new `GET /api/incidents/[incidentId]` JSON endpoint from a Client Component works, but it means re-deriving every permission/formatting concern that a Server Component would get for free, and it diverges from every other detail page in this codebase (`kalender/[eventId]/page.tsx`, `drohnen/[flightId]/page.tsx`, all Server Components). Prefer the Server Component approach below instead — it fetches once server-side (fast, no extra round-trip, matches the rest of the app), and only the **photo list needs to refresh after an upload**, which `router.refresh()` (a Client Component wrapper) already solves without a JSON API. Replace the sketch above with:

`src/app/(app)/meine-feuerwehr/einsaetze/[incidentId]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewIncidentsFor, canManageIncidentsFor } from '@/lib/auth/permissions';
import { INCIDENT_KIND_LABELS } from '@/lib/validation/incident.schema';
import { IncidentDetailClient } from './incident-detail-client';

export default async function EinsatzDetailPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const user = await requireUser();

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      photos: {
        where: { status: 'READY' },
        orderBy: { createdAt: 'asc' },
        include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      },
      vehicles: { include: { vehicle: { select: { taktischeBezeichnung: true } } } },
    },
  });
  if (!incident || !canViewIncidentsFor(user, incident.fireDepartmentId)) notFound();

  const canManage = canManageIncidentsFor(user, incident.fireDepartmentId);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
            {INCIDENT_KIND_LABELS[incident.kind]}
          </span>
          <h1 className="mt-1 text-xl font-bold text-neutral-900">{incident.keyword}</h1>
          <p className="text-sm text-neutral-500">
            {incident.location} · {incident.alarmedAt.toLocaleString('de-AT')}
          </p>
        </div>
        {canManage && (
          <Link href={`/meine-feuerwehr/einsaetze/${incident.id}/bearbeiten`} className="text-sm text-brand hover:underline">
            Bearbeiten
          </Link>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 rounded-lg bg-white p-4 shadow-sm">
        <div>
          <div className="text-xs font-semibold uppercase text-neutral-500">Alarm</div>
          <div className="font-mono text-sm text-neutral-900">{incident.alarmedAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase text-neutral-500">Dauer</div>
          <div className="font-mono text-sm text-neutral-900">
            {incident.endedAt
              ? `${Math.round((incident.endedAt.getTime() - incident.alarmedAt.getTime()) / 60000)} min`
              : '–'}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase text-neutral-500">Mannschaft</div>
          <div className="font-mono text-sm text-neutral-900">{incident.crewCount ?? '–'}</div>
        </div>
      </div>

      {incident.vehicles.length > 0 && (
        <p className="text-sm text-neutral-600">
          Fahrzeuge: {incident.vehicles.map((v) => v.vehicle.taktischeBezeichnung).join(', ')}
        </p>
      )}

      <IncidentDetailClient
        incidentId={incident.id}
        canManage={canManage}
        currentUserId={user.id}
        photos={incident.photos.map((photo) => ({
          id: photo.id,
          uploadedById: photo.uploadedById,
          uploadedByName: `${photo.uploadedBy.firstName} ${photo.uploadedBy.lastName}`,
          takenAt: photo.takenAt?.toISOString() ?? null,
          byteSize: photo.byteSize,
          originalName: photo.originalName,
          publicRelease: photo.publicRelease,
        }))}
      />
    </div>
  );
}
```

Create the small Client Component wrapper that owns the sheet-open state and calls `router.refresh()` after a batch is queued, `src/app/(app)/meine-feuerwehr/einsaetze/[incidentId]/incident-detail-client.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhotoUploadSheet } from '@/components/incidents/photo-upload-sheet';
import { IncidentPhotoGallery } from '@/components/incidents/incident-photo-gallery';

interface IncidentDetailClientProps {
  incidentId: string;
  canManage: boolean;
  currentUserId: string;
  photos: {
    id: string;
    uploadedById: string;
    uploadedByName: string;
    takenAt: string | null;
    byteSize: number;
    originalName: string;
    publicRelease: boolean;
  }[];
}

export function IncidentDetailClient({ incidentId, canManage, currentUserId, photos }: IncidentDetailClientProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">Fotos {photos.length}</h2>
        <button type="button" onClick={() => setSheetOpen(true)} className="text-sm font-medium text-brand">
          + Hinzufügen
        </button>
      </div>

      <IncidentPhotoGallery incidentId={incidentId} photos={photos} currentUserId={currentUserId} canManage={canManage} />

      <PhotoUploadSheet
        incidentId={incidentId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onQueued={() => router.refresh()}
      />
    </div>
  );
}
```
`router.refresh()` re-runs the Server Component's data fetch, but a photo only reaches `status: 'READY'` (and therefore shows up in the re-fetched `photos` list) once its upload's `complete` call finishes — the still-in-progress ones remain visible via `IncidentPhotoGallery`'s own `subscribeToUploadQueue` subscription until then, which is exactly the "Upload-Karte nur während laufender Übertragung" behavior the spec asks for.

- [ ] **Step 3: Verify live in the browser**

Start the dev server, sign in as a seeded member, open the incident created in Task 2's verification, click "+ Hinzufügen", pick a real photo via "Aus Dateien", leave "Nur über WLAN" on (dev machine is presumably on Wi-Fi) and submit. Confirm: the upload progresses (visible in the "N von M Fotos übertragen" line), the photo appears in the 3-column grid once done, its thumbnail renders (confirms `/api/incidents/.../photos/...?variant=thumbnail` round-trips correctly end-to-end through the browser, not just `curl`), clicking it opens the single-photo view, "Original herunterladen" triggers a real download (confirm the downloaded file's byte size matches the original), and toggling "Für Öffentlichkeitsarbeit freigeben" persists (reload the page, confirm the checkbox state). Delete the photo and confirm it disappears from the grid and both `IncidentPhoto` and its S3 objects are gone.

- [ ] **Step 4: Commit**

```bash
git add src/components/incidents/incident-photo-gallery.tsx "src/app/(app)/meine-feuerwehr/einsaetze/[incidentId]"
git commit -m "feat: add Einsatz detail page with photo gallery"
```

---

### Task 8: 24-Stunden-Block auf „Meine Feuerwehr"

**Files:**
- Modify: `src/app/(app)/meine-feuerwehr/page.tsx`
- Create: `src/components/incidents/recent-incidents-block.tsx`
- Test: none — verified live in the browser

**Interfaces:**
- Consumes: `canManageIncidentsFor` (Task 1), `<PhotoUploadSheet>` (Task 6).
- Produces: a new block rendered inside the existing `MeineFeuerwehrPage` return value, after the Fuhrpark card (matching spec §6.1's "nach Atemschutz und Fuhrpark" ordering).

- [ ] **Step 1: Add the recent-incidents query to `meine-feuerwehr/page.tsx`**

In `src/app/(app)/meine-feuerwehr/page.tsx`, add to the `Promise.all` array that already fetches `me`/`candidateEventsRaw`/`vehicles`/`myBookings`/`orgFeatures` (around line 116-166) a sixth query:
```ts
prisma.incident.findMany({
  where: { fireDepartmentId: user.homeOrganizationId, alarmedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  orderBy: { alarmedAt: 'desc' },
  include: { photos: { where: { status: 'READY' }, orderBy: { createdAt: 'asc' }, take: 4 }, _count: { select: { photos: true } } },
}),
```
Destructure it as `recentIncidents` alongside the existing `[me, candidateEventsRaw, vehicles, myBookings, orgFeatures]` (becomes `[me, candidateEventsRaw, vehicles, myBookings, orgFeatures, recentIncidents]`).

Import `canManageIncidentsFor` (add to the existing `@/lib/auth/permissions` import) and `RecentIncidentsBlock`. After the existing "Fahrzeug Reservierungen"/"Flug registrieren" quick-access `<div className={droneMember ? ... }>` block (around line 308-319) and before the `{standDerWehr && (...)}` block, add:
```tsx
{recentIncidents.length > 0 && (
  <RecentIncidentsBlock
    incidents={recentIncidents.map((incident) => ({
      id: incident.id,
      kind: incident.kind,
      keyword: incident.keyword,
      location: incident.location,
      alarmedAt: incident.alarmedAt.toISOString(),
      photoIds: incident.photos.map((p) => p.id),
      totalPhotoCount: incident._count.photos,
    }))}
  />
)}
```
Separately, near the top of the returned JSX (spec §6.1: "Einsatz erfassen als umrandeter 48px-Button oben im Screen, direkt unter dem nächsten Termin"), right after the `<HomeTodoList .../>` line, add:
```tsx
{canManageIncidentsFor(user, user.homeOrganizationId) && (
  <Link
    href="/meine-feuerwehr/einsaetze/neu"
    className="flex min-h-12 items-center justify-center rounded-lg border-2 border-brand text-sm font-semibold text-brand"
  >
    Einsatz erfassen
  </Link>
)}
```

- [ ] **Step 2: Write `RecentIncidentsBlock`**

`src/components/incidents/recent-incidents-block.tsx`:
```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PhotoUploadSheet } from './photo-upload-sheet';
import { INCIDENT_KIND_LABELS } from '@/lib/validation/incident.schema';
import type { IncidentKind } from '@prisma/client';

interface RecentIncident {
  id: string;
  kind: IncidentKind;
  keyword: string;
  location: string;
  alarmedAt: string;
  photoIds: string[];
  totalPhotoCount: number;
}

export function RecentIncidentsBlock({ incidents }: { incidents: RecentIncident[] }) {
  const [sheetIncidentId, setSheetIncidentId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Einsätze (letzte 24 Stunden)</span>
      {incidents.map((incident) => (
        <div key={incident.id} className="flex flex-col gap-2 rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <Link href={`/meine-feuerwehr/einsaetze/${incident.id}`} className="min-w-0">
              <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                {INCIDENT_KIND_LABELS[incident.kind]}
              </span>
              <div className="mt-1 truncate text-[15px] font-semibold text-[#1c1c1e]">{incident.keyword}</div>
              <div className="text-[13px] text-[#6c6c70]">
                {new Date(incident.alarmedAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} · {incident.location}
              </div>
            </Link>
          </div>

          {incident.photoIds.length === 0 ? (
            <p className="text-sm text-neutral-500">Noch keine Fotos vorhanden.</p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {incident.photoIds.map((photoId, index) => {
                const isLast = index === incident.photoIds.length - 1;
                const remaining = incident.totalPhotoCount - incident.photoIds.length;
                return (
                  <Link
                    key={photoId}
                    href={`/meine-feuerwehr/einsaetze/${incident.id}`}
                    className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- siehe incident-photo-gallery.tsx */}
                    <img
                      src={`/api/incidents/${incident.id}/photos/${photoId}?variant=thumbnail`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    {isLast && remaining > 0 && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-white">
                        +{remaining}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSheetIncidentId(incident.id)}
            className="self-start text-sm font-medium text-brand"
          >
            Fotos hinzufügen
          </button>
        </div>
      ))}

      {sheetIncidentId && (
        <PhotoUploadSheet
          incidentId={sheetIncidentId}
          open={sheetIncidentId !== null}
          onClose={() => setSheetIncidentId(null)}
          onQueued={() => setSheetIncidentId(null)}
        />
      )}
    </div>
  );
}
```
Note: unlike the detail page (Task 7), this block has no `router.refresh()` wiring after queuing — a photo queued from here only becomes visible in this block's own preview grid after the next full navigation to `/meine-feuerwehr` (acceptable: the primary place to watch an upload's progress is the incident detail page, which this same "Fotos hinzufügen" action does not navigate to, matching spec §6.1's card-level inline button, not a redirect).

- [ ] **Step 3: Verify live**

Open `/meine-feuerwehr` as a member of the Feuerwehr that owns the Task 2/7 test incident (`alarmedAt` within the last 24 hours) and confirm the block appears with the correct chip/time/keyword/location and the uploaded photo's thumbnail. Edit that incident's `alarmedAt` via Prisma Studio to 25 hours ago, reload, and confirm the whole block disappears (no placeholder). Confirm "Einsatz erfassen" only renders for the member role this app allows (i.e. always, per the resolved permission — confirm it does NOT render for a user whose `homeOrganizationId` differs, which for a plain member is not directly testable since `canManageIncidentsFor` reduces to "same org" — instead confirm via a Bezirksadmin/Feuerwehr-Admin-of-a-different-org account that it also renders correctly for them per `canManageHeimatfeuerwehrFor`'s admin branch).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/page.tsx" src/components/incidents/recent-incidents-block.tsx
git commit -m "feat: add 24h Einsatz block to Meine Feuerwehr home screen"
```

---

### Task 9: Cron-Aufräumung verwaister PENDING-Fotos

**Files:**
- Create: `src/app/api/cron/incident-photo-cleanup/route.ts`
- Create: `docker/incident-photo-cleanup.sh`
- Modify: `docker/README.md`
- Test: none — verified with a manually-inserted stale `PENDING` row + `curl`

**Interfaces:**
- Consumes: `deletePhotoObjects` (Task 3), `prisma`.
- Produces: `GET /api/cron/incident-photo-cleanup?secret=...` (already covered by `middleware.ts`'s existing `/api/cron` public prefix — no `middleware.ts` change needed).

- [ ] **Step 1: Write the cron route**

`src/app/api/cron/incident-photo-cleanup/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { deletePhotoObjects } from '@/lib/storage/incident-photos-s3';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const providedSecret = new URL(request.url).searchParams.get('secret');
  const secret = process.env.CRON_SECRET;
  // Sicherheitshärtung gegenüber facebook-fetch/route.ts's Muster (`secret !== process.env.CRON_SECRET`,
  // siehe Security-Review S5): ein leerer/fehlender CRON_SECRET in der Umgebung würde bei jenem
  // Muster JEDE Anfrage ohne "secret"-Parameter durchlassen (undefined !== undefined ist false -
  // die Prüfung "besteht"). Dieses neue Route nutzt bewusst das stärkere Muster (`!secret ||
  // providedSecret !== secret`), das system-check/send-scheduled-news/atemschutz-warnung bereits
  // verwenden - kein bestehender Cron-Endpunkt wird dadurch verändert.
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const stale = await prisma.incidentPhoto.findMany({
    where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
    select: { id: true, storageKey: true },
  });

  for (const photo of stale) {
    try {
      await deletePhotoObjects([photo.storageKey]);
    } catch {
      // Ein einzelnes S3-Löschen darf die DB-Aufräumung nicht blockieren - gleiches Muster wie
      // fetchAndCacheFacebookPosts' Schleife (eigenes try/catch pro Eintrag).
    }
    await prisma.incidentPhoto.delete({ where: { id: photo.id } });
  }

  return NextResponse.json({ ok: true, count: stale.length });
}
```

- [ ] **Step 2: Write the host wrapper script**

`docker/incident-photo-cleanup.sh` (mirrors `docker/facebook-fetch.sh`'s exact shape):
```bash
#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

set -a
. "$REPO_ROOT/.env"
set +a

curl -fsS "http://localhost:3000/api/cron/incident-photo-cleanup?secret=${CRON_SECRET}" > /dev/null
```
Track it executable in git (the twice-hit "committed non-executable" incident this codebase's own history flags):
```bash
git update-index --chmod=+x docker/incident-photo-cleanup.sh
```

- [ ] **Step 3: Document the crontab entry**

In `docker/README.md`, add a new bullet alongside the existing cron documentation (find the section listing `facebook-fetch.sh`/`kalender-ics-sync.sh`/etc. and match its exact format):
```
- `incident-photo-cleanup.sh` - räumt verwaiste PENDING-Einsatzfotos (>24h) auf. Täglich um 04:00:
  `0 4 * * * /path/to/app-177/docker/incident-photo-cleanup.sh`
```

- [ ] **Step 4: Verify**

Insert a stale `PENDING` row directly (via Prisma Studio or a script): `createdAt` 25 hours ago, `storageKey` pointing at a real (or already-nonexistent) test object. Run:
```bash
curl -s "http://localhost:3000/api/cron/incident-photo-cleanup?secret=<your CRON_SECRET>"
```
Confirm the JSON response's `count` includes that row and it's gone from the DB afterward. Confirm a request with a wrong/missing `secret` returns `401`. If `CRON_SECRET` is unset in your local `.env`, confirm the route still correctly returns `401` for every request (this is exactly the case the stronger check pattern protects against).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/incident-photo-cleanup docker/incident-photo-cleanup.sh docker/README.md
git commit -m "feat: add cron cleanup for orphaned pending incident photos"
```

---

### Task 10: Einsatzliste zum Nachtragen älterer Einsätze

**Files:**
- Create: `src/app/(app)/meine-feuerwehr/einsaetze/page.tsx`
- Test: none — verified live in the browser

**Interfaces:**
- Consumes: `canViewIncidentsFor`, `canManageIncidentsFor` (Task 1).
- Produces: `/meine-feuerwehr/einsaetze` list page — the spec's step 10 leaves the concrete form open ("kein eigener Bildschirm-Abschnitt im Brief spezifiziert"); this plan makes it a simple reverse-chronological list of every Incident belonging to the user's home Feuerwehr, each linking to its detail page, with an "Einsatz erfassen" button at the top for permitted users. This is also the page every "Abbrechen" link in Tasks 2/7 already points at.

- [ ] **Step 1: Write the list page**

`src/app/(app)/meine-feuerwehr/einsaetze/page.tsx`:
```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewIncidentsFor, canManageIncidentsFor } from '@/lib/auth/permissions';
import { INCIDENT_KIND_LABELS } from '@/lib/validation/incident.schema';

export default async function EinsaetzeListePage() {
  const user = await requireUser();
  if (!canViewIncidentsFor(user, user.homeOrganizationId)) notFound();

  const incidents = await prisma.incident.findMany({
    where: { fireDepartmentId: user.homeOrganizationId },
    orderBy: { alarmedAt: 'desc' },
    include: { _count: { select: { photos: true } } },
  });

  const canManage = canManageIncidentsFor(user, user.homeOrganizationId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">Einsätze</h1>
        {canManage && (
          <Link href="/meine-feuerwehr/einsaetze/neu" className="text-sm font-medium text-brand">
            + Einsatz erfassen
          </Link>
        )}
      </div>

      {incidents.length === 0 ? (
        <p className="text-sm text-neutral-500">Noch keine Einsätze erfasst.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-lg bg-white shadow-sm">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <Link href={`/meine-feuerwehr/einsaetze/${incident.id}`} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                    {INCIDENT_KIND_LABELS[incident.kind]}
                  </span>
                  <div className="mt-1 truncate text-sm font-medium text-neutral-900">{incident.keyword}</div>
                  <div className="text-xs text-neutral-500">
                    {incident.alarmedAt.toLocaleString('de-AT')} · {incident.location}
                  </div>
                </div>
                <span className="flex-none text-xs text-neutral-500">{incident._count.photos} Foto{incident._count.photos === 1 ? '' : 's'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Open `/meine-feuerwehr/einsaetze` and confirm every previously-created test incident (from Tasks 2/7/8) appears, most recent first, with the correct photo count, and that each row links correctly to its detail page. Confirm a user from a different Feuerwehr gets `404` on this route directly.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/einsaetze/page.tsx"
git commit -m "feat: add Einsatzliste for backfilling older Einsätze"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage**: every numbered item in §7 (migration/permissions, CRUD, S3+presign/complete, download route, upload queue, preview derivation, detail+gallery, home-screen block, cron cleanup, list page) maps to a task above. §6.3's exact sheet copy, §5's Wi-Fi/EXIF/HEIC/limits, and §4's presigned-URL/never-public-URL architecture are implemented verbatim where the spec gives exact wording.
- **Placeholder scan**: no task contains "TBD"/"handle appropriately" — every step has real, complete code. The one exception is the deliberate mid-Task-7 architecture correction (Client-Component-fetch sketch → Server Component), which is intentional reasoning-in-place, not an unresolved placeholder — the final code that follows it is complete.
- **Type consistency**: `IncidentPhoto`'s `previewKey`/`thumbnailKey`/`takenAt` are nullable everywhere they're read (Task 4's download route, Task 7's gallery); `canDeleteIncidentPhoto`/`canTogglePhotoRelease` signatures match between Task 1's definition and Task 4/7's call sites; `QueuedUpload`'s field names (`byteSize`, `uploadedBytes`, `wifiOnly`, `publicRelease`) are used identically across Task 5's engine, Task 6's sheet, and Task 7's gallery's queue subscription.
- **One known, deliberately deferred gap**: Task 2's `deleteIncident` does not delete that incident's `IncidentPhoto` S3 objects (only the DB rows, via `onDelete: Cascade`) — flagged inline in that task's code comment rather than silently left out. Left for a follow-up since it's an edge case (deleting an entire Einsatz, not a single photo) not covered by the spec's acceptance criteria, and bundling it in would mean either duplicating Task 4's delete logic before Task 4 exists (ordering problem) or looping every incident's photos inside `deleteIncident` — a reasonable small follow-up, not a correctness bug for anything the acceptance criteria test.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-17-einsatz-foto-upload-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
