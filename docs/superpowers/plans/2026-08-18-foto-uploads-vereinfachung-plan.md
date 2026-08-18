# Foto Uploads (Vereinfachung) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the already-built (but not-yet-merged) "Einsatz-Foto-Upload" module with the simplified "Foto Uploads" module per the revised design brief: a much smaller data model (kind/description/date only), no location/vehicles/crew/times/release-toggle, new top-level `/foto-uploads/*` routes, and a synchronous foreground upload (no IndexedDB queue, no pause/resume, no Wi-Fi gate).

**Architecture:** Same proven infrastructure as before (presigned direct-to-S3 upload, server-side `sharp` decode validation + WebP preview derivation + EXIF read in a `complete` step, session-gated 60-second presigned-GET download redirects, S3 bucket/CORS/CSP already correctly wired) — but the client-side upload mechanic is now a plain in-component worker pool with no persistence, and the data model drops to three fields on the parent record.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (already installed), `sharp` (already installed), `exifr` (already installed) — **no new dependencies**; `idb` becomes unused and should be removed from `package.json` since nothing in this plan uses it anymore.

## Global Constraints

- This branch (`worktree-einsatz-foto-upload`) already has a fully-built, fully-reviewed prior version of this feature that is **replaced, not extended** — every task below is explicit about which old files to delete.
- Every Feuerwehr member (same `homeOrganizationId`) may create/edit/delete a `PhotoUpload` and upload/view photos — no role restriction. Deleting someone else's *photo* additionally requires `canManageHeimatfeuerwehrFor`.
- `PhotoUpload` has **exactly three** user-facing fields: `kind`, `description`, `occurredOn` (date only). No location, vehicles, crew, alarm/end time anywhere in code, schema, or UI.
- `Photo` has **no** `publicRelease` field and no release toggle anywhere — rights transfer is stated as fact text, never a switch.
- Original photo bytes are never modified — only two derived WebP previews (`previewKey`, `thumbKey`) are new objects. MIME/format validated server-side via real `sharp` decode, never client-declared type.
- No permanent/public photo URL ever exists — every read goes through a session-gated route minting a 60-second presigned GET at request time.
- Upload is a **blocking foreground action**: no IndexedDB, no persistent queue, no pause/resume, no Wi-Fi-only gate. 2-3 files in parallel, per-file retry, byte-based progress, a `beforeunload` warning plus a guarded sheet-close confirmation while any file is still transferring.
- Limits unchanged: 50 MB/file, 30 files/batch, `image/*` only (including HEIC/HEIF).
- All new routes live under `/foto-uploads/*` (a new top-level segment under `src/app/(app)/`), not nested under `/meine-feuerwehr/`. The old `/meine-feuerwehr/einsaetze/*` tree is deleted entirely.
- S3 bucket (`app-177-pictures`), credentials, CSP (`https://*.exo.io` in `next.config.mjs`), Docker Compose env var wiring, and CORS documentation are **already correct and require zero changes** — this plan never touches `next.config.mjs`, `docker/docker-compose.yml`, `docker/docker-compose.staging.yml`, or `.env.example`.
- No automated test suite — verify each task via `npx tsc --noEmit`, `npm run build`, and live/scripted verification against the dev database (this worktree already has `einsatz-foto-upload-postgres-1` running and a `.env` with placeholder S3 credentials `S3_ACCESS_KEY=change-me`/`S3_SECRET_KEY=change-me` and a real `S3_ENDPOINT_URL=https://sos-at-vie-1.exo.io` — every task must clearly document what could/couldn't be verified without real S3 credentials, matching this branch's established practice).
- German UI copy throughout, matching the brief's exact wording where the brief gives exact text.

---

### Task 1: Data model (replace), migration (replace), permissions (replace)

**Files:**
- Modify: `prisma/schema.prisma`
- Delete: `prisma/migrations/20260817130709_einsatz_foto_upload/` (entire directory)
- Modify: `src/lib/auth/permissions.ts`
- Test: none — verified via `npx prisma migrate dev` + a standalone Prisma script

**Interfaces:**
- Produces: Prisma models `PhotoUpload`, `Photo`, enums `PhotoUploadKind` (`EINSATZ`/`UEBUNG`/`SONSTIGES`) and `PhotoStatus` (`PENDING`/`UPLOADING`/`READY`/`FAILED`, unchanged enum from before); permission functions `canViewPhotoUploadsFor(user: SessionUser, fireDepartmentId: string): boolean`, `canManagePhotoUploadsFor(user: SessionUser, fireDepartmentId: string): boolean`, `canDeletePhoto(user: SessionUser, photo: { uploadedById: string }, fireDepartmentId: string): boolean`.

- [ ] **Step 1: Reset the local dev database and remove the old migration**

The old migration was never applied anywhere outside this worktree's local Postgres, so it's safe to replace outright:

```bash
npx prisma migrate reset --force
```

This drops and recreates the local dev database from the (about-to-be-edited) schema and reapplies whatever migrations remain — run it again at the end of Step 3 once the new migration exists. For now, just confirm it leaves an empty, migration-free dev database:

```bash
rm -rf "prisma/migrations/20260817130709_einsatz_foto_upload"
```

- [ ] **Step 2: Remove the old models/enums and their relation fields from `prisma/schema.prisma`**

Delete the `IncidentKind` enum and the `Incident`/`IncidentVehicle`/`IncidentCrewMember`/`IncidentPhoto` models entirely (find them via `grep -n "^enum IncidentKind\|^model Incident"`). Keep the `PhotoStatus` enum's declaration but you'll replace its body text below — it's unchanged in shape, just re-add it fresh alongside the new models for a clean diff.

Remove these three relation lines:
- `model Organization`: delete `incidents    Incident[]`
- `model User`: delete `createdIncidents        Incident[]`, `incidentCrewMemberships IncidentCrewMember[]`, `uploadedIncidentPhotos  IncidentPhoto[]`
- `model Vehicle`: delete `incidentVehicles IncidentVehicle[]`

- [ ] **Step 3: Add the new enums, models, and relation fields**

Add near the other enums (where `IncidentKind` used to be):

```prisma
enum PhotoUploadKind {
  EINSATZ
  UEBUNG
  SONSTIGES
}

// PENDING: Photo-Zeile angelegt, aber noch kein Objekt im Bucket (siehe presign-Route).
// UPLOADING: atomarer Claim während des complete-Schritts (siehe complete-Route) - verhindert einen
// doppelten complete-Aufruf für dieselbe Datei.
// READY: complete-Route hat das Original erfolgreich dekodiert, Vorschauen abgeleitet.
// FAILED: complete ist fehlgeschlagen (kein echtes Bild, zu groß, ...) - Objekt wurde bereits gelöscht.
enum PhotoStatus {
  PENDING
  UPLOADING
  READY
  FAILED
}
```

Add near where `Incident`/`IncidentPhoto` used to live:

```prisma
// Ein "Anlass" zum Sammeln von Fotos (Foto-Upload-Brief.md, vereinfachte Fassung) - bewusst KEINE
// Einsatzdokumentation: kein Ort, keine Einsatzzeiten, keine Mannschaftserfassung. Genau drei
// Nutzerfelder: kind, description, occurredOn. Gehört immer genau EINER Feuerwehr. Jedes Mitglied
// der Feuerwehr darf anlegen/bearbeiten/löschen (siehe canManagePhotoUploadsFor) - keine
// Rollen-Einschränkung, da dieses Projekt keine Rollentabelle kennt (nur Dienstgrad, eine reine
// Anzeige-Tabelle ohne Berechtigungslogik).
model PhotoUpload {
  id               String          @id @default(cuid())
  fireDepartmentId String
  fireDepartment   Organization    @relation(fields: [fireDepartmentId], references: [id])
  kind             PhotoUploadKind
  description      String
  occurredOn       DateTime
  createdById      String
  createdBy        User            @relation(fields: [createdById], references: [id])
  createdAt        DateTime        @default(now())

  photos Photo[]

  @@index([fireDepartmentId])
  @@index([createdAt])
}

// Ein hochgeladenes Foto. storageKey/previewKey/thumbKey sind S3-Objektschlüssel im Bucket
// app-177-pictures (siehe lib/storage/photo-uploads-s3.ts) - NICHT die Bilddaten selbst. Das
// Original bleibt byteidentisch im Bucket; previewKey/thumbKey sind abgeleitete WebP-Objekte, beide
// null solange status != READY. KEIN publicRelease-Feld - die Fotorechte gehen laut
// Feststellungstext beim Anlegen automatisch mit dem Hochladen an die Feuerwehr über, kein Schalter,
// keine Filterung danach nötig.
model Photo {
  id            String      @id @default(cuid())
  photoUploadId String
  photoUpload   PhotoUpload @relation(fields: [photoUploadId], references: [id], onDelete: Cascade)
  uploadedById  String
  uploadedBy    User        @relation(fields: [uploadedById], references: [id])
  storageKey    String
  previewKey    String?
  thumbKey      String?
  originalName  String
  mimeType      String
  byteSize      Int
  width         Int?
  height        Int?
  takenAt       DateTime?
  status        PhotoStatus @default(PENDING)
  createdAt     DateTime    @default(now())

  @@index([photoUploadId])
  @@index([status, createdAt])
}
```

Add the relation back-references:

In `model Organization`, add: `photoUploads PhotoUpload[]`

In `model User`, add: `createdPhotoUploads PhotoUpload[]` and `uploadedPhotos Photo[]`

`model Vehicle` needs no new relation at all — there is no vehicle selection in this simplified feature.

- [ ] **Step 4: Generate and apply the new migration, verify it's clean**

```bash
npx prisma migrate dev --name foto_uploads
```

Confirm the generated SQL under `prisma/migrations/<timestamp>_foto_uploads/migration.sql` contains no `DROP`/`ALTER` referencing any table this plan doesn't own (`Organization`/`User`/`Vehicle` should only ever gain the relation columns implicit in the new FKs on `PhotoUpload`/`Photo` — no data columns on those three tables change).

- [ ] **Step 5: Replace the permission functions in `src/lib/auth/permissions.ts`**

Delete `canViewIncidentsFor`, `canManageIncidentsFor`, `canDeleteIncidentPhoto`, `canTogglePhotoRelease` entirely (find via `grep -n "IncidentsFor\|IncidentPhoto\|TogglePhotoRelease"`). Add in their place, same location (near `canManageHeimatfeuerwehrFor`/`canManageUsersFor`):

```ts
/**
 * Sichtbarkeit von Foto Uploads/Fotos einer Feuerwehr (Foto-Upload-Brief.md §2) - jedes Mitglied
 * dieser Feuerwehr (gleiche homeOrganizationId) ODER wer sie administrativ verwaltet
 * (canManageHeimatfeuerwehrFor). Fotos hochladen nutzt exakt dieselbe Regel - kein separates
 * canUploadPhotoFor nötig.
 */
export function canViewPhotoUploadsFor(user: SessionUser, fireDepartmentId: string): boolean {
  return user.homeOrganizationId === fireDepartmentId || canManageHeimatfeuerwehrFor(user, fireDepartmentId);
}

/**
 * Foto Upload anlegen/bearbeiten/löschen - laut App-Betreiber (Chat-Rückfrage, der Brief nennt
 * weiterhin "Kommandant/Einsatzleiter/Schriftführer") dieselbe Regel wie canViewPhotoUploadsFor:
 * jedes Mitglied der Feuerwehr darf, keine Rollen-Einschränkung, da dieses Projekt keine
 * Rollentabelle kennt. Eigene, benannte Funktion statt canViewPhotoUploadsFor direkt an den
 * Aufrufstellen wiederzuverwenden, falls sich das künftig doch trennt - gleiches Muster wie
 * canManageUsersFor/canManageHeimatfeuerwehrFor in diesem Projekt.
 */
export function canManagePhotoUploadsFor(user: SessionUser, fireDepartmentId: string): boolean {
  return canViewPhotoUploadsFor(user, fireDepartmentId);
}

/** Foto löschen - der Uploader selbst ODER ein Admin der Feuerwehr (canManageHeimatfeuerwehrFor),
 * NICHT jedes beliebige Mitglied (anders als canViewPhotoUploadsFor/canManagePhotoUploadsFor). Kein
 * canTogglePhotoRelease-Gegenstück mehr nötig - es gibt kein Freigabe-Feld. */
export function canDeletePhoto(
  user: SessionUser,
  photo: { uploadedById: string },
  fireDepartmentId: string,
): boolean {
  return photo.uploadedById === user.id || canManageHeimatfeuerwehrFor(user, fireDepartmentId);
}
```

- [ ] **Step 6: Verify with a standalone script**

Create `scripts/verify-photo-upload-permissions.ts` (temporary, delete after running):
```ts
import { canViewPhotoUploadsFor, canManagePhotoUploadsFor, canDeletePhoto } from '../src/lib/auth/permissions';
import type { SessionUser } from '../src/types/next-auth';

const member = { id: 'u1', homeOrganizationId: 'org-a', isBezirksAdmin: false, abschnittAdminOrgIds: [], feuerwehrAdminOrgIds: [] } as SessionUser;
const otherMember = { id: 'u2', homeOrganizationId: 'org-b', isBezirksAdmin: false, abschnittAdminOrgIds: [], feuerwehrAdminOrgIds: [] } as SessionUser;

console.log('member sees own org:', canViewPhotoUploadsFor(member, 'org-a') === true);
console.log('other member blocked:', canViewPhotoUploadsFor(otherMember, 'org-a') === false);
console.log('member can manage own org:', canManagePhotoUploadsFor(member, 'org-a') === true);
console.log('uploader can delete own photo:', canDeletePhoto(member, { uploadedById: 'u1' }, 'org-a') === true);
console.log('non-uploader, non-admin cannot delete:', canDeletePhoto(otherMember, { uploadedById: 'u1' }, 'org-a') === false);
```
Run: `npx tsx scripts/verify-photo-upload-permissions.ts` — all lines must print `true`. Delete the script afterward. Confirm `npx tsc --noEmit` succeeds (it will still fail at this point on every file that references the deleted `Incident*` symbols — that's expected until later tasks delete/rewrite those files; just confirm the *new* code you wrote in this task has no type errors of its own by temporarily checking only `src/lib/auth/permissions.ts` and `prisma/schema.prisma`-generated types compile, e.g. `npx tsc --noEmit 2>&1 | grep -v "einsaetze\|incident"` to filter out the expected, not-yet-fixed old-file errors).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/auth/permissions.ts
git commit -m "feat: replace Incident/IncidentPhoto model with simplified PhotoUpload/Photo"
```

---

### Task 2: Foto Upload anlegen/bearbeiten/löschen (kein Foto-Bezug)

**Files:**
- Delete: `src/lib/validation/incident.schema.ts`
- Delete: `src/app/(app)/meine-feuerwehr/einsaetze/actions.ts`
- Delete: `src/app/(app)/meine-feuerwehr/einsaetze/neu/page.tsx`
- Delete: `src/app/(app)/meine-feuerwehr/einsaetze/page.tsx`
- Delete: `src/app/(app)/meine-feuerwehr/einsaetze/[incidentId]/bearbeiten/page.tsx`
- Delete: `src/app/(app)/meine-feuerwehr/einsaetze/[incidentId]/incident-detail-client.tsx`
- Delete: `src/app/(app)/meine-feuerwehr/einsaetze/[incidentId]/page.tsx`
- Delete: `src/components/incidents/incident-form.tsx`
- Delete: `src/components/incidents/delete-incident-button.tsx`
- Create: `src/lib/validation/photo-upload.schema.ts`
- Create: `src/app/(app)/foto-uploads/actions.ts`
- Create: `src/components/photo-uploads/photo-upload-form.tsx`
- Create: `src/components/photo-uploads/delete-photo-upload-button.tsx`
- Create: `src/app/(app)/foto-uploads/neu/page.tsx`
- Create: `src/app/(app)/foto-uploads/[photoUploadId]/bearbeiten/page.tsx`
- Test: none — verified via `tsc`/`build` + live form submission against the dev DB

**Interfaces:**
- Consumes: `canManagePhotoUploadsFor` (Task 1), `requireUser()` (`@/lib/auth/session`), `prisma` (`@/lib/db/prisma`), `isNextRedirectError` (`@/lib/auth/is-auth-error.ts`, already exists, unchanged).
- Produces: `photoUploadSchema`, `PhotoUploadInput`, `PHOTO_UPLOAD_KINDS`, `PHOTO_UPLOAD_KIND_LABELS`, `parsePhotoUploadFormData(formData: FormData): unknown` (from `photo-upload.schema.ts`); Server Actions `createPhotoUpload(fireDepartmentId: string, prevState: PhotoUploadFormState, formData: FormData): Promise<PhotoUploadFormState>`, `updatePhotoUpload(photoUploadId: string, prevState: PhotoUploadFormState, formData: FormData): Promise<PhotoUploadFormState>`, `deletePhotoUpload(photoUploadId: string): Promise<void>` (all in `foto-uploads/actions.ts`); `PhotoUploadFormState = { error?: string }`; `<PhotoUploadForm>` component used by both `neu`/`bearbeiten` pages; `<DeletePhotoUploadButton photoUploadId={string} />`.

- [ ] **Step 1: Delete the old files listed above**

```bash
rm src/lib/validation/incident.schema.ts
rm -rf "src/app/(app)/meine-feuerwehr/einsaetze"
rm src/components/incidents/incident-form.tsx
rm src/components/incidents/delete-incident-button.tsx
```
(Leave `src/components/incidents/` itself for now if other files still live there — later tasks remove the rest and the directory disappears naturally.)

- [ ] **Step 2: Write the Zod schema**

`src/lib/validation/photo-upload.schema.ts`:
```ts
import { z } from 'zod';

export const PHOTO_UPLOAD_KINDS = ['EINSATZ', 'UEBUNG', 'SONSTIGES'] as const;

export const PHOTO_UPLOAD_KIND_LABELS: Record<(typeof PHOTO_UPLOAD_KINDS)[number], string> = {
  EINSATZ: 'Einsatz',
  UEBUNG: 'Übung',
  SONSTIGES: 'Sonstiges',
};

export const photoUploadSchema = z.object({
  kind: z.enum(PHOTO_UPLOAD_KINDS),
  description: z.string().trim().min(1, 'Beschreibung ist erforderlich.').max(200),
  occurredOn: z
    .string()
    .min(1, 'Datum ist erforderlich.')
    .refine((value) => new Date(value).getTime() <= Date.now(), 'Datum darf nicht in der Zukunft liegen.'),
});

export type PhotoUploadInput = z.infer<typeof photoUploadSchema>;

export function parsePhotoUploadFormData(formData: FormData) {
  return {
    kind: String(formData.get('kind') ?? ''),
    description: String(formData.get('description') ?? ''),
    occurredOn: String(formData.get('occurredOn') ?? ''),
  };
}
```
`occurredOn` is submitted as a plain `"YYYY-MM-DD"` string from a native `<input type="date">` — a pure calendar date has no timezone ambiguity to worry about (unlike the old `alarmedAt`/`endedAt` datetime-with-time fields), so `new Date(value)` is safe here without the `TZ=Europe/Vienna` concerns that applied to timestamp fields elsewhere in this codebase.

- [ ] **Step 3: Write the Server Actions**

`src/app/(app)/foto-uploads/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManagePhotoUploadsFor, canDeletePhoto } from '@/lib/auth/permissions';
import { photoUploadSchema, parsePhotoUploadFormData } from '@/lib/validation/photo-upload.schema';
import { deletePhotoObjects } from '@/lib/storage/photo-uploads-s3';

export interface PhotoUploadFormState {
  error?: string;
}

export async function createPhotoUpload(
  fireDepartmentId: string,
  _prevState: PhotoUploadFormState,
  formData: FormData,
): Promise<PhotoUploadFormState> {
  const user = await requireUser();
  if (!canManagePhotoUploadsFor(user, fireDepartmentId)) return { error: 'Kein Zugriff.' };

  const parsed = photoUploadSchema.safeParse(parsePhotoUploadFormData(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };

  const photoUpload = await prisma.photoUpload.create({
    data: {
      fireDepartmentId,
      kind: parsed.data.kind,
      description: parsed.data.description,
      occurredOn: new Date(parsed.data.occurredOn),
      createdById: user.id,
    },
  });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/foto-uploads');
  redirect(`/foto-uploads/${photoUpload.id}`);
}

export async function updatePhotoUpload(
  photoUploadId: string,
  _prevState: PhotoUploadFormState,
  formData: FormData,
): Promise<PhotoUploadFormState> {
  const user = await requireUser();
  const existing = await prisma.photoUpload.findUnique({ where: { id: photoUploadId }, select: { fireDepartmentId: true } });
  if (!existing || !canManagePhotoUploadsFor(user, existing.fireDepartmentId)) return { error: 'Kein Zugriff.' };

  const parsed = photoUploadSchema.safeParse(parsePhotoUploadFormData(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };

  await prisma.photoUpload.update({
    where: { id: photoUploadId },
    data: {
      kind: parsed.data.kind,
      description: parsed.data.description,
      occurredOn: new Date(parsed.data.occurredOn),
    },
  });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/foto-uploads');
  redirect(`/foto-uploads/${photoUploadId}`);
}

export async function deletePhotoUpload(photoUploadId: string): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.photoUpload.findUnique({ where: { id: photoUploadId }, select: { fireDepartmentId: true } });
  if (!existing || !canManagePhotoUploadsFor(user, existing.fireDepartmentId)) throw new Error('Kein Zugriff.');

  // Alle S3-Objekte der zugehörigen Fotos VOR dem DB-Delete entfernen, sonst wären die Storage-Keys
  // nach dem kaskadierenden Löschen der Photo-Zeilen unwiederbringlich verwaist - dieselbe Lehre wie
  // die entsprechende Behebung (Final-Review-Finding I8) in der Vorgängerversion dieser Funktion.
  const photos = await prisma.photo.findMany({
    where: { photoUploadId },
    select: { storageKey: true, previewKey: true, thumbKey: true },
  });
  const keys = photos.flatMap((photo) => [photo.storageKey, photo.previewKey, photo.thumbKey]).filter((key): key is string => key !== null);
  await deletePhotoObjects(keys);

  await prisma.photoUpload.delete({ where: { id: photoUploadId } });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/foto-uploads');
  redirect('/foto-uploads');
}

export async function deletePhoto(photoId: string, photoUploadId: string): Promise<void> {
  const user = await requireUser();
  const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { photoUpload: true } });
  if (!photo || photo.photoUploadId !== photoUploadId) throw new Error('Foto wurde nicht gefunden.');
  if (!canDeletePhoto(user, photo, photo.photoUpload.fireDepartmentId)) throw new Error('Kein Zugriff.');

  const keys = [photo.storageKey, photo.previewKey, photo.thumbKey].filter((key): key is string => key !== null);
  await deletePhotoObjects(keys);
  await prisma.photo.delete({ where: { id: photoId } });

  revalidatePath(`/foto-uploads/${photoUploadId}`);
  revalidatePath('/meine-feuerwehr');
}
```
`deletePhoto` (single-photo delete, needed by the gallery in Task 6) is included here even though it references `deletePhotoObjects` from Task 3's S3 module — Task 3 creates that module before this task's code needs to compile as part of the whole app, and both tasks land on the same branch in order, so by the time Task 6 actually calls `deletePhoto` the import resolves correctly. If you're implementing Task 2 before Task 3 exists yet, this file simply won't type-check until Task 3 lands — that's expected and fine, each task's own `tsc`/`build` check is what matters at that task's own commit, and this plan's tasks are meant to be executed in order.

- [ ] **Step 4: Write the shared form component**

`src/components/photo-uploads/photo-upload-form.tsx`:
```tsx
'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { photoUploadSchema, PHOTO_UPLOAD_KINDS, PHOTO_UPLOAD_KIND_LABELS, type PhotoUploadInput } from '@/lib/validation/photo-upload.schema';
import type { PhotoUploadFormState } from '@/app/(app)/foto-uploads/actions';

interface PhotoUploadFormProps {
  fireDepartmentName: string;
  defaultValues?: Partial<PhotoUploadInput>;
  action: (prevState: PhotoUploadFormState, formData: FormData) => Promise<PhotoUploadFormState>;
  submitLabel: string;
}

function todayIsoDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function PhotoUploadForm({ fireDepartmentName, defaultValues, action, submitLabel }: PhotoUploadFormProps) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | undefined>();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PhotoUploadInput>({
    resolver: zodResolver(photoUploadSchema),
    defaultValues: {
      kind: 'EINSATZ',
      description: '',
      occurredOn: todayIsoDate(),
      ...defaultValues,
    },
  });

  const kind = watch('kind');

  function onSubmit(values: PhotoUploadInput) {
    const formData = new FormData();
    formData.set('kind', values.kind);
    formData.set('description', values.description);
    formData.set('occurredOn', values.occurredOn);

    startTransition(async () => {
      const result = await action({}, formData);
      setServerError(result?.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5 pb-44 sm:pb-0">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-neutral-700">Anlass</label>
        <div className="grid grid-cols-3 gap-2">
          {PHOTO_UPLOAD_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setValue('kind', option)}
              className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${
                kind === option ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-700'
              }`}
            >
              {PHOTO_UPLOAD_KIND_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Beschreibung</label>
        <input {...register('description')} placeholder="z. B. T2 – Verkehrsunfall B44" className="rounded border border-neutral-300 px-3 py-2" />
        {errors.description && <p className="text-sm text-red-700">{errors.description.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-neutral-700">Datum</label>
        <input type="date" max={todayIsoDate()} {...register('occurredOn')} className="rounded border border-neutral-300 px-3 py-2" />
        {errors.occurredOn && <p className="text-sm text-red-700">{errors.occurredOn.message}</p>}
      </div>

      <p className="text-sm text-neutral-500">
        Jedes Mitglied der Feuerwehr {fireDepartmentName} darf Fotos zu diesem Einsatz hochladen und die eigenen wieder löschen. Durch das
        Hochladen werden Fotorechte an die Feuerwehr für die Veröffentlichung abgetreten.
      </p>

      {serverError && <p className="text-sm text-red-700">{serverError}</p>}

      <div className="fixed inset-x-0 bottom-[86px] z-40 flex justify-center border-t border-neutral-200 bg-white p-4 pb-safe-tabbar sm:static sm:bottom-0 sm:z-auto sm:border-0 sm:bg-transparent sm:p-0">
        <div className="flex w-full max-w-lg items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="min-h-[52px] flex-1 rounded-lg bg-brand font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {pending ? 'Speichern…' : submitLabel}
          </button>
          <Link href="/foto-uploads" className="text-sm text-neutral-600 hover:underline">
            Abbrechen
          </Link>
        </div>
      </div>
    </form>
  );
}
```
Note the footer's `bottom-[86px] z-40 sm:bottom-0 sm:z-auto` — this bakes in, from the start, the mobile-tab-bar-collision fix the previous version of this feature only discovered during its final review (`MobileTabBar` is `fixed inset-x-0 bottom-0 z-30 h-[86px] sm:hidden`; `BottomSheet` is `z-50`; `z-40` at `bottom-[86px]` sits correctly between them and clear of the tab bar's full height, not just its safe-area inset).

- [ ] **Step 5: Write the delete button component**

`src/components/photo-uploads/delete-photo-upload-button.tsx`:
```tsx
'use client';

import { useState, useTransition } from 'react';
import { deletePhotoUpload } from '@/app/(app)/foto-uploads/actions';
import { isNextRedirectError } from '@/lib/auth/is-auth-error';

export function DeletePhotoUploadButton({ photoUploadId }: { photoUploadId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function handleDelete() {
    if (!window.confirm('Diesen Foto Upload wirklich löschen? Alle Fotos werden unwiderruflich entfernt.')) return;
    setError(undefined);
    startTransition(async () => {
      try {
        await deletePhotoUpload(photoUploadId);
      } catch (err) {
        if (isNextRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="min-h-11 self-start rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 disabled:opacity-60"
      >
        {pending ? 'Wird gelöscht…' : 'Foto Upload löschen'}
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
```
`deletePhotoUpload` ends with `redirect()` on success, which Next.js implements as a thrown `NEXT_REDIRECT` control-flow error — `isNextRedirectError(err)` (already exists in `src/lib/auth/is-auth-error.ts`, used identically by the login flow for the same problem) must be checked and re-thrown *before* treating the catch as a real failure, or every successful delete would incorrectly render an error message.

- [ ] **Step 6: Write the "Foto Upload" (anlegen) page**

`src/app/(app)/foto-uploads/neu/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManagePhotoUploadsFor } from '@/lib/auth/permissions';
import { PhotoUploadForm } from '@/components/photo-uploads/photo-upload-form';
import { createPhotoUpload } from '../actions';

export default async function NeuerFotoUploadPage() {
  const user = await requireUser();
  if (!canManagePhotoUploadsFor(user, user.homeOrganizationId)) notFound();

  const fireDepartment = await prisma.organization.findUniqueOrThrow({
    where: { id: user.homeOrganizationId },
    select: { shortName: true, name: true },
  });

  const boundCreate = createPhotoUpload.bind(null, user.homeOrganizationId);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold text-neutral-900">Foto Upload</h1>
      <PhotoUploadForm fireDepartmentName={fireDepartment.shortName ?? fireDepartment.name} action={boundCreate} submitLabel="Speichern und Fotos wählen" />
    </div>
  );
}
```

- [ ] **Step 7: Write the "bearbeiten" page**

`src/app/(app)/foto-uploads/[photoUploadId]/bearbeiten/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManagePhotoUploadsFor } from '@/lib/auth/permissions';
import { PhotoUploadForm } from '@/components/photo-uploads/photo-upload-form';
import { DeletePhotoUploadButton } from '@/components/photo-uploads/delete-photo-upload-button';
import { updatePhotoUpload } from '../../actions';

export default async function FotoUploadBearbeitenPage({ params }: { params: Promise<{ photoUploadId: string }> }) {
  const { photoUploadId } = await params;
  const user = await requireUser();

  const photoUpload = await prisma.photoUpload.findUnique({
    where: { id: photoUploadId },
    include: { fireDepartment: { select: { shortName: true, name: true } } },
  });
  if (!photoUpload || !canManagePhotoUploadsFor(user, photoUpload.fireDepartmentId)) notFound();

  const boundUpdate = updatePhotoUpload.bind(null, photoUpload.id);
  const occurredOnValue = photoUpload.occurredOn.toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold text-neutral-900">Foto Upload bearbeiten</h1>
      <PhotoUploadForm
        fireDepartmentName={photoUpload.fireDepartment.shortName ?? photoUpload.fireDepartment.name}
        defaultValues={{ kind: photoUpload.kind, description: photoUpload.description, occurredOn: occurredOnValue }}
        action={boundUpdate}
        submitLabel="Änderungen speichern"
      />
      <div className="pb-44 sm:pb-0">
        <DeletePhotoUploadButton photoUploadId={photoUpload.id} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Verify**

Run `npx tsc --noEmit` and `npm run build` — both must succeed (some pre-existing errors from files Task 3+ haven't rewritten yet are expected at this point if you're strictly following task order without a full-app compile checkpoint; if you want a clean compile at every step, you may find it simpler to do Tasks 1-4 together before your first `tsc` check — use your judgment). Start the dev server, sign in as a seeded member, open `/foto-uploads/neu`, submit a real Foto Upload (pick a kind, fill description/date), confirm it redirects to `/foto-uploads/<id>` (expected 404 until Task 6 adds the detail page — confirm success via a direct DB query instead). Open the edit page, change the description, confirm it persists. Confirm the delete button works and redirects to `/foto-uploads` (expected 404 until Task 9 adds the list page — again confirm via DB query). Confirm a future date is rejected with an inline error.

- [ ] **Step 9: Commit**

```bash
git add src/lib/validation/photo-upload.schema.ts "src/app/(app)/foto-uploads" src/components/photo-uploads
git commit -m "feat: add Foto Upload anlegen/bearbeiten/löschen"
```

---

### Task 3: S3-Client (umbenannt), Presign- und Complete-Route

**Files:**
- Delete: `src/lib/storage/incident-photos-s3.ts`
- Delete: `src/lib/validation/incident-photo.ts`
- Delete: `src/app/api/incidents/` (entire directory)
- Create: `src/lib/storage/photo-uploads-s3.ts`
- Create: `src/lib/validation/photo.ts`
- Create: `src/app/api/photo-uploads/[photoUploadId]/photos/presign/route.ts`
- Create: `src/app/api/photo-uploads/[photoUploadId]/photos/[photoId]/complete/route.ts`
- Test: none — verified via `curl` against the running dev server and a real uploaded file's non-network code paths (same real-S3-unreachable constraint as before — this worktree's `.env` still has placeholder credentials)

**Interfaces:**
- Consumes: `canViewPhotoUploadsFor` (Task 1), `requireUser()`, `prisma`, `sharp`, `exifr` (already installed dependencies, unchanged from the prior version of this feature).
- Produces: `getPhotoUploadsS3Client(): S3Client`, `presignPhotoUpload(storageKey: string, contentType: string): Promise<string>`, `presignPhotoDownload(storageKey: string, options?: { contentDisposition?: string }): Promise<string>`, `headPhotoObject`, `getPhotoObjectBytes`, `putPreviewObject`, `deletePhotoObjects(storageKeys: string[]): Promise<void>` (all in `photo-uploads-s3.ts`, identical bodies to the deleted `incident-photos-s3.ts` — only the file/import path changes); `ALLOWED_PHOTO_MIME_TYPES`, `ALLOWED_SHARP_PHOTO_FORMATS`, `MAX_PHOTO_BYTES`, `MAX_PHOTOS_PER_BATCH`, `extensionForMimeType`, `buildPhotoStorageKeys(photoUploadId: string, photoId: string, mimeType: string): { storageKey: string; previewKey: string; thumbKey: string }` (all in `photo.ts` — same logic as the deleted `incident-photo.ts`, renamed identifiers, and `thumbKey` instead of `thumbnailKey`); the two route handlers, consumed by Task 4's download route and Task 5's foreground upload mechanic.

- [ ] **Step 1: Delete the old files**

```bash
rm src/lib/storage/incident-photos-s3.ts
rm src/lib/validation/incident-photo.ts
rm -rf src/app/api/incidents
```

- [ ] **Step 2: Write the S3 client module**

`src/lib/storage/photo-uploads-s3.ts`:
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

export function getPhotoUploadsS3Client(): S3Client {
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

/** Presigned PUT für den direkten Client->S3-Upload des Originals - 15 Minuten Gültigkeit. */
export async function presignPhotoUpload(storageKey: string, contentType: string): Promise<string> {
  const client = getPhotoUploadsS3Client();
  const command = new PutObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey, ContentType: contentType });
  return getSignedUrl(client, command, { expiresIn: 900 });
}

/** Presigned GET für Downloads/Vorschauen - nie eine dauerhafte URL, jede Anfrage geht über die
 * session-geprüfte Route (Task 4), die diese Funktion erst NACH der Berechtigungsprüfung aufruft. */
export async function presignPhotoDownload(storageKey: string, options?: { contentDisposition?: string }): Promise<string> {
  const client = getPhotoUploadsS3Client();
  const command = new GetObjectCommand({
    Bucket: getPhotosBucket(),
    Key: storageKey,
    ResponseContentDisposition: options?.contentDisposition,
  });
  return getSignedUrl(client, command, { expiresIn: 60 });
}

export async function headPhotoObject(storageKey: string): Promise<{ contentLength: number } | null> {
  const client = getPhotoUploadsS3Client();
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey }));
    return { contentLength: result.ContentLength ?? 0 };
  } catch {
    return null;
  }
}

export async function getPhotoObjectBytes(storageKey: string): Promise<Buffer> {
  const client = getPhotoUploadsS3Client();
  const result = await client.send(new GetObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function putPreviewObject(storageKey: string, body: Buffer, contentType: string): Promise<void> {
  const client = getPhotoUploadsS3Client();
  await client.send(new PutObjectCommand({ Bucket: getPhotosBucket(), Key: storageKey, Body: body, ContentType: contentType }));
}

export async function deletePhotoObjects(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return;
  const client = getPhotoUploadsS3Client();
  await client.send(
    new DeleteObjectsCommand({
      Bucket: getPhotosBucket(),
      Delete: { Objects: storageKeys.map((Key) => ({ Key })) },
    }),
  );
}
```

- [ ] **Step 3: Write the MIME/format allowlist + storage-key helper**

`src/lib/validation/photo.ts`:
```ts
export const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

export const ALLOWED_SHARP_PHOTO_FORMATS = ['jpeg', 'png', 'webp', 'gif', 'heif'];

export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export const MAX_PHOTOS_PER_BATCH = 30;

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

export function buildPhotoStorageKeys(
  photoUploadId: string,
  photoId: string,
  mimeType: string,
): { storageKey: string; previewKey: string; thumbKey: string } {
  const ext = extensionForMimeType(mimeType);
  return {
    storageKey: `photo-uploads/${photoUploadId}/${photoId}/original.${ext}`,
    previewKey: `photo-uploads/${photoUploadId}/${photoId}/view.webp`,
    thumbKey: `photo-uploads/${photoUploadId}/${photoId}/thumb.webp`,
  };
}
```

- [ ] **Step 4: Write the presign route**

`src/app/api/photo-uploads/[photoUploadId]/photos/presign/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewPhotoUploadsFor } from '@/lib/auth/permissions';
import { ALLOWED_PHOTO_MIME_TYPES, MAX_PHOTO_BYTES, buildPhotoStorageKeys } from '@/lib/validation/photo';
import { presignPhotoUpload } from '@/lib/storage/photo-uploads-s3';

export async function POST(request: Request, { params }: { params: Promise<{ photoUploadId: string }> }) {
  const user = await requireUser();
  const { photoUploadId } = await params;

  const photoUpload = await prisma.photoUpload.findUnique({ where: { id: photoUploadId }, select: { fireDepartmentId: true } });
  if (!photoUpload || !canViewPhotoUploadsFor(user, photoUpload.fireDepartmentId)) {
    return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { fileName?: string; mimeType?: string; byteSize?: number } | null;
  if (!body?.fileName || !body.mimeType || typeof body.byteSize !== 'number') {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });
  }
  if (!ALLOWED_PHOTO_MIME_TYPES.includes(body.mimeType)) {
    return NextResponse.json({ error: 'Dateityp nicht erlaubt.' }, { status: 400 });
  }
  if (body.byteSize <= 0 || body.byteSize > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: 'Datei zu groß (maximal 50 MB).' }, { status: 400 });
  }

  const photo = await prisma.photo.create({
    data: {
      photoUploadId,
      uploadedById: user.id,
      storageKey: '',
      originalName: body.fileName,
      mimeType: body.mimeType,
      byteSize: body.byteSize,
      status: 'PENDING',
    },
  });

  const { storageKey } = buildPhotoStorageKeys(photoUploadId, photo.id, body.mimeType);
  await prisma.photo.update({ where: { id: photo.id }, data: { storageKey } });

  const uploadUrl = await presignPhotoUpload(storageKey, body.mimeType);
  return NextResponse.json({ photoId: photo.id, uploadUrl, storageKey });
}
```

- [ ] **Step 5: Write the complete route**

`src/app/api/photo-uploads/[photoUploadId]/photos/[photoId]/complete/route.ts`:
```ts
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { parse as parseExif } from 'exifr';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewPhotoUploadsFor } from '@/lib/auth/permissions';
import { ALLOWED_SHARP_PHOTO_FORMATS, MAX_PHOTO_BYTES, buildPhotoStorageKeys } from '@/lib/validation/photo';
import { headPhotoObject, getPhotoObjectBytes, putPreviewObject, deletePhotoObjects } from '@/lib/storage/photo-uploads-s3';

async function failPhoto(photoId: string, storageKey: string): Promise<void> {
  await deletePhotoObjects([storageKey]);
  await prisma.photo.update({ where: { id: photoId }, data: { status: 'FAILED' } });
}

export async function POST(_request: Request, { params }: { params: Promise<{ photoUploadId: string; photoId: string }> }) {
  const user = await requireUser();
  const { photoUploadId, photoId } = await params;

  const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { photoUpload: true } });
  if (!photo || photo.photoUploadId !== photoUploadId || !canViewPhotoUploadsFor(user, photo.photoUpload.fireDepartmentId)) {
    return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 404 });
  }

  // Atomarer Claim gegen einen doppelten complete-Aufruf (z. B. ein Client-Retry) - dieselbe
  // updateMany/count-Guard-Technik wie consumeToken() (lib/auth/tokens.ts).
  const claimed = await prisma.photo.updateMany({ where: { id: photo.id, status: 'PENDING' }, data: { status: 'UPLOADING' } });
  if (claimed.count === 0) {
    return NextResponse.json({ error: 'Foto wurde bereits verarbeitet.' }, { status: 409 });
  }

  const head = await headPhotoObject(photo.storageKey);
  if (!head) {
    await prisma.photo.update({ where: { id: photo.id }, data: { status: 'PENDING' } });
    return NextResponse.json({ error: 'Objekt wurde nicht gefunden - Upload unvollständig.' }, { status: 400 });
  }
  if (head.contentLength > MAX_PHOTO_BYTES) {
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

  const { previewKey, thumbKey } = buildPhotoStorageKeys(photoUploadId, photo.id, photo.mimeType);
  const rotated = sharp(originalBytes).rotate();
  const [viewBuffer, thumbBuffer] = await Promise.all([
    rotated.clone().resize(1600, undefined, { fit: 'inside', withoutEnlargement: true }).webp().toBuffer(),
    rotated.clone().resize(400, 400, { fit: 'cover' }).webp().toBuffer(),
  ]);
  await Promise.all([putPreviewObject(previewKey, viewBuffer, 'image/webp'), putPreviewObject(thumbKey, thumbBuffer, 'image/webp')]);

  const updated = await prisma.photo.update({
    where: { id: photo.id },
    data: { status: 'READY', byteSize: head.contentLength, width: metadata.width ?? null, height: metadata.height ?? null, takenAt, previewKey, thumbKey },
  });

  return NextResponse.json({ photo: updated });
}
```
This bakes in, from the start, the atomic-claim fix and the `head === null` → revert-to-`PENDING` fix that the prior version of this feature only arrived at after a review round — no need to rediscover either one.

- [ ] **Step 6: Verify with a real JPEG round-trip via `curl`**

Same procedure as before: presign against a real `PhotoUpload` id, `PUT` a real JPEG to the returned `uploadUrl`, call `complete`, confirm `status: READY` with populated `width`/`height`. Then try a non-image file and confirm `400` + `status: FAILED` + the S3 object actually deleted. Then call `complete` twice on an already-`READY` photo and confirm the second call gets `409`.

- [ ] **Step 7: Remove the now-unused `idb` dependency**

```bash
npm uninstall idb
```
(Nothing in this plan uses IndexedDB — the previous version's queue engine is gone, replaced by Task 5's in-memory foreground upload.)

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/storage src/lib/validation/photo.ts src/app/api/photo-uploads
git commit -m "feat: add S3 photo storage, presign and complete routes (renamed, simplified)"
```

---

### Task 4: Download-Route

**Files:**
- Create: `src/app/api/photo-uploads/[photoUploadId]/photos/[photoId]/route.ts`
- Test: none — verified via `curl` (confirm `307` + valid presigned target) and direct DB checks

**Interfaces:**
- Consumes: `canViewPhotoUploadsFor` (Task 1), `presignPhotoDownload` (Task 3).
- Produces: `GET /api/photo-uploads/[photoUploadId]/photos/[photoId]?variant=original|view|thumbnail` (307 redirect), consumed by Task 6's gallery and Task 7's home-screen block.

- [ ] **Step 1: Write the route**

`src/app/api/photo-uploads/[photoUploadId]/photos/[photoId]/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewPhotoUploadsFor } from '@/lib/auth/permissions';
import { presignPhotoDownload } from '@/lib/storage/photo-uploads-s3';

type Variant = 'original' | 'view' | 'thumbnail';

export async function GET(request: Request, { params }: { params: Promise<{ photoUploadId: string; photoId: string }> }) {
  const user = await requireUser();
  const { photoUploadId, photoId } = await params;

  const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { photoUpload: true } });
  if (!photo || photo.photoUploadId !== photoUploadId || !canViewPhotoUploadsFor(user, photo.photoUpload.fireDepartmentId)) {
    return NextResponse.json({ error: 'Foto wurde nicht gefunden.' }, { status: 404 });
  }
  if (photo.status !== 'READY') {
    return NextResponse.json({ error: 'Foto ist noch nicht verfügbar.' }, { status: 404 });
  }

  const variant = (new URL(request.url).searchParams.get('variant') as Variant | null) ?? 'view';
  const key = variant === 'original' ? photo.storageKey : variant === 'thumbnail' ? photo.thumbKey : photo.previewKey;
  if (!key) return NextResponse.json({ error: 'Foto wurde nicht gefunden.' }, { status: 404 });

  const safeFilename = photo.originalName.replace(/["\r\n]/g, '');
  const contentDisposition = variant === 'original' ? `attachment; filename="${safeFilename}"` : undefined;
  const presignedUrl = await presignPhotoDownload(key, { contentDisposition });

  return NextResponse.redirect(presignedUrl, 307);
}
```

- [ ] **Step 2: Verify**

Same verification shape as the prior version: `curl` all three variants, confirm `307` + correct `Location` host/key, confirm `variant=original`'s `Location` query string carries the right `response-content-disposition`, confirm a cross-org user and a non-`READY` photo both get `404`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/photo-uploads
git commit -m "feat: add photo download route"
```

---

### Task 5: Vordergrund-Upload-Mechanik + Sheet „Fotos hinzufügen"

**Files:**
- Delete: `src/lib/upload-queue/` (entire directory)
- Delete: `src/components/incidents/photo-upload-sheet.tsx`
- Create: `src/lib/photo-upload/foreground-upload.ts`
- Create: `src/components/photo-uploads/photo-upload-sheet.tsx`
- Test: none — verified via a live browser session against the running dev server (production build, since `npm run dev`'s CSP blocks hydration — see below)

**Interfaces:**
- Consumes: `MAX_PHOTOS_PER_BATCH` (Task 3), `<BottomSheet>` (`@/components/ui/bottom-sheet`, unchanged, pre-existing).
- Produces: `type UploadItem = { id: string; file: File; uploadedBytes: number; status: 'pending' | 'uploading' | 'done' | 'failed'; error?: string }`, `uploadOnePhoto(photoUploadId: string, item: UploadItem, onProgress: (bytes: number) => void): Promise<void>` (throws on failure, in `foreground-upload.ts`); `<PhotoUploadSheet photoUploadId={string} open={boolean} onClose={() => void} onUploaded={() => void} />` (in `photo-upload-sheet.tsx`), consumed by Task 6's detail page and Task 7's home-screen block.

**This task replaces the entire prior IndexedDB-backed queue engine with a plain, in-component worker pool — no persistence, no pause/resume, no Wi-Fi gate**, per the simplified spec's §5.

- [ ] **Step 1: Delete the old files**

```bash
rm -rf src/lib/upload-queue
rm src/components/incidents/photo-upload-sheet.tsx
```
(`src/components/incidents/` should now be empty or near-empty — remove the directory entirely once every file in it has been deleted across this plan's tasks; if anything unexpected remains after Task 8, investigate before deleting the directory itself.)

- [ ] **Step 2: Write the single-file upload helper**

`src/lib/photo-upload/foreground-upload.ts`:
```ts
export interface UploadItem {
  id: string;
  file: File;
  uploadedBytes: number;
  status: 'pending' | 'uploading' | 'done' | 'failed';
  error?: string;
}

/** Lädt genau eine Datei hoch: presign -> XHR PUT (mit Byte-Fortschritt) -> complete. Wirft bei
 * jedem Fehlschlag - der Aufrufer (photo-upload-sheet.tsx) fängt das pro Datei ab, damit ein
 * einzelner Fehlschlag die übrigen nicht mitreißt (Foto-Upload-Brief.md §5.4). Kein
 * Wiederaufnehmen/Pausieren - das ist mit dieser rein synchronen, nicht-persistenten Funktion
 * bewusst nicht vorgesehen; ein Fehlschlag wird stattdessen einfach erneut aufgerufen
 * ("Erneut versuchen"), was denselben Ablauf von vorn beginnt. */
export async function uploadOnePhoto(photoUploadId: string, file: File, onProgress: (bytes: number) => void): Promise<void> {
  const presignResponse = await fetch(`/api/photo-uploads/${photoUploadId}/photos/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, byteSize: file.size }),
  });
  if (!presignResponse.ok) {
    const body = (await presignResponse.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Server hat den Upload abgelehnt.');
  }
  const { uploadUrl, photoId } = (await presignResponse.json()) as { uploadUrl: string; photoId: string };

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload fehlgeschlagen (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('Netzwerkfehler beim Hochladen.'));
    xhr.send(file);
  });

  const completeResponse = await fetch(`/api/photo-uploads/${photoUploadId}/photos/${photoId}/complete`, { method: 'POST' });
  if (!completeResponse.ok) {
    const body = (await completeResponse.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Verarbeitung nach dem Upload fehlgeschlagen.');
  }
}
```

- [ ] **Step 3: Write the sheet component with the worker-pool upload mechanic**

`src/components/photo-uploads/photo-upload-sheet.tsx`:
```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { uploadOnePhoto, type UploadItem } from '@/lib/photo-upload/foreground-upload';
import { MAX_PHOTOS_PER_BATCH } from '@/lib/validation/photo';

interface PhotoUploadSheetProps {
  photoUploadId: string;
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

const MAX_PARALLEL = 3;

export function PhotoUploadSheet({ photoUploadId, open, onClose, onUploaded }: PhotoUploadSheetProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [running, setRunning] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const activeCountRef = useRef(0);

  const anyInFlight = items.some((item) => item.status === 'pending' || item.status === 'uploading');

  // Rückfrage vor Tab-Schließen/Neuladen, solange eine Übertragung läuft (Foto-Upload-Brief.md §5.4:
  // "Verlässt er ihn trotzdem: Rückfrage, dass laufende Übertragungen abgebrochen werden"). Next.js
  // App Router bietet keinen globalen Client-Navigations-Interceptor - diese Absicherung deckt
  // Tab-Ereignisse und den eigenen Schließen-Pfad des Sheets ab (siehe handleAttemptClose unten),
  // nicht jede denkbare In-App-Navigation währenddessen (z. B. ein Klick auf einen anderen
  // Nav-Link) - eine bewusst begrenzte, dokumentierte Plattform-/Framework-Grenze, analog zur
  // iOS-Netzwerk-API-Einschränkung der Vorgängerversion dieser Funktion.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!anyInFlight) return;
      event.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [anyInFlight]);

  function handleFiles(fileList: FileList | null, sourceRef: React.RefObject<HTMLInputElement | null>) {
    if (!fileList || fileList.length === 0) return;
    for (const ref of [cameraInputRef, libraryInputRef, filesInputRef]) {
      if (ref !== sourceRef && ref.current) ref.current.value = '';
    }
    const files = Array.from(fileList).slice(0, MAX_PHOTOS_PER_BATCH);
    setItems(files.map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file, uploadedBytes: 0, status: 'pending' })));
  }

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function runItem(item: UploadItem) {
    updateItem(item.id, { status: 'uploading', error: undefined, uploadedBytes: 0 });
    try {
      await uploadOnePhoto(photoUploadId, item.file, (bytes) => updateItem(item.id, { uploadedBytes: bytes }));
      updateItem(item.id, { status: 'done', uploadedBytes: item.file.size });
    } catch (error) {
      updateItem(item.id, { status: 'failed', error: error instanceof Error ? error.message : 'Unbekannter Fehler.' });
    }
  }

  async function processQueue(currentItems: UploadItem[]) {
    setRunning(true);
    let pool = currentItems;
    while (true) {
      const pending = pool.filter((item) => item.status === 'pending');
      if (pending.length === 0 && activeCountRef.current === 0) break;
      for (const item of pending) {
        if (activeCountRef.current >= MAX_PARALLEL) break;
        activeCountRef.current += 1;
        void runItem(item).finally(() => {
          activeCountRef.current -= 1;
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      pool = await new Promise<UploadItem[]>((resolve) => setItems((latest) => (resolve(latest), latest)));
    }
    setRunning(false);
    onUploaded();
  }

  function startUpload() {
    if (items.length === 0) return;
    void processQueue(items);
  }

  function retryItem(id: string) {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    updateItem(id, { status: 'pending' });
    void processQueue(items.map((entry) => (entry.id === id ? { ...entry, status: 'pending' } : entry)));
  }

  function handleAttemptClose() {
    if (anyInFlight) {
      if (!window.confirm('Es laufen noch Übertragungen. Wirklich verlassen? Laufende Übertragungen werden abgebrochen.')) return;
    }
    setItems([]);
    onClose();
  }

  const doneCount = items.filter((item) => item.status === 'done').length;
  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  const uploadedBytes = items.reduce((sum, item) => sum + item.uploadedBytes, 0);

  return (
    <BottomSheet open={open} onClose={handleAttemptClose} title="Fotos hinzufügen">
      <div className="flex flex-col gap-4">
        {items.length === 0 && (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => cameraInputRef.current?.click()} className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900">
              Foto aufnehmen
            </button>
            <button type="button" onClick={() => libraryInputRef.current?.click()} className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900">
              Aus der Fotobibliothek
            </button>
            <button type="button" onClick={() => filesInputRef.current?.click()} className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900">
              Aus Dateien
            </button>
          </div>
        )}

        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files, cameraInputRef)} />
        <input ref={libraryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files, libraryInputRef)} />
        <input ref={filesInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files, filesInputRef)} />

        {items.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-neutral-700">
              {running || doneCount > 0
                ? `${doneCount} von ${items.length} Fotos übertragen · ${(uploadedBytes / (1024 * 1024)).toFixed(1)} MB von ${(totalBytes / (1024 * 1024)).toFixed(1)} MB · Originalauflösung`
                : `${items.length} Fotos ausgewählt`}
            </p>
            {running && <p className="text-xs text-neutral-500">Der Upload läuft, bitte warte bis alle Fotos hochgeladen sind.</p>}
            {items
              .filter((item) => item.status === 'failed')
              .map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    {item.file.name}: {item.error}
                  </span>
                  <button type="button" onClick={() => retryItem(item.id)} className="text-brand hover:underline">
                    Erneut versuchen
                  </button>
                </div>
              ))}
          </div>
        )}

        <div className="flex items-start gap-2 text-sm text-green-800">
          <span aria-hidden className="mt-1 h-2 w-2 flex-none rounded-full bg-green-600" />
          <p>Durch das Hochladen werden die Fotorechte an die Feuerwehr für die Veröffentlichung abgetreten.</p>
        </div>
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Fotos werden unverändert gespeichert — samt Aufnahmezeit und, falls im Bild vorhanden, Standortdaten. Bei Personen und Kennzeichen gilt
          die Datenschutzregelung der Wehr.
        </p>

        {items.length > 0 && !running && doneCount < items.length && (
          <button type="button" onClick={startUpload} className="min-h-[52px] rounded-lg bg-brand font-medium text-white">
            {items.length} Fotos übertragen
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
```
`processQueue`'s polling loop (`setTimeout` + reading `items` back via a `setItems` callback trick) is a pragmatic way to drive a bounded-concurrency worker pool from plain React state without adding a library — each iteration starts as many `pending` items as the `MAX_PARALLEL` cap allows, waits briefly, and re-checks. `onUploaded()` fires once every item has reached a terminal state (`done` or the loop simply stops retrying `failed` ones automatically — a failed item stays visible with "Erneut versuchen" until the user acts). Note: unlike the prior version, there is no `wifiOnly` concept anywhere in this file — no Network Information API check, no gating, per the simplified spec's explicit removal of that toggle.

- [ ] **Step 4: Verify**

This project's `npm run dev` blocks real browser hydration under its own CSP (`script-src 'self' 'unsafe-inline'`, no `'unsafe-eval'` — Next dev mode's `eval`-wrapped HMR chunks get blocked outright). **Use `npm run build && npm run start` for any live check that needs working client-side interactivity.** Run `npx tsc --noEmit` and `npm run build` (clean required). Live-verify: open the sheet on a throwaway host page (or wait until Task 6 gives it a real one — a temporary test page + temporary public-path addition, cleaned up afterward, is an acceptable pattern if you need to verify before Task 6 lands), select 2-3 real small images via "Aus Dateien", confirm the byte-progress line updates, confirm a deliberately-broken upload (e.g. against a nonexistent `photoUploadId`) shows a per-file error with a working "Erneut versuchen", and confirm attempting to close the sheet mid-upload triggers the `window.confirm` guard.

- [ ] **Step 5: Commit**

```bash
git add src/lib/photo-upload src/components/photo-uploads/photo-upload-sheet.tsx
git commit -m "feat: replace IndexedDB upload queue with foreground upload mechanic"
```

---

### Task 6: Foto Upload-Detail mit Galerie, Löschen

**Files:**
- Delete: `src/components/incidents/incident-photo-gallery.tsx`
- Delete: `src/components/incidents/recent-incidents-block.tsx` (moved to Task 7, not deleted-and-gone — listed here only so you don't confuse it with a leftover; Task 7 creates its replacement)
- Create: `src/components/photo-uploads/photo-gallery.tsx`
- Create: `src/app/(app)/foto-uploads/[photoUploadId]/page.tsx`
- Create: `src/app/(app)/foto-uploads/[photoUploadId]/photo-upload-detail-client.tsx`
- Test: none — verified live in the browser with a real uploaded photo

**Interfaces:**
- Consumes: `canViewPhotoUploadsFor`, `canManagePhotoUploadsFor` (Task 1), `deletePhoto` (Task 2), `<PhotoUploadSheet>` (Task 5), the download route (Task 4).
- Produces: `/foto-uploads/[photoUploadId]` page, `<PhotoGallery>` component (thumbnail URL convention `/api/photo-uploads/{photoUploadId}/photos/{photoId}?variant=thumbnail`, reused by Task 7's home-screen block).

**Note on progress display**: unlike the prior queue-based version, there is no persistent, cross-component upload state to subscribe to — progress is only ever visible *inside* the open `PhotoUploadSheet` itself (per §5.4's "Vordergrund"/blocking design, the user stays on the sheet until done). The gallery below does **not** need its own progress banner; it only needs to re-fetch (`router.refresh()`) once the sheet reports `onUploaded()`.

- [ ] **Step 1: Delete the old gallery file**

```bash
rm src/components/incidents/incident-photo-gallery.tsx
```

- [ ] **Step 2: Write the gallery component**

`src/components/photo-uploads/photo-gallery.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { deletePhoto } from '@/app/(app)/foto-uploads/actions';

interface PhotoData {
  id: string;
  uploadedById: string;
  uploadedByName: string;
  takenAt: string | null;
  byteSize: number;
  originalName: string;
}

interface PhotoGalleryProps {
  photoUploadId: string;
  photos: PhotoData[];
  currentUserId: string;
  isFeuerwehrAdmin: boolean;
}

function initials(name: string): string {
  return name.split(' ').map((part) => part[0]).join('').toUpperCase().slice(0, 2);
}

function formatBytes(byteSize: number): string {
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

export function PhotoGallery({ photoUploadId, photos, currentUserId, isFeuerwehrAdmin }: PhotoGalleryProps) {
  const [selected, setSelected] = useState<PhotoData | null>(null);
  const [actionError, setActionError] = useState<string | undefined>();

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-1.5">
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => {
              setActionError(undefined);
              setSelected(photo);
            }}
            className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Bild kommt aus einer eigenen,
               session-geschützten Route mit 307-Redirect auf eine kurzlebige presigned URL. */}
            <img src={`/api/photo-uploads/${photoUploadId}/photos/${photo.id}?variant=thumbnail`} alt="" className="h-full w-full object-cover" />
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
            <img src={`/api/photo-uploads/${photoUploadId}/photos/${selected.id}?variant=view`} alt="" className="max-h-[50vh] w-full rounded-lg object-contain" />
            <p className="text-sm text-neutral-700">Hochgeladen von {selected.uploadedByName}</p>
            {selected.takenAt && <p className="text-sm text-neutral-500">Aufgenommen am {new Date(selected.takenAt).toLocaleString('de-AT')}</p>}
            <p className="text-sm text-neutral-500">{formatBytes(selected.byteSize)}</p>
            <a href={`/api/photo-uploads/${photoUploadId}/photos/${selected.id}?variant=original`} className="rounded-lg border border-neutral-300 px-4 py-2 text-center text-sm font-medium text-neutral-900">
              Original herunterladen
            </a>
            {(selected.uploadedById === currentUserId || isFeuerwehrAdmin) && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm('Foto wirklich löschen?')) return;
                  deletePhoto(selected.id, photoUploadId)
                    .then(() => setSelected(null))
                    .catch((error) => setActionError(error instanceof Error ? error.message : 'Löschen fehlgeschlagen.'));
                }}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
              >
                Löschen
              </button>
            )}
            {actionError && <p className="text-sm text-red-700">{actionError}</p>}
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
`isFeuerwehrAdmin` (not the "any member" `canManagePhotoUploadsFor` value) is the correct gate here — the delete button must be uploader-or-genuine-admin, matching `canDeletePhoto`'s real rule, not "any member of the Feuerwehr can delete anyone's photo." Get this right from the start; the prior version of this feature got it wrong on the first pass and needed a review-driven fix.

- [ ] **Step 3: Write the detail page (Server Component) + its Client wrapper**

`src/app/(app)/foto-uploads/[photoUploadId]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewPhotoUploadsFor, canManagePhotoUploadsFor, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { PHOTO_UPLOAD_KIND_LABELS } from '@/lib/validation/photo-upload.schema';
import { PhotoUploadDetailClient } from './photo-upload-detail-client';

export default async function FotoUploadDetailPage({ params }: { params: Promise<{ photoUploadId: string }> }) {
  const { photoUploadId } = await params;
  const user = await requireUser();

  const photoUpload = await prisma.photoUpload.findUnique({
    where: { id: photoUploadId },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      photos: { where: { status: 'READY' }, orderBy: { createdAt: 'asc' }, include: { uploadedBy: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!photoUpload || !canViewPhotoUploadsFor(user, photoUpload.fireDepartmentId)) notFound();

  const canManage = canManagePhotoUploadsFor(user, photoUpload.fireDepartmentId);
  const isFeuerwehrAdmin = canManageHeimatfeuerwehrFor(user, photoUpload.fireDepartmentId);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
            {PHOTO_UPLOAD_KIND_LABELS[photoUpload.kind]}
          </span>
          <h1 className="mt-1 text-xl font-bold text-neutral-900">{photoUpload.description}</h1>
          <p className="text-sm text-neutral-500">
            {photoUpload.occurredOn.toLocaleDateString('de-AT')} · Angelegt von {photoUpload.createdBy.firstName} {photoUpload.createdBy.lastName}
          </p>
        </div>
        {canManage && (
          <Link href={`/foto-uploads/${photoUpload.id}/bearbeiten`} className="text-sm text-brand hover:underline">
            Bearbeiten
          </Link>
        )}
      </div>

      <PhotoUploadDetailClient
        photoUploadId={photoUpload.id}
        currentUserId={user.id}
        isFeuerwehrAdmin={isFeuerwehrAdmin}
        photos={photoUpload.photos.map((photo) => ({
          id: photo.id,
          uploadedById: photo.uploadedById,
          uploadedByName: `${photo.uploadedBy.firstName} ${photo.uploadedBy.lastName}`,
          takenAt: photo.takenAt?.toISOString() ?? null,
          byteSize: photo.byteSize,
          originalName: photo.originalName,
        }))}
      />
    </div>
  );
}
```

`src/app/(app)/foto-uploads/[photoUploadId]/photo-upload-detail-client.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhotoUploadSheet } from '@/components/photo-uploads/photo-upload-sheet';
import { PhotoGallery } from '@/components/photo-uploads/photo-gallery';

interface PhotoUploadDetailClientProps {
  photoUploadId: string;
  currentUserId: string;
  isFeuerwehrAdmin: boolean;
  photos: {
    id: string;
    uploadedById: string;
    uploadedByName: string;
    takenAt: string | null;
    byteSize: number;
    originalName: string;
  }[];
}

export function PhotoUploadDetailClient({ photoUploadId, currentUserId, isFeuerwehrAdmin, photos }: PhotoUploadDetailClientProps) {
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

      <PhotoGallery photoUploadId={photoUploadId} photos={photos} currentUserId={currentUserId} isFeuerwehrAdmin={isFeuerwehrAdmin} />

      <PhotoUploadSheet
        photoUploadId={photoUploadId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onUploaded={() => {
          router.refresh();
          setSheetOpen(false);
        }}
      />
    </div>
  );
}
```
`onUploaded` both refreshes the server data (so newly-`READY` photos appear) and closes the sheet — since the upload is a blocking foreground action, by the time `onUploaded()` fires every item has already reached a terminal state (`done` or left `failed` with a visible retry option the user chose not to use), so auto-closing here is the correct end of the flow, not a premature interruption.

- [ ] **Step 4: Verify live in the browser**

Same procedure as before (production build via `npm run build && npm run start`): create a Foto Upload, open its detail page, upload a real small photo via "Aus Dateien", confirm it appears in the grid once done, open the single-photo view, download the original, confirm delete works for the uploader and is hidden for a plain non-admin teammate but visible for a real Feuerwehr admin account.

- [ ] **Step 5: Commit**

```bash
git add src/components/photo-uploads/photo-gallery.tsx "src/app/(app)/foto-uploads/[photoUploadId]"
git commit -m "feat: add Foto Upload detail page with photo gallery"
```

---

### Task 7: 24-Stunden-Block auf „Meine Feuerwehr" (umbenannt)

**Files:**
- Delete: `src/components/incidents/recent-incidents-block.tsx`
- Create: `src/components/photo-uploads/recent-photo-uploads-block.tsx`
- Modify: `src/app/(app)/meine-feuerwehr/page.tsx`
- Test: none — verified live in the browser

**Interfaces:**
- Consumes: `canManagePhotoUploadsFor` (Task 1), `<PhotoUploadSheet>` (Task 5).
- Produces: a renamed block rendered inside `MeineFeuerwehrPage`, unchanged position (after the Fuhrpark/quick-access grid).

- [ ] **Step 1: Delete the old block, remove now-empty `src/components/incidents/`**

```bash
rm src/components/incidents/recent-incidents-block.tsx
rmdir src/components/incidents 2>/dev/null || true
```

- [ ] **Step 2: Update `meine-feuerwehr/page.tsx`**

Change the import on line 4 from:
```ts
import { canManageEventsFor, canManageHeimatfeuerwehrFor, canManageIncidentsFor, canViewDroneModule } from '@/lib/auth/permissions';
```
to:
```ts
import { canManageEventsFor, canManageHeimatfeuerwehrFor, canManagePhotoUploadsFor, canViewDroneModule } from '@/lib/auth/permissions';
```

Change line 13 from:
```ts
import { RecentIncidentsBlock } from '@/components/incidents/recent-incidents-block';
```
to:
```ts
import { RecentPhotoUploadsBlock } from '@/components/photo-uploads/recent-photo-uploads-block';
```

Replace the `prisma.incident.findMany(...)` query (currently the 6th entry in the `Promise.all` array, around line 171-182) with:
```ts
    // 24-Stunden-Block (Foto-Upload-Brief.md §3) - bewusst dieselbe fireDepartmentId-Scoping wie
    // canViewPhotoUploadsFor (homeOrganizationId), aber hier direkt in der Query, da diese Query
    // schon vor dem Laden von `user`s Berechtigungsobjekt läuft und ausschließlich die eigene
    // Feuerwehr zeigt (kein Admin-Fall nötig).
    prisma.photoUpload.findMany({
      where: { fireDepartmentId: user.homeOrganizationId, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { firstName: true, lastName: true } },
        photos: { where: { status: 'READY' }, orderBy: { createdAt: 'asc' }, take: 4 },
        _count: { select: { photos: { where: { status: 'READY' } } } },
      },
    }),
```
Rename the destructured variable it feeds — change `recentIncidents` to `recentPhotoUploads` everywhere it's used in this file (the `Promise.all` destructure at the top, and the two usages further down described next).

Replace the "Einsatz erfassen"/"Alle Einsätze" block:
```tsx
      {canManagePhotoUploadsFor(user, user.homeOrganizationId) && (
        <div className="flex items-center gap-3">
          <Link
            href="/foto-uploads/neu"
            className="flex min-h-12 flex-1 items-center justify-center rounded-lg border-2 border-brand text-sm font-semibold text-brand"
          >
            Foto Upload
          </Link>
          <Link href="/foto-uploads" className="text-sm font-medium text-neutral-600 hover:underline">
            Alle Foto Uploads
          </Link>
        </div>
      )}
```

Replace the `{recentIncidents.length > 0 && (<RecentIncidentsBlock .../>)}` block with:
```tsx
      {recentPhotoUploads.length > 0 && (
        <RecentPhotoUploadsBlock
          photoUploads={recentPhotoUploads.map((photoUpload) => ({
            id: photoUpload.id,
            kind: photoUpload.kind,
            description: photoUpload.description,
            createdAt: photoUpload.createdAt.toISOString(),
            createdByName: `${photoUpload.createdBy.firstName} ${photoUpload.createdBy.lastName}`,
            photoIds: photoUpload.photos.map((p) => p.id),
            totalPhotoCount: photoUpload._count.photos,
          }))}
        />
      )}
```

- [ ] **Step 3: Write `RecentPhotoUploadsBlock`**

`src/components/photo-uploads/recent-photo-uploads-block.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PhotoUploadSheet } from './photo-upload-sheet';
import { PHOTO_UPLOAD_KIND_LABELS } from '@/lib/validation/photo-upload.schema';
import type { PhotoUploadKind } from '@prisma/client';

interface RecentPhotoUpload {
  id: string;
  kind: PhotoUploadKind;
  description: string;
  createdAt: string;
  createdByName: string;
  photoIds: string[];
  totalPhotoCount: number;
}

export function RecentPhotoUploadsBlock({ photoUploads }: { photoUploads: RecentPhotoUpload[] }) {
  const [sheetPhotoUploadId, setSheetPhotoUploadId] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Foto Uploads (letzte 24 Stunden)</span>
      {photoUploads.map((photoUpload) => (
        <div key={photoUpload.id} className="flex flex-col gap-2 rounded-xl bg-white p-4 shadow-sm">
          <Link href={`/foto-uploads/${photoUpload.id}`} className="min-w-0">
            <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
              {PHOTO_UPLOAD_KIND_LABELS[photoUpload.kind]}
            </span>
            <div className="mt-1 truncate text-[15px] font-semibold text-[#1c1c1e]">{photoUpload.description}</div>
            <div className="text-[13px] text-[#6c6c70]">
              {new Date(photoUpload.createdAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} · Angelegt von{' '}
              {photoUpload.createdByName}
            </div>
          </Link>

          {photoUpload.photoIds.length === 0 ? (
            <p className="text-sm text-neutral-500">Noch keine Fotos vorhanden.</p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {photoUpload.photoIds.map((photoId, index) => {
                const isLast = index === photoUpload.photoIds.length - 1;
                const remaining = photoUpload.totalPhotoCount - photoUpload.photoIds.length;
                return (
                  <Link key={photoId} href={`/foto-uploads/${photoUpload.id}`} className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200">
                    {/* eslint-disable-next-line @next/next/no-img-element -- siehe photo-gallery.tsx */}
                    <img src={`/api/photo-uploads/${photoUpload.id}/photos/${photoId}?variant=thumbnail`} alt="" className="h-full w-full object-cover" />
                    {isLast && remaining > 0 && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-white">+{remaining}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          <button type="button" onClick={() => setSheetPhotoUploadId(photoUpload.id)} className="self-start text-sm font-medium text-brand">
            Fotos hinzufügen
          </button>
        </div>
      ))}

      {sheetPhotoUploadId && (
        <PhotoUploadSheet
          photoUploadId={sheetPhotoUploadId}
          open={sheetPhotoUploadId !== null}
          onClose={() => setSheetPhotoUploadId(null)}
          onUploaded={() => {
            router.refresh();
            setSheetPhotoUploadId(null);
          }}
        />
      )}
    </div>
  );
}
```
Note `_count` is already scoped to `status: 'READY'` in the query written in Step 2 above — this bakes in, from the start, the fix the prior version of this feature needed a review round to arrive at (an unfiltered `_count.photos` inflates the "+N" overlay with invisible `PENDING`/`FAILED` photos).

- [ ] **Step 4: Verify live**

Open `/meine-feuerwehr` as a member of the Feuerwehr owning a fresh test `PhotoUpload` (`createdAt` within 24h) and confirm the block renders correctly with the right chip/time/description/uploader-name and the uploaded photo's thumbnail. Move `createdAt` to 25h ago via Prisma Studio, reload, confirm the whole block disappears with no placeholder. Confirm "Foto Upload"/"Alle Foto Uploads" render for every member (per the "any member" rule).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/page.tsx" src/components/photo-uploads/recent-photo-uploads-block.tsx
git commit -m "feat: rename 24h home screen block to Foto Uploads"
```

---

### Task 8: Cron-Aufräumung verwaister PENDING/UPLOADING-Fotos (umbenannt)

**Files:**
- Delete: `src/app/api/cron/incident-photo-cleanup/route.ts`
- Delete: `docker/incident-photo-cleanup.sh`
- Create: `src/app/api/cron/photo-cleanup/route.ts`
- Create: `docker/photo-cleanup.sh`
- Modify: `docker/README.md`
- Test: none — verified with a manually-inserted stale `PENDING`/`UPLOADING` row + `curl`

**Interfaces:**
- Consumes: `deletePhotoObjects` (Task 3), `prisma`.
- Produces: `GET /api/cron/photo-cleanup?secret=...` (already covered by `middleware.ts`'s existing `/api/cron` public prefix).

- [ ] **Step 1: Delete the old route and script**

```bash
rm -rf src/app/api/cron/incident-photo-cleanup
rm docker/incident-photo-cleanup.sh
```

- [ ] **Step 2: Write the new route**

`src/app/api/cron/photo-cleanup/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { deletePhotoObjects } from '@/lib/storage/photo-uploads-s3';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const providedSecret = new URL(request.url).searchParams.get('secret');
  const secret = process.env.CRON_SECRET;
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Erfasst PENDING (Upload nie zu Ende gebracht) UND UPLOADING (complete-Schritt abgestürzt,
  // bevor er den Status final auf READY/FAILED/zurück auf PENDING gesetzt hat - eine UPLOADING-Zeile
  // kann bereits eine oder beide Vorschauen erfolgreich hochgeladen haben, bevor sie abstürzte).
  const stale = await prisma.photo.findMany({
    where: { status: { in: ['PENDING', 'UPLOADING'] }, createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
    select: { id: true, storageKey: true, previewKey: true, thumbKey: true },
  });

  for (const photo of stale) {
    const keys = [photo.storageKey, photo.previewKey, photo.thumbKey].filter((key): key is string => key !== null);
    try {
      await deletePhotoObjects(keys);
    } catch {
      // Ein einzelnes S3-Löschen darf die DB-Aufräumung nicht blockieren.
    }
    await prisma.photo.delete({ where: { id: photo.id } });
  }

  return NextResponse.json({ ok: true, count: stale.length });
}
```

- [ ] **Step 3: Write the host wrapper script**

`docker/photo-cleanup.sh` (same shape as `facebook-fetch.sh`/the prior `incident-photo-cleanup.sh`):
```bash
#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

set -a
. "$REPO_ROOT/.env"
set +a

curl -fsS "${AUTH_URL}/api/cron/photo-cleanup?secret=${CRON_SECRET}"
echo
```
Track it executable:
```bash
git update-index --chmod=+x docker/photo-cleanup.sh
```
Confirm with `git ls-files -s docker/photo-cleanup.sh` that the mode shows `100755`.

- [ ] **Step 4: Update `docker/README.md`**

Find the existing section documenting the old cron job (search for `incident-photo-cleanup` or the heading covering "PENDING/UPLOADING-Einsatzfotos") and update its heading and script name to reference `photo-cleanup.sh`/`/api/cron/photo-cleanup` and "Foto Uploads" instead of "Einsatzfotos" — keep the same crontab schedule and explanatory format already established there. Leave the CORS documentation section (added earlier for this same bucket) completely untouched — it's bucket/infra-level, not incident-specific.

- [ ] **Step 5: Verify**

Insert a stale `PENDING` row and a stale `UPLOADING` row (both `createdAt` 25h ago, real-looking keys) directly via Prisma, call `curl ".../api/cron/photo-cleanup?secret=<CRON_SECRET>"`, confirm `count: 2` and both rows gone from the DB afterward. Confirm a wrong/missing secret returns `401`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/photo-cleanup docker/photo-cleanup.sh docker/README.md
git commit -m "feat: rename cron cleanup to photo-cleanup, cover UPLOADING status"
```

---

### Task 9: Foto Uploads-Liste (umbenannt)

**Files:**
- Create: `src/app/(app)/foto-uploads/page.tsx`
- Test: none — verified live in the browser

**Interfaces:**
- Consumes: `canViewPhotoUploadsFor`, `canManagePhotoUploadsFor` (Task 1).
- Produces: `/foto-uploads` list page — reverse-chronological list of every `PhotoUpload` belonging to the user's home Feuerwehr, each linking to its detail page, with a "+ Foto Upload" link for permitted users. This is also the page every "Abbrechen" link in Task 2's form and the post-delete redirects already point at.

- [ ] **Step 1: Write the list page**

`src/app/(app)/foto-uploads/page.tsx`:
```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewPhotoUploadsFor, canManagePhotoUploadsFor } from '@/lib/auth/permissions';
import { PHOTO_UPLOAD_KIND_LABELS } from '@/lib/validation/photo-upload.schema';

export default async function FotoUploadsListePage() {
  const user = await requireUser();
  if (!canViewPhotoUploadsFor(user, user.homeOrganizationId)) notFound();

  const photoUploads = await prisma.photoUpload.findMany({
    where: { fireDepartmentId: user.homeOrganizationId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { photos: { where: { status: 'READY' } } } } },
  });

  const canManage = canManagePhotoUploadsFor(user, user.homeOrganizationId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">Foto Uploads</h1>
        {canManage && (
          <Link href="/foto-uploads/neu" className="text-sm font-medium text-brand">
            + Foto Upload
          </Link>
        )}
      </div>

      {photoUploads.length === 0 ? (
        <p className="text-sm text-neutral-500">Noch keine Foto Uploads erfasst.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-lg bg-white shadow-sm">
          {photoUploads.map((photoUpload) => (
            <li key={photoUpload.id}>
              <Link href={`/foto-uploads/${photoUpload.id}`} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                    {PHOTO_UPLOAD_KIND_LABELS[photoUpload.kind]}
                  </span>
                  <div className="mt-1 truncate text-sm font-medium text-neutral-900">{photoUpload.description}</div>
                  <div className="text-xs text-neutral-500">{photoUpload.occurredOn.toLocaleDateString('de-AT')}</div>
                </div>
                <span className="flex-none text-xs text-neutral-500">
                  {photoUpload._count.photos} Foto{photoUpload._count.photos === 1 ? '' : 's'}
                </span>
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

Open `/foto-uploads` and confirm every test `PhotoUpload` from earlier tasks appears, most recent first, with the correct `READY`-only photo count, each linking correctly. Confirm a user from a different Feuerwehr gets `404`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/foto-uploads/page.tsx"
git commit -m "feat: add Foto Uploads Liste"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage**: every section of the revised spec (§2 Datenmodell, §3 Berechtigungen, §4 Objektspeicher unverändert, §5 Vordergrund-Upload, §6.1-6.4 Bildschirme, §6.5 Routen) maps to a task above. The three explicitly-confirmed chat decisions (jedes Mitglied darf anlegen, Migration ersetzen, `/foto-uploads/*` wörtlich) are baked into Tasks 1/1/2+throughout respectively.
- **Placeholder scan**: no task contains "TBD"/"handle appropriately" — every step has complete, concrete code, including the deliberately-documented boundary of the `beforeunload`/close-guard mechanism (a real, disclosed platform limitation, not an unresolved placeholder).
- **Type consistency**: `Photo.thumbKey` (not `thumbnailKey`) is used consistently across Task 1's schema, Task 3's storage-key builder, Task 4's download route, and Task 6/7's `<img>` src construction. `canDeletePhoto`'s signature matches between Task 1's definition and Task 6's gallery call site. `UploadItem`'s shape matches between Task 5's helper and its own sheet component (the only consumer). `PhotoUploadKind`/`PHOTO_UPLOAD_KIND_LABELS` match between Task 2's schema and Task 6/7/9's rendering call sites.
- **Known, deliberately deferred gap carried forward from the prior version's own final review**: none of the "Minor" findings from that review (progress-counter-counts-down cosmetics, `DeleteObjectsCommand` batch-size limit past ~333 photos on one Foto Upload, Next.js production error-message redaction) apply differently here than they did before — they're inherent to the same underlying S3/Next.js mechanics, not reintroduced bugs. Not re-litigated in this plan; flag them again only if the final review for *this* version resurfaces them.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-18-foto-uploads-vereinfachung-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
