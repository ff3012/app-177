# Tätigkeitsbericht (Berichte) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "Tätigkeitsbericht" activity-report feature in "Meine Feuerwehr": a 3-step wizard that
members fill out (standalone or auto-created from an ended vehicle reservation), producing a gap-free
per-Feuerwehr-per-year numbered submission with an A4 PDF matching the official NÖ-Landesfeuerwehrverband
paper form, emailed best-effort to admin-configured recipients.

**Architecture:** New Prisma models (`Report`, `ReportMember`, `ReportQuantity`, `ReportSequence`) plus
`Organization.reportRecipients`. A single source-of-truth constants file (`report-constants.ts`) drives the
wizard UI, the DB values, and the PDF layout so the three can never drift apart. Drafts autosave via a
debounced Server Action; submission is a single Prisma transaction that assigns the number/year, followed
by (outside the transaction) PDF generation, S3 upload, and a best-effort email. A new cron route creates
draft reports automatically when a vehicle reservation ends.

**Tech Stack:** Next.js App Router Server Actions, Prisma, `@react-pdf/renderer` (new dependency),
`@aws-sdk/client-s3` (existing dependency, new bucket), Mailjet v3.1 via the existing `sendEmail()` wrapper
(extended), Radix `Popover`+`cmdk` `Command` (existing `src/components/ui/*`, already used by
`org-search-select.tsx`).

## Global Constraints

- All new UI copy is German, matching the app's existing tone in `meine-feuerwehr/page.tsx` (plain
  hand-rolled Tailwind, `rounded-xl bg-white shadow-sm`/`bg-brand` — **not** the shadcn/Verwaltung style;
  only the two new member-picker components use Radix `Popover`+`Command`, per the design spec §6, mirroring
  `src/components/admin/org-search-select.tsx`).
- `ACTIVITY_KINDS`/`MATERIALS`/`EQUIPMENT`/`LOESCHER_CODES` in `src/lib/heimatfeuerwehr/report-constants.ts`
  are the **only** source for codes/labels — the wizard UI, `Report.activityKinds`/`ReportQuantity.code`
  storage, and the PDF must all import from this one file, never redeclare a code/label.
- Every Report write Server Action re-checks permissions itself (`canCreateReportFor`/`canViewReport`/
  `canManageHeimatfeuerwehrFor`, from `src/lib/auth/permissions.ts`) — never trust that a page-level check
  already ran, matching this codebase's standing convention.
- A `SUBMITTED` report is immutable: every write action (`updateReportDraft`, and any admin correction path)
  must reject when `report.status === 'SUBMITTED'`. There is no correction UI in this scope (design spec §11).
- `Report.number`/`Report.year` are assigned **only** at submission (`submitReport`), from `submittedAt`'s
  calendar year, never at draft creation and never from `startAt` — this is what keeps numbering gap-free
  across discarded drafts (design spec §3/§7).
- PDF generation, S3 upload, and email happen **after** the submission transaction commits, never inside it
  — those are not DB operations and must not hold the transaction open (design spec §7).
- The email send is best-effort: wrap it in try/catch, never let a Mailjet failure roll back or block a
  submission that already committed; write the outcome to `Report.emailSentAt`/`emailError` afterward.
- Reuse `NOT_DEACTIVATED_WHERE` (`src/lib/auth/user-status.ts`) everywhere a member picker is scoped to a
  Feuerwehr's roster (matches `heimatfeuerwehrPickerMembers`'s existing pattern).
- The new S3 bucket (`S3_REPORTS_BUCKET`) is **separate** from `S3_PHOTOS_BUCKET` and must never be touched
  by `photo-cleanup` or any other auto-delete logic — Tätigkeitsberichte are retained permanently.
- Every new Prisma model/enum is additive; no existing table's data is touched by this feature's migration.

---

### Task 1: Migration, Konstanten, Nummernvergabe, Mailjet-Erweiterung, Berechtigungen

**Files:**
- Modify: `prisma/schema.prisma` (add models/enums, add `Organization.reportRecipients`)
- Create: migration via `npm run db:migrate` (generated folder under `prisma/migrations/`)
- Create: `src/lib/heimatfeuerwehr/report-constants.ts`
- Create: `src/lib/heimatfeuerwehr/report-sequence.ts`
- Modify: `src/lib/email/mailjet.ts`
- Modify: `src/lib/auth/permissions.ts`
- Test: manual verification via `npx prisma studio` / a standalone script (no test suite in this repo)

**Interfaces:**
- Produces (for all later tasks): Prisma models `Report`, `ReportMember`, `ReportQuantity`,
  `ReportSequence`, enums `ReportType`, `ReportStatus`, `ReportMemberFunktion`, `ReportQuantityKind`;
  `Organization.reportRecipients: string[]`.
- Produces: `ACTIVITY_KINDS: ActivityKindOption[]`, `LOESCHER_CODES: string[]`, `MATERIALS: QuantityOption[]`,
  `EQUIPMENT: QuantityOption[]`, types `ActivityKindOption { code: string; label: string; group?:
  'FEUERWEHRJUGEND' }` and `QuantityOption { code: string; label: string; unit: 'LITER' | 'SAECKE' |
  'STUECK' | 'BETRIEBSSTUNDEN' }` (all from `report-constants.ts`).
- Produces: `getNextReportNumber(tx: Prisma.TransactionClient, fireDepartmentId: string, year: number):
  Promise<number>` (from `report-sequence.ts`) — must be called with the transaction client passed into
  `submitReport`'s `prisma.$transaction`, not the top-level `prisma` client.
- Produces: `sendEmail(params: SendEmailParams): Promise<void>` where `SendEmailParams` gains
  `replyTo?: string` and `attachments?: { filename: string; contentType: string; content: Buffer }[]`
  (both optional, backward compatible with every existing caller).
- Produces: `canCreateReportFor(user: SessionUser, organizationId: string): boolean`,
  `canViewReport(user: SessionUser, report: { createdById: string; filledById: string; fireDepartmentId:
  string; status: string }): boolean` (both in `src/lib/auth/permissions.ts`).

- [ ] **Step 1: Add the Prisma schema changes**

Append to `prisma/schema.prisma` (place near `Vehicle`/`VehicleBooking`, e.g. directly after the
`VehicleBooking` model closes):

```prisma
enum ReportType {
  ACTIVITY
  EXERCISE
  INCIDENT
}

enum ReportStatus {
  DRAFT
  SUBMITTED
}

enum ReportMemberFunktion {
  KOMMANDANT
  FAHRER
  MANNSCHAFT
}

enum ReportQuantityKind {
  MATERIAL
  EQUIPMENT
}

// Tätigkeitsbericht (und künftig Übungs-/Einsatzbericht, siehe `type`) - eine Feuerwehr-Aktivität, die ein
// Mitglied erfasst und (nach Prüfung serverseitig) abgibt. `number`/`year` sind bewusst nullable und werden
// erst bei der Abgabe vergeben (siehe submitReport, Task 7) - ein DRAFT hat noch keine Nummer, damit
// verworfene Entwürfe keine Lücken in der fortlaufenden Nummerierung reißen.
model Report {
  id               String       @id @default(cuid())
  number           Int?
  year             Int?
  type             ReportType
  status           ReportStatus @default(DRAFT)
  fireDepartmentId String
  fireDepartment   Organization @relation(fields: [fireDepartmentId], references: [id])

  vehicleBookingId String?         @unique
  vehicleBooking   VehicleBooking? @relation(fields: [vehicleBookingId], references: [id], onDelete: SetNull)

  filledById String
  filledBy   User   @relation("ReportFilledBy", fields: [filledById], references: [id])
  createdById String
  createdBy   User   @relation("ReportCreatedBy", fields: [createdById], references: [id])

  startAt DateTime
  endAt   DateTime

  ownActivity   Boolean?
  activityKinds String[]
  activityOther String?

  vehicleId String?
  vehicle   Vehicle? @relation(fields: [vehicleId], references: [id])
  vehicleKm Int?

  remark String?

  emailSentAt DateTime?
  emailError  String?

  submittedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  members   ReportMember[]
  materials ReportQuantity[]

  @@unique([fireDepartmentId, year, number])
  @@index([fireDepartmentId, status])
}

model ReportMember {
  id       String               @id @default(cuid())
  reportId String
  report   Report               @relation(fields: [reportId], references: [id], onDelete: Cascade)
  userId   String
  user     User                 @relation(fields: [userId], references: [id])
  funktion ReportMemberFunktion

  @@unique([reportId, userId])
}

model ReportQuantity {
  id       String             @id @default(cuid())
  reportId String
  report   Report             @relation(fields: [reportId], references: [id], onDelete: Cascade)
  kind     ReportQuantityKind
  code     String
  value    Decimal

  @@unique([reportId, kind, code])
}

// Zähler-Tabelle für die fortlaufende, lückenlose Nummerierung je Feuerwehr/Jahr - siehe
// report-sequence.ts. Postgres serialisiert konkurrierende upserts auf denselben Primärschlüssel
// automatisch, kein zusätzliches Row-Lock nötig.
model ReportSequence {
  fireDepartmentId String
  year             Int
  lastNumber       Int    @default(0)

  @@id([fireDepartmentId, year])
}
```

Then add these two relation fields to the existing `Vehicle` model (it needs the inverse side of
`Report.vehicleId`) and `VehicleBooking` model (inverse side of `Report.vehicleBookingId`):

In `model Vehicle { ... }`, add alongside the existing `bookings VehicleBooking[]` line:
```prisma
  reports  Report[]
```

In `model VehicleBooking { ... }`, add a new field (anywhere among its other relation fields):
```prisma
  report Report?
```

And add these two relation fields to the existing `model User { ... }` (alongside its other relation
arrays, e.g. near `createdPhotoUploads`/`uploadedPhotos`):
```prisma
  filledReports   Report[]       @relation("ReportFilledBy")
  createdReports  Report[]       @relation("ReportCreatedBy")
  reportMemberships ReportMember[]
```

Finally, add the new recipients column to `model Organization { ... }`, directly below the existing
`photoUploadNotificationEmails` field:
```prisma
  // Empfängeradressen für die Tätigkeitsbericht-E-Mail (Bericht-Brief.md §8) - gleiches Muster wie
  // photoUploadNotificationEmails/fahrzeugReservierungEmails: ein Array bereits aufgelöster E-Mail-Adressen,
  // keine Live-Referenz auf einen User.
  reportRecipients String[] @default([])
```

- [ ] **Step 2: Generate and apply the migration**

Run:
```bash
npm run db:migrate
```
When prompted for a migration name, use `taetigkeitsbericht`. This is a purely additive migration (new
tables, new enums, one new nullable-with-default array column) — no existing table's data changes, so no
backfill step is needed.

- [ ] **Step 3: Verify the migration and generated client**

Run:
```bash
npx prisma generate
npx tsc --noEmit
```
Expected: both succeed with no errors. Open `npx prisma studio` briefly and confirm the `Report`,
`ReportMember`, `ReportQuantity`, `ReportSequence` tables exist and `Organization` has a `reportRecipients`
column defaulting to `[]`.

- [ ] **Step 4: Create the constants file**

Create `src/lib/heimatfeuerwehr/report-constants.ts`:

```typescript
export interface ActivityKindOption {
  code: string;
  label: string;
  group?: 'FEUERWEHRJUGEND';
}

// Wortgetreu aus der offiziellen NÖ-Landesfeuerwehrverband-Papiervorlage extrahiert (siehe Design-Spec
// docs/superpowers/specs/2026-09-28-taetigkeitsbericht-design.md §1 Punkt 7 und §4) - 39 fixe Codes.
// "Sonstige" (Freitext -> Report.activityOther) ist bewusst NICHT Teil dieser Liste, eigener Mechanismus.
// Diese Datei ist die EINZIGE Quelle für Formular-UI, Speicherung und PDF-Ausdruck - nie hier abweichend
// redeklarieren.
export const ACTIVITY_KINDS: ActivityKindOption[] = [
  { code: 'ATEMSCHUTZ', label: 'Atemschutz' },
  { code: 'AUSBILDUNG', label: 'Ausbildung' },
  { code: 'AUSUEBUNG_DIENSTAUFSICHT', label: 'Ausübung der Dienstaufsicht' },
  { code: 'BERATUNG_BEHOERDEN', label: 'Beratung der Behörden' },
  { code: 'CHARGENSITZUNG', label: 'Chargensitzung' },
  { code: 'DIENSTBESPRECHUNG', label: 'Dienstbesprechung' },
  { code: 'EDV', label: 'EDV' },
  { code: 'FAHRZEUG_GERAETEDIENST_FAHRMEISTER', label: 'Fahrzeug u. Gerätedienst / Fahrmeister' },
  { code: 'FAHRZEUG_GERAETEDIENST_ZEUGMEISTER', label: 'Fahrzeug u. Gerätedienst / Zeugmeister' },
  { code: 'FEUERWEHRBALL', label: 'Feuerwehrball' },
  { code: 'FEUERWEHRFEST', label: 'Feuerwehrfest' },
  { code: 'FEUERWEHRMEDIZINISCHER_DIENST', label: 'Feuerwehrmedizinischer Dienst' },
  { code: 'FJ_ALLG_JUGENDARBEIT', label: 'Allg. Jugendarbeit', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_FACHLICHE_AUSBILDUNG', label: 'feuerwehrfachliche Ausbildung', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_EIGENE_VERANSTALTUNG', label: 'Eigene Veranstaltung', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_HAUS_DER_NOE_FJ', label: 'Haus der NÖ FJ', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_SELBST_VERANSTALTETE_LAGER', label: 'selbst veranstaltete Lager', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_BEZIRKS_ABSCHNITTSLAGERTEILNAHME', label: 'Bezirks/Abschnittslagerteilnahme', group: 'FEUERWEHRJUGEND' },
  { code: 'FJ_LANDESLAGERTEILNAHME', label: 'Landeslagerteilnahme', group: 'FEUERWEHRJUGEND' },
  { code: 'INSPEKTION', label: 'Inspektion' },
  { code: 'JOURNALDIENST', label: 'Journaldienst' },
  { code: 'KIRCHGANG', label: 'Kirchgang' },
  { code: 'KOMMANDOBESPRECHUNG', label: 'Kommandobesprechung' },
  { code: 'MITGLIEDERVERSAMMLUNG', label: 'Mitgliederversammlung' },
  { code: 'NACHRICHTENDIENST', label: 'Nachrichtendienst' },
  { code: 'OEFFENTLICHKEITSARBEIT_DOKUMENTATION', label: 'Öffentlichkeitsarbeit und Dokumentation' },
  { code: 'REPRAESENTATION', label: 'Repräsentation' },
  { code: 'SCHADSTOFFDIENST', label: 'Schadstoffdienst' },
  { code: 'SCHRIFTVERKEHR', label: 'Schriftverkehr' },
  { code: 'SONSTIGE_FEUERWEHRTAETIGKEITEN', label: 'sonstige Feuerwehrtätigkeiten' },
  { code: 'SPRENGDIENST', label: 'Sprengdienst' },
  { code: 'STRAHLENSCHUTZDIENST', label: 'Strahlenschutzdienst' },
  { code: 'TAETIGKEIT_IM_FEUERWEHRHAUS', label: 'Tätigkeit im Feuerwehrhaus' },
  { code: 'VERANSTALTUNGEN', label: 'Veranstaltungen' },
  { code: 'VERWALTUNGSTAETIGKEITEN', label: 'Verwaltungstätigkeiten' },
  { code: 'VORBEUGENDER_BRANDSCHUTZ', label: 'Vorbeugender Brandschutz' },
  { code: 'VORTRAEGE_SCHULUNGEN', label: 'Vorträge/Schulungen' },
  { code: 'WARTUNGSARBEITEN', label: 'Wartungsarbeiten' },
  { code: 'WASSERDIENST', label: 'Wasserdienst' },
];

export interface QuantityOption {
  code: string;
  label: string;
  unit: 'LITER' | 'SAECKE' | 'STUECK' | 'BETRIEBSSTUNDEN';
}

export const MATERIALS: QuantityOption[] = [
  { code: 'WASSER', label: 'Wasser', unit: 'LITER' },
  { code: 'SCHAUMMITTEL', label: 'Schaummittel', unit: 'LITER' },
  { code: 'BIOVERSAL', label: 'Bioversal', unit: 'LITER' },
  { code: 'OELBINDEMITTEL', label: 'Ölbindemittel', unit: 'SAECKE' },
  { code: 'PLANEN', label: 'Planen', unit: 'STUECK' },
  { code: 'NASSLOESCHER', label: 'Nasslöscher', unit: 'STUECK' },
  { code: 'SCHAUMLOESCHER', label: 'Schaumlöscher', unit: 'STUECK' },
  { code: 'PULVERLOESCHER', label: 'Pulverlöscher', unit: 'STUECK' },
  { code: 'CO2_LOESCHER', label: 'CO2 Löscher', unit: 'STUECK' },
];

// Die 4 Löscher-Codes werden im Formular (Task 5) als ein Chip "+ Löscher (4)" zusammengefasst, aber als 4
// einzelne ReportQuantity-Zeilen mit je eigenem Wert gespeichert.
export const LOESCHER_CODES = ['NASSLOESCHER', 'SCHAUMLOESCHER', 'PULVERLOESCHER', 'CO2_LOESCHER'];

export const EQUIPMENT: QuantityOption[] = [
  { code: 'ATEMSCHUTZGERAETE', label: 'Atemschutzgeräte', unit: 'STUECK' },
  { code: 'HYDR_RETTUNGSGERAET', label: 'Hydr. Rettungsgerät', unit: 'STUECK' },
  { code: 'STROMA_125KVA', label: 'STROMA-125kVA', unit: 'BETRIEBSSTUNDEN' },
  { code: 'STROMA_60KVA', label: 'STROMA-60kVA', unit: 'BETRIEBSSTUNDEN' },
  { code: 'SPA_200', label: 'SPA-200', unit: 'BETRIEBSSTUNDEN' },
];

export const FUNKTION_LABEL: Record<string, string> = {
  KOMMANDANT: 'Kommandant',
  FAHRER: 'Fahrer',
  MANNSCHAFT: 'Mannschaft',
};

export const REPORT_TYPE_LABEL: Record<string, string> = {
  ACTIVITY: 'Tätigkeitsbericht',
  EXERCISE: 'Übungsbericht',
  INCIDENT: 'Einsatzbericht',
};

// Nur ACTIVITY ist aktiv - die anderen beiden erscheinen im Berichtsart-Sheet (Task 3) ausgegraut mit
// "Bald verfügbar", reine UI-Sperre (das Datenmodell unterstützt alle drei Typen bereits).
export const ACTIVE_REPORT_TYPES: readonly string[] = ['ACTIVITY'];
```

- [ ] **Step 5: Create the numbering helper**

Create `src/lib/heimatfeuerwehr/report-sequence.ts`:

```typescript
import type { Prisma } from '@prisma/client';

/**
 * Vergibt die nächste fortlaufende Berichtsnummer für eine Feuerwehr/Jahr-Kombination - MUSS mit dem
 * Transaction-Client aus submitReports prisma.$transaction aufgerufen werden (Task 7), nicht mit dem
 * globalen prisma-Client, sonst ist die Atomarität nicht gegeben. Postgres serialisiert konkurrierende
 * upserts auf denselben Primärschlüssel automatisch (INSERT ... ON CONFLICT) - keine Lücken, keine
 * Duplikate, auch bei zwei gleichzeitigen Abgaben derselben Feuerwehr im selben Jahr.
 */
export async function getNextReportNumber(
  tx: Prisma.TransactionClient,
  fireDepartmentId: string,
  year: number,
): Promise<number> {
  const sequence = await tx.reportSequence.upsert({
    where: { fireDepartmentId_year: { fireDepartmentId, year } },
    create: { fireDepartmentId, year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return sequence.lastNumber;
}
```

- [ ] **Step 6: Extend `sendEmail()` with `replyTo`/`attachments`**

In `src/lib/email/mailjet.ts`, modify the `SendEmailParams` interface and the request body:

```typescript
interface SendEmailParams {
  to: string;
  toName?: string;
  cc?: string[];
  /** Neu für die Tätigkeitsbericht-E-Mail (Bericht-Brief.md §8): Antworten sollen beim Ausfüller landen,
   * nicht bei noreply@. Optional, da jeder bisherige Aufrufer ohne replyTo weiterhin exakt wie vorher
   * versendet. */
  replyTo?: string;
  /** Neu für die Tätigkeitsbericht-E-Mail: das erzeugte PDF als Anhang. Mailjet v3.1 erwartet den Inhalt
   * base64-kodiert im Feld Base64Content. */
  attachments?: { filename: string; contentType: string; content: Buffer }[];
  subject: string;
  textPart: string;
  htmlPart: string;
}
```

And in `sendEmail()`, extend the `Messages[0]` object (right after `HTMLPart`):

```typescript
          HTMLPart: wrapHtmlPart(params.htmlPart),
          ...(params.replyTo ? { ReplyTo: { Email: params.replyTo } } : {}),
          ...(params.attachments && params.attachments.length > 0
            ? {
                Attachments: params.attachments.map((attachment) => ({
                  ContentType: attachment.contentType,
                  Filename: attachment.filename,
                  Base64Content: attachment.content.toString('base64'),
                })),
              }
            : {}),
```

- [ ] **Step 7: Add the new permission functions**

In `src/lib/auth/permissions.ts`, add (near `canManageHeimatfeuerwehrFor`):

```typescript
/** Jedes Mitglied der eigenen Heimatfeuerwehr darf einen Bericht für diese Organisation anlegen -
 * Bericht-Brief.md §9: "Jedes Mitglied der Wehr kann Berichte anlegen." */
export function canCreateReportFor(user: SessionUser, organizationId: string): boolean {
  return user.homeOrganizationId === organizationId;
}

/**
 * Sichtbarkeit eines Berichts: ein DRAFT sehen Ersteller und Ausfüller; ein SUBMITTED zusätzlich der Admin
 * der Feuerwehr (Bericht-Brief.md §9). `report` ist bereits geladen (organizationId/status/createdById/
 * filledById), diese Funktion hat keinen DB-Zugriff.
 */
export function canViewReport(
  user: SessionUser,
  report: { createdById: string; filledById: string; fireDepartmentId: string; status: string },
): boolean {
  if (report.createdById === user.id || report.filledById === user.id) return true;
  return report.status === 'SUBMITTED' && canManageHeimatfeuerwehrFor(user, report.fireDepartmentId);
}
```

- [ ] **Step 8: Verify and commit**

Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: both succeed with no errors.

```bash
git add prisma/schema.prisma prisma/migrations src/lib/heimatfeuerwehr/report-constants.ts src/lib/heimatfeuerwehr/report-sequence.ts src/lib/email/mailjet.ts src/lib/auth/permissions.ts
git commit -m "feat: Tätigkeitsbericht Datenmodell, Konstanten, Nummernvergabe, Mailjet-Erweiterung"
```

---

### Task 2: MemberSearchSelect / MemberMultiSelect Komponenten

**Files:**
- Create: `src/components/heimatfeuerwehr/member-search-select.tsx`
- Create: `src/components/heimatfeuerwehr/member-multi-select.tsx`
- Test: manual (`npx tsc --noEmit`; no test suite in this repo)

**Interfaces:**
- Consumes: `src/components/ui/popover.tsx`, `src/components/ui/command.tsx` (already installed, used by
  `src/components/admin/org-search-select.tsx`, which this mirrors).
- Produces (for Task 3/5): `export interface ReportMemberOption { id: string; firstName: string; lastName:
  string }`; `MemberSearchSelect({ members: ReportMemberOption[]; value: string; onChange: (id: string) =>
  void; placeholder: string; id?: string })` (single-pick); `MemberMultiSelect({ members:
  ReportMemberOption[]; value: string[]; onChange: (ids: string[]) => void; placeholder: string })`
  (multi-pick, chip trigger).

- [ ] **Step 1: Create `MemberSearchSelect`**

Create `src/components/heimatfeuerwehr/member-search-select.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from '@/components/ui/command';

export interface ReportMemberOption {
  id: string;
  firstName: string;
  lastName: string;
}

function memberName(member: ReportMemberOption): string {
  return `${member.lastName} ${member.firstName}`;
}

/**
 * Einzelauswahl-Mitgliedersuche für "Ausfüller ändern" (Bericht-Brief.md §5 Schritt 1) - identisches
 * Popover+Command-Muster wie src/components/admin/org-search-select.tsx, aber über User statt
 * Organization, ohne Abschnitt-Gruppierung (eine Feuerwehr hat keine Unterebenen). Design-Spec §6
 * bestätigt diese neue Such-Combobox anstelle des einfacheren bestehenden <select>-Musters aus
 * booking-form.tsx.
 */
export function MemberSearchSelect({
  members,
  value,
  onChange,
  placeholder,
  id,
}: {
  members: ReportMemberOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = useMemo(() => members.find((member) => member.id === value), [members, value]);
  const filtered = useMemo(
    () => members.filter((member) => memberName(member).toLowerCase().includes(search.trim().toLowerCase())),
    [members, search],
  );

  function select(id: string) {
    onChange(id);
    setSearch('');
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className={`flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm transition-colors ${
            open ? 'border-2 border-brand px-[11px]' : 'border-neutral-300'
          }`}
        >
          <span className={selected ? 'text-[#1c1c1e]' : 'text-neutral-400'}>
            {selected ? memberName(selected) : placeholder}
          </span>
          <span className="flex-none text-neutral-400">{open ? '▴' : '▾'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-[220px] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Mitglied suchen …" value={search} onValueChange={setSearch} />
          <CommandList>
            {filtered.length === 0 && (
              <div className="py-4 text-center text-sm text-neutral-400">Keine Treffer.</div>
            )}
            <CommandGroup>
              {filtered.map((member) => (
                <CommandItem
                  key={member.id}
                  value={member.id}
                  onSelect={() => select(member.id)}
                  className={value === member.id ? 'bg-brand/10 data-[selected=true]:bg-brand/10' : ''}
                >
                  {memberName(member)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Create `MemberMultiSelect`**

Create `src/components/heimatfeuerwehr/member-multi-select.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from '@/components/ui/command';
import type { ReportMemberOption } from './member-search-select';

function memberName(member: ReportMemberOption): string {
  return `${member.lastName} ${member.firstName}`;
}

/**
 * Mehrfachauswahl-Mitgliedersuche für "+ Mitglied hinzufügen" (Bericht-Brief.md §5 Schritt 2) - gleiches
 * Popover+Command-Muster wie MemberSearchSelect, aber value/onChange als string[] statt string. Zeigt
 * bereits ausgewählte Mitglieder als abhakbare Zeilen (kein Entfernen hier - das übernimmt die
 * Mitgliederliste in Schritt 2 selbst, diese Komponente fügt nur hinzu).
 */
export function MemberMultiSelect({
  members,
  value,
  onChange,
  placeholder,
}: {
  members: ReportMemberOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const available = useMemo(() => members.filter((member) => !value.includes(member.id)), [members, value]);
  const filtered = useMemo(
    () => available.filter((member) => memberName(member).toLowerCase().includes(search.trim().toLowerCase())),
    [available, search],
  );

  function add(id: string) {
    onChange([...value, id]);
    setSearch('');
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 items-center gap-1.5 rounded-lg border border-dashed border-brand px-3 text-sm font-medium text-brand"
        >
          + {placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Mitglied suchen …" value={search} onValueChange={setSearch} />
          <CommandList>
            {filtered.length === 0 && (
              <div className="py-4 text-center text-sm text-neutral-400">Keine Treffer.</div>
            )}
            <CommandGroup>
              {filtered.map((member) => (
                <CommandItem key={member.id} value={member.id} onSelect={() => add(member.id)}>
                  {memberName(member)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Verify and commit**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors (these two files are not yet imported anywhere, so this only checks their own syntax).

```bash
git add src/components/heimatfeuerwehr/member-search-select.tsx src/components/heimatfeuerwehr/member-multi-select.tsx
git commit -m "feat: MemberSearchSelect/MemberMultiSelect Komponenten für Tätigkeitsbericht"
```

---

### Task 3: Entwurf-Lifecycle (createReportDraft/updateReportDraft) + Berichtsart-Sheet + Schritt 1

**Files:**
- Create: `src/app/(app)/meine-feuerwehr/berichte/actions.ts`
- Create: `src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.tsx`
- Create: `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-1/page.tsx`
- Create: `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-1/schritt-1-form.tsx`
- Create: `src/app/(app)/meine-feuerwehr/berichte/[reportId]/report-wizard-header.tsx`
- Create: `src/lib/heimatfeuerwehr/report-access.ts`
- Test: manual (`npx tsc --noEmit`, `npm run build`; no test suite in this repo)

**Interfaces:**
- Consumes: `MemberSearchSelect`/`ReportMemberOption` (Task 2); `ACTIVE_REPORT_TYPES`/`REPORT_TYPE_LABEL`
  (Task 1); `canCreateReportFor`/`canViewReport`/`assertPermission` (`src/lib/auth/permissions.ts`);
  `requireUser` (`src/lib/auth/session`); `NOT_DEACTIVATED_WHERE` (`src/lib/auth/user-status`).
- Produces (for Task 4/5/6/7): `createReportDraft(type: 'ACTIVITY' | 'EXERCISE' | 'INCIDENT'):
  Promise<never>` (Server Action, redirects to `/meine-feuerwehr/berichte/{id}/schritt-1` on success —
  never actually returns, matches this codebase's `redirect()`-inside-Server-Action convention).
- Produces: `export interface ReportDraftPatch { filledById?: string; startAt?: string; endAt?: string;
  ownActivity?: boolean; activityKinds?: string[]; activityOther?: string | null; vehicleId?: string | null;
  vehicleKm?: number | null; remark?: string }` and `updateReportDraft(reportId: string, patch:
  ReportDraftPatch): Promise<{ error?: string }>` (Server Action) in
  `src/app/(app)/meine-feuerwehr/berichte/actions.ts`.
- Produces: `loadReportForEdit(reportId: string): Promise<Report & { vehicleBooking: VehicleBooking | null }>`
  in `src/lib/heimatfeuerwehr/report-access.ts` — throws (via `assertPermission`) if the current user
  can't view it, or if `status === 'SUBMITTED'` when a write is attempted (write-checking is the caller's
  job via a second helper below).
- Produces: `assertReportIsEditable(report: { status: string }): void` (throws `ForbiddenError` if
  `status === 'SUBMITTED'`) in the same file, reused by Task 4/5/6's write actions.

- [ ] **Step 1: Create the report-access helper**

Create `src/lib/heimatfeuerwehr/report-access.ts`:

```typescript
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canViewReport, ForbiddenError } from '@/lib/auth/permissions';

/** Lädt einen Bericht samt verknüpfter Reservierung und prüft canViewReport - einzige Ladefunktion für
 * jede Formular-Schritt-Seite (Task 3/4/5), damit die Sichtbarkeitsregel nicht an mehreren Stellen
 * dupliziert wird. */
export async function loadReportForEdit(reportId: string) {
  const user = await requireUser();
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { vehicleBooking: true },
  });
  if (!report) {
    throw new ForbiddenError('Bericht wurde nicht gefunden.');
  }
  assertPermission(canViewReport(user, report));
  return report;
}

/** Jede Schreib-Server-Action auf einem Report muss dies zuerst aufrufen - ein abgegebener Bericht ist
 * nicht mehr bearbeitbar (Bericht-Brief.md §9). */
export function assertReportIsEditable(report: { status: string }): void {
  if (report.status === 'SUBMITTED') {
    throw new ForbiddenError('Dieser Bericht wurde bereits abgegeben und kann nicht mehr bearbeitet werden.');
  }
}
```

- [ ] **Step 2: Create `createReportDraft`/`updateReportDraft` Server Actions**

Create `src/app/(app)/meine-feuerwehr/berichte/actions.ts`:

```typescript
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import { loadReportForEdit, assertReportIsEditable } from '@/lib/heimatfeuerwehr/report-access';
import type { ReportType } from '@prisma/client';

/** Berichtsart-Sheet (Bericht-Brief.md §1b) -> "Neuer Bericht" ohne Reservierung. Legt sofort einen
 * leeren DRAFT an und leitet zu Schritt 1 weiter. Nur ACTIVITY ist heute wirklich anlegbar - die
 * UI-Sperre für EXERCISE/INCIDENT sitzt im Berichtsart-Sheet selbst (report-type-sheet.tsx), diese
 * Funktion erlaubt aber ausdrücklich alle drei type-Werte, damit das Datenmodell für später keine
 * Migration braucht. */
export async function createReportDraft(type: ReportType): Promise<never> {
  const user = await requireUser();
  assertPermission(canCreateReportFor(user, user.homeOrganizationId));

  const now = new Date();
  const report = await prisma.report.create({
    data: {
      type,
      fireDepartmentId: user.homeOrganizationId,
      filledById: user.id,
      createdById: user.id,
      startAt: now,
      endAt: now,
    },
  });

  redirect(`/meine-feuerwehr/berichte/${report.id}/schritt-1`);
}

export interface ReportDraftPatch {
  filledById?: string;
  startAt?: string;
  endAt?: string;
  ownActivity?: boolean;
  activityKinds?: string[];
  activityOther?: string | null;
  vehicleId?: string | null;
  vehicleKm?: number | null;
  remark?: string;
}

/** Debounced Autospeichern für jeden Formular-Schritt (Bericht-Brief.md §5: "Jede Änderung speichert den
 * Entwurf, kein eigener Speichern-Button") - ein einziger, generischer Patch-Endpunkt statt einer
 * Server Action pro Feld, da alle drei Schritte denselben Report bearbeiten. Nimmt nur die Felder an, die
 * sich geändert haben (partial patch), schreibt sie 1:1 durch. */
export async function updateReportDraft(
  reportId: string,
  patch: ReportDraftPatch,
): Promise<{ error?: string }> {
  const report = await loadReportForEdit(reportId);
  assertReportIsEditable(report);

  const data: Record<string, unknown> = {};
  if (patch.filledById !== undefined) data.filledById = patch.filledById;
  if (patch.startAt !== undefined) data.startAt = new Date(patch.startAt);
  if (patch.endAt !== undefined) data.endAt = new Date(patch.endAt);
  if (patch.ownActivity !== undefined) data.ownActivity = patch.ownActivity;
  if (patch.activityKinds !== undefined) data.activityKinds = patch.activityKinds;
  if (patch.activityOther !== undefined) data.activityOther = patch.activityOther;
  if (patch.vehicleId !== undefined) data.vehicleId = patch.vehicleId;
  if (patch.vehicleKm !== undefined) data.vehicleKm = patch.vehicleKm;
  if (patch.remark !== undefined) data.remark = patch.remark;

  if (data.startAt && data.endAt && data.endAt <= data.startAt) {
    return { error: 'Das Ende muss nach dem Beginn liegen.' };
  }

  await prisma.report.update({ where: { id: reportId }, data });
  revalidatePath(`/meine-feuerwehr/berichte/${reportId}`);
  return {};
}
```

- [ ] **Step 3: Create the Berichtsart-Sheet**

Create `src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { REPORT_TYPE_LABEL, ACTIVE_REPORT_TYPES } from '@/lib/heimatfeuerwehr/report-constants';
import { createReportDraft } from './actions';

const REPORT_TYPES = ['ACTIVITY', 'EXERCISE', 'INCIDENT'] as const;

/** Bericht-Brief.md §1b: "Welcher Bericht?" - öffnet bei jedem Einstieg (mit oder ohne Reservierung) vor
 * dem eigentlichen Formular. Nicht aktive Typen sind ausgegraut und nicht antippbar. */
export function ReportTypeSheet({ onClose }: { onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(type: (typeof REPORT_TYPES)[number]) {
    if (!ACTIVE_REPORT_TYPES.includes(type)) return;
    setError(null);
    startTransition(async () => {
      try {
        await createReportDraft(type);
      } catch {
        setError('Bericht konnte nicht angelegt werden.');
      }
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-8 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-4 text-[17px] font-semibold text-[#1c1c1e]">Welcher Bericht?</h2>
        <div className="flex flex-col gap-2">
          {REPORT_TYPES.map((type) => {
            const active = ACTIVE_REPORT_TYPES.includes(type);
            return (
              <button
                key={type}
                type="button"
                disabled={!active || pending}
                onClick={() => choose(type)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3.5 text-left text-[15px] font-medium ${
                  active
                    ? 'border-brand text-[#1c1c1e]'
                    : 'cursor-not-allowed border-neutral-200 text-neutral-400'
                }`}
              >
                <span>{REPORT_TYPE_LABEL[type]}</span>
                {!active && <span className="text-xs font-normal">Bald verfügbar</span>}
              </button>
            );
          })}
        </div>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the shared wizard header**

Create `src/app/(app)/meine-feuerwehr/berichte/[reportId]/report-wizard-header.tsx`:

```tsx
'use client';

import Link from 'next/link';

/** Kopfzeile für alle drei Formular-Schritte (Bericht-Brief.md §5): "‹ Zurück"/"‹ Abbrechen" +
 * dreiteiliger Fortschrittsbalken + "Schritt n von 3". `backHref` ist Schritt 1 -> zurück zur
 * Startseite ("Abbrechen"), Schritt 2/3 -> zurück zum vorherigen Schritt ("Zurück"). */
export function ReportWizardHeader({ step, backHref, backLabel }: { step: 1 | 2 | 3; backHref: string; backLabel: string }) {
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link href={backHref} className="text-sm font-medium text-brand">
          ‹ {backLabel}
        </Link>
        <span className="text-xs font-medium text-neutral-500">Schritt {step} von 3</span>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3].map((n) => (
          <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-brand' : 'bg-neutral-200'}`} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create the Schritt 1 page (Server Component)**

Create `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-1/page.tsx`:

```tsx
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { loadReportForEdit } from '@/lib/heimatfeuerwehr/report-access';
import { ReportWizardHeader } from '../report-wizard-header';
import { Schritt1Form } from './schritt-1-form';

// Zeigt "Zuletzt verwendet" (die 3 zuletzt vom Benutzer gewählten Tätigkeitsarten, Bericht-Brief.md §5) -
// über alle bereits ABGEGEBENEN eigenen Berichte hinweg, neueste zuerst, ohne Duplikate.
async function getRecentActivityKinds(userId: string): Promise<string[]> {
  const recent = await prisma.report.findMany({
    where: { filledById: userId, status: 'SUBMITTED' },
    orderBy: { submittedAt: 'desc' },
    take: 10,
    select: { activityKinds: true },
  });
  const seen = new Set<string>();
  for (const report of recent) {
    for (const code of report.activityKinds) {
      seen.add(code);
      if (seen.size >= 3) return [...seen];
    }
  }
  return [...seen];
}

export default async function ReportSchritt1Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const report = await loadReportForEdit(reportId);
  const user = await requireUser();

  const [members, recentActivityKinds] = await Promise.all([
    prisma.user.findMany({
      where: { homeOrganizationId: report.fireDepartmentId, ...NOT_DEACTIVATED_WHERE },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    }),
    getRecentActivityKinds(user.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <ReportWizardHeader step={1} backHref="/meine-feuerwehr" backLabel="Abbrechen" />
      <Schritt1Form
        report={{
          id: report.id,
          filledById: report.filledById,
          startAt: report.startAt.toISOString(),
          endAt: report.endAt.toISOString(),
          ownActivity: report.ownActivity,
          activityKinds: report.activityKinds,
          activityOther: report.activityOther,
        }}
        members={members}
        recentActivityKinds={recentActivityKinds}
        vehicleBooking={
          report.vehicleBooking
            ? { startsAt: report.vehicleBooking.startsAt.toISOString(), endsAt: report.vehicleBooking.endsAt.toISOString() }
            : null
        }
      />
    </div>
  );
}
```

- [ ] **Step 6: Create the Schritt 1 client form**

Create `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-1/schritt-1-form.tsx`. This wires
"Ausgefüllt von" (`MemberSearchSelect`), the Zeitraum date/time fields, the "Eigene Tätigkeit"
Ja/Nein segment, and the Tätigkeitsart chip list with a full-screen picker overlay
(`ActivityKindPicker`, built in Task 4) — debounced autosave via `updateReportDraft`, and the
"Reservierung: ..." deviation hint when `vehicleBooking` is set and the current values differ.

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MemberSearchSelect, type ReportMemberOption } from '@/components/heimatfeuerwehr/member-search-select';
import { ACTIVITY_KINDS } from '@/lib/heimatfeuerwehr/report-constants';
import { ActivityKindPicker } from './activity-kind-picker';
import { updateReportDraft } from '../../actions';

interface Schritt1ReportData {
  id: string;
  filledById: string;
  startAt: string;
  endAt: string;
  ownActivity: boolean | null;
  activityKinds: string[];
  activityOther: string | null;
}

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}
function toTimeInputValue(iso: string): string {
  return new Date(iso).toTimeString().slice(0, 5);
}
function combine(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

export function Schritt1Form({
  report,
  members,
  recentActivityKinds,
  vehicleBooking,
}: {
  report: Schritt1ReportData;
  members: ReportMemberOption[];
  recentActivityKinds: string[];
  vehicleBooking: { startsAt: string; endsAt: string } | null;
}) {
  const [filledById, setFilledById] = useState(report.filledById);
  const [startDate, setStartDate] = useState(toDateInputValue(report.startAt));
  const [startTime, setStartTime] = useState(toTimeInputValue(report.startAt));
  const [endDate, setEndDate] = useState(toDateInputValue(report.endAt));
  const [endTime, setEndTime] = useState(toTimeInputValue(report.endAt));
  const [ownActivity, setOwnActivity] = useState<boolean | null>(report.ownActivity);
  const [activityKinds, setActivityKinds] = useState<string[]>(report.activityKinds);
  const [activityOther, setActivityOther] = useState(report.activityOther ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      const result = await updateReportDraft(report.id, {
        filledById,
        startAt: combine(startDate, startTime),
        endAt: combine(endDate, endTime),
        ownActivity: ownActivity ?? undefined,
        activityKinds,
        activityOther: activityOther || null,
      });
      setSaving(false);
      setError(result.error ?? null);
    }, 500);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(scheduleSave, [filledById, startDate, startTime, endDate, endTime, ownActivity, activityKinds, activityOther]);

  const deviatesFromBooking =
    vehicleBooking !== null &&
    (combine(startDate, startTime) !== new Date(vehicleBooking.startsAt).toISOString() ||
      combine(endDate, endTime) !== new Date(vehicleBooking.endsAt).toISOString());

  function resetToBooking() {
    if (!vehicleBooking) return;
    setStartDate(toDateInputValue(vehicleBooking.startsAt));
    setStartTime(toTimeInputValue(vehicleBooking.startsAt));
    setEndDate(toDateInputValue(vehicleBooking.endsAt));
    setEndTime(toTimeInputValue(vehicleBooking.endsAt));
  }

  const canContinue = ownActivity !== null && (activityKinds.length > 0 || activityOther.trim().length > 0);

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">Ausgefüllt von</label>
        <MemberSearchSelect members={members} value={filledById} onChange={setFilledById} placeholder="Mitglied wählen" />
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Zeitraum</label>
        <div className="grid grid-cols-2 gap-3">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
        </div>
        {deviatesFromBooking && (
          <p className="mt-2 flex items-center gap-2 text-xs text-amber-700">
            Reservierung: {toTimeInputValue(vehicleBooking!.startsAt)}–{toTimeInputValue(vehicleBooking!.endsAt)}
            <button type="button" onClick={resetToBooking} className="font-medium underline">
              Zurücksetzen
            </button>
          </p>
        )}
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Eigene Tätigkeit</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setOwnActivity(true)}
            className={`h-10 rounded-lg text-sm font-semibold ${ownActivity === true ? 'bg-brand text-white' : 'border border-neutral-300 text-neutral-700'}`}
          >
            Ja
          </button>
          <button
            type="button"
            onClick={() => setOwnActivity(false)}
            className={`h-10 rounded-lg text-sm font-semibold ${ownActivity === false ? 'bg-brand text-white' : 'border border-neutral-300 text-neutral-700'}`}
          >
            Nein
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Tätigkeitsart</label>
        <div className="flex flex-wrap gap-2">
          {activityKinds.map((code) => (
            <span key={code} className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
              {ACTIVITY_KINDS.find((k) => k.code === code)?.label ?? code}
            </span>
          ))}
          {activityOther && <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">Sonstige: {activityOther}</span>}
          <button type="button" onClick={() => setPickerOpen(true)} className="rounded-full border border-dashed border-brand px-3 py-1 text-xs font-medium text-brand">
            + Tätigkeitsart wählen
          </button>
        </div>
      </div>

      {pickerOpen && (
        <ActivityKindPicker
          selected={activityKinds}
          activityOther={activityOther}
          recentActivityKinds={recentActivityKinds}
          onDone={(nextKinds, nextOther) => {
            setActivityKinds(nextKinds);
            setActivityOther(nextOther);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
      <p className="text-xs text-neutral-400">{saving ? 'Speichert …' : 'Gespeichert'}</p>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white p-4">
        <Link
          href={canContinue ? `/meine-feuerwehr/berichte/${report.id}/schritt-2` : '#'}
          aria-disabled={!canContinue}
          className={`flex h-[52px] w-full items-center justify-center rounded-lg text-[15px] font-semibold text-white ${
            canContinue ? 'bg-brand' : 'pointer-events-none bg-neutral-300'
          }`}
        >
          Weiter
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify**

Run:
```bash
npx tsc --noEmit
```
Expected: fails only on the missing `./activity-kind-picker` import (built in Task 4) — confirm the error
is exactly that missing module and nothing else in this task's own files.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(app\)/meine-feuerwehr/berichte src/lib/heimatfeuerwehr/report-access.ts
git commit -m "feat: Entwurf-Lifecycle, Berichtsart-Sheet und Formular-Schritt-1 für Tätigkeitsbericht"
```

---

### Task 4: Tätigkeitsart-Vollbildauswahl

**Files:**
- Create: `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-1/activity-kind-picker.tsx`
- Test: manual (`npx tsc --noEmit`, `npm run build`)

**Interfaces:**
- Consumes: `ACTIVITY_KINDS`, `ActivityKindOption` (Task 1, `report-constants.ts`).
- Produces: `ActivityKindPicker({ selected: string[]; activityOther: string; recentActivityKinds: string[];
  onDone: (nextSelected: string[], nextOther: string) => void; onClose: () => void })` — consumed by Task 3's
  `Schritt1Form` (already wired there).

- [ ] **Step 1: Create the full-screen picker**

Create `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-1/activity-kind-picker.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { ACTIVITY_KINDS, type ActivityKindOption } from '@/lib/heimatfeuerwehr/report-constants';

const SONSTIGE_CODE = '__SONSTIGE__';

/**
 * Vollbild-Auswahl der Tätigkeitsart (Bericht-Brief.md §5): Suchfeld, "Zuletzt verwendet" (max. 3),
 * darunter alle 39 Codes alphabetisch als Checkbox-Zeilen. Feuerwehrjugend ist eine reine
 * Gruppenüberschrift über ihren 7 Unterpunkten (kein eigener Checkbox-Eintrag, Design-Spec §1 Punkt 7).
 * "Sonstige" ist ein eigener Freitext-Eintrag, kein ACTIVITY_KINDS-Code - lokal via SONSTIGE_CODE
 * verwaltet, damit dieselbe Checkbox-Liste ihn wie jeden anderen Eintrag behandeln kann.
 */
export function ActivityKindPicker({
  selected,
  activityOther,
  recentActivityKinds,
  onDone,
  onClose,
}: {
  selected: string[];
  activityOther: string;
  recentActivityKinds: string[];
  onDone: (nextSelected: string[], nextOther: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState<string[]>(selected);
  const [localOther, setLocalOther] = useState(activityOther);
  const [otherChecked, setOtherChecked] = useState(activityOther.length > 0);

  const sortedAlphabetical = useMemo(
    () => [...ACTIVITY_KINDS].sort((a, b) => a.label.localeCompare(b.label, 'de')),
    [],
  );
  const filtered = useMemo(
    () => sortedAlphabetical.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase())),
    [sortedAlphabetical, search],
  );
  const recentOptions = useMemo(
    () => recentActivityKinds.map((code) => ACTIVITY_KINDS.find((option) => option.code === code)).filter((o): o is ActivityKindOption => Boolean(o)),
    [recentActivityKinds],
  );

  function toggle(code: string) {
    setLocalSelected((current) => (current.includes(code) ? current.filter((c) => c !== code) : [...current, code]));
  }

  const totalCount = localSelected.length + (otherChecked && localOther.trim() ? 1 : 0);

  function renderRow(option: ActivityKindOption) {
    const checked = localSelected.includes(option.code);
    return (
      <label key={option.code} className="flex min-h-[44px] items-center gap-3 border-b border-neutral-100 px-1 py-2">
        <input type="checkbox" checked={checked} onChange={() => toggle(option.code)} className="h-5 w-5 accent-brand" />
        <span className="text-sm text-[#1c1c1e]">{option.label}</span>
      </label>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 p-4">
        <button type="button" onClick={onClose} className="text-sm font-medium text-neutral-600">
          Abbrechen
        </button>
        <h2 className="text-[15px] font-semibold text-[#1c1c1e]">Tätigkeitsart</h2>
        <button
          type="button"
          onClick={() => onDone(localSelected, otherChecked ? localOther.trim() : '')}
          className="text-sm font-semibold text-brand"
        >
          Fertig · {totalCount}
        </button>
      </div>

      <div className="p-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suchen …"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {recentOptions.length > 0 && search.trim() === '' && (
          <div className="mb-3">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Zuletzt verwendet</h3>
            {recentOptions.map(renderRow)}
          </div>
        )}

        <label className="flex min-h-[44px] items-center gap-3 border-b border-neutral-100 px-1 py-2">
          <input type="checkbox" checked={otherChecked} onChange={(e) => setOtherChecked(e.target.checked)} className="h-5 w-5 accent-brand" />
          <span className="text-sm text-[#1c1c1e]">Sonstige</span>
        </label>
        {otherChecked && (
          <input
            type="text"
            value={localOther}
            onChange={(e) => setLocalOther(e.target.value)}
            placeholder="Freitext …"
            className="mb-2 mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        )}

        <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Alle Tätigkeitsarten</h3>
        {filtered.map(renderRow)}

        {search.trim() === '' && (
          <div className="mt-3">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Feuerwehrjugend</h3>
            <p className="mb-1 px-1 text-xs text-neutral-400">7 Unterpunkte ›</p>
            {ACTIVITY_KINDS.filter((option) => option.group === 'FEUERWEHRJUGEND').map(renderRow)}
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: `filtered` (the alphabetical "alle Tätigkeitsarten" list) already includes the `FEUERWEHRJUGEND`
group's 7 rows when the user searches for one by name (e.g. typing "Lager" must still find "selbst
veranstaltete Lager") — the dedicated "Feuerwehrjugend" section below it is only shown when `search` is
empty, matching the brief's "eigene Ebene" grouping for browsing while never hiding a match from search.

- [ ] **Step 2: Verify**

Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: both succeed with no errors now that Task 3's missing import is resolved.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-1/activity-kind-picker.tsx"
git commit -m "feat: Tätigkeitsart-Vollbildauswahl für Tätigkeitsbericht"
```

---

### Task 5: Formular Schritt 2 (Fahrzeug/Mitglieder) und Schritt 3 (Material/Geräte/Bemerkung)

**Files:**
- Create: `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-2/page.tsx`
- Create: `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-2/schritt-2-form.tsx`
- Create: `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-3/page.tsx`
- Create: `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-3/schritt-3-form.tsx`
- Modify: `src/app/(app)/meine-feuerwehr/berichte/actions.ts` (add member/quantity patch actions)
- Test: manual (`npx tsc --noEmit`, `npm run build`)

**Interfaces:**
- Consumes: `MemberMultiSelect`/`ReportMemberOption` (Task 2), `MATERIALS`/`EQUIPMENT`/`LOESCHER_CODES`/
  `FUNKTION_LABEL` (Task 1), `loadReportForEdit`/`assertReportIsEditable` (Task 3), `ReportWizardHeader`
  (Task 3).
- Produces: `export interface ReportMemberPatchEntry { userId: string; funktion: 'KOMMANDANT' | 'FAHRER' |
  'MANNSCHAFT' }` and `updateReportMembers(reportId: string, members: ReportMemberPatchEntry[]):
  Promise<{ error?: string }>` — full-replace of the report's `ReportMember` rows (delete all, recreate),
  in `actions.ts`.
- Produces: `export interface ReportQuantityPatchEntry { kind: 'MATERIAL' | 'EQUIPMENT'; code: string; value:
  number }` and `updateReportQuantities(reportId: string, quantities: ReportQuantityPatchEntry[]):
  Promise<{ error?: string }>` — full-replace of `ReportQuantity` rows for the given `kind`s present in the
  array (only rows with `value > 0` are kept), in `actions.ts`.
- Produces (used by Task 7): Schritt 2/3 write directly to `Report.vehicleId`/`vehicleKm` via the existing
  `updateReportDraft` (Task 3) and to `Report.remark` the same way.

- [ ] **Step 1: Add `updateReportMembers`/`updateReportQuantities` to `actions.ts`**

In `src/app/(app)/meine-feuerwehr/berichte/actions.ts`, append:

```typescript
export interface ReportMemberPatchEntry {
  userId: string;
  funktion: 'KOMMANDANT' | 'FAHRER' | 'MANNSCHAFT';
}

/** Schritt 2 "Eingesetzte Mitglieder" - vollständiger Ersatz der ReportMember-Zeilen bei jedem Speichern,
 * einfacher und race-sicherer als ein Diff gegen den vorherigen Stand (die Liste ist klein, typischerweise
 * < 10 Einträge). */
export async function updateReportMembers(
  reportId: string,
  members: ReportMemberPatchEntry[],
): Promise<{ error?: string }> {
  const report = await loadReportForEdit(reportId);
  assertReportIsEditable(report);

  await prisma.$transaction([
    prisma.reportMember.deleteMany({ where: { reportId } }),
    prisma.reportMember.createMany({
      data: members.map((member) => ({ reportId, userId: member.userId, funktion: member.funktion })),
    }),
  ]);
  revalidatePath(`/meine-feuerwehr/berichte/${reportId}`);
  return {};
}

export interface ReportQuantityPatchEntry {
  kind: 'MATERIAL' | 'EQUIPMENT';
  code: string;
  value: number;
}

/** Schritt 3 "Verbrauchsmaterial"/"Eingesetzte Geräte" - vollständiger Ersatz je Kind (MATERIAL/EQUIPMENT),
 * nur Zeilen mit value > 0 werden tatsächlich gespeichert (Bericht-Brief.md §5: "Nur befüllte Positionen"). */
export async function updateReportQuantities(
  reportId: string,
  quantities: ReportQuantityPatchEntry[],
): Promise<{ error?: string }> {
  const report = await loadReportForEdit(reportId);
  assertReportIsEditable(report);

  const kinds = [...new Set(quantities.map((q) => q.kind))];
  const toKeep = quantities.filter((q) => q.value > 0);

  await prisma.$transaction([
    prisma.reportQuantity.deleteMany({ where: { reportId, kind: { in: kinds } } }),
    prisma.reportQuantity.createMany({
      data: toKeep.map((q) => ({ reportId, kind: q.kind, code: q.code, value: q.value })),
    }),
  ]);
  revalidatePath(`/meine-feuerwehr/berichte/${reportId}`);
  return {};
}
```

- [ ] **Step 2: Create the Schritt 2 page**

Create `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-2/page.tsx`:

```tsx
import { prisma } from '@/lib/db/prisma';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { loadReportForEdit } from '@/lib/heimatfeuerwehr/report-access';
import { ReportWizardHeader } from '../report-wizard-header';
import { Schritt2Form } from './schritt-2-form';

export default async function ReportSchritt2Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const report = await loadReportForEdit(reportId);

  const [vehicles, members, existingMembers] = await Promise.all([
    prisma.vehicle.findMany({
      where: { organizationId: report.fireDepartmentId, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
    }),
    prisma.user.findMany({
      where: { homeOrganizationId: report.fireDepartmentId, ...NOT_DEACTIVATED_WHERE },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.reportMember.findMany({ where: { reportId }, select: { userId: true, funktion: true } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <ReportWizardHeader step={2} backHref={`/meine-feuerwehr/berichte/${reportId}/schritt-1`} backLabel="Zurück" />
      <Schritt2Form
        reportId={reportId}
        fromBooking={report.vehicleBookingId !== null}
        initialVehicleId={report.vehicleId}
        initialVehicleKm={report.vehicleKm}
        vehicles={vehicles}
        members={members}
        initialMembers={existingMembers.map((m) => ({ userId: m.userId, funktion: m.funktion }))}
        filledById={report.filledById}
      />
    </div>
  );
}
```

- [ ] **Step 3: Create the Schritt 2 client form**

Create `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-2/schritt-2-form.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MemberMultiSelect, type ReportMemberOption } from '@/components/heimatfeuerwehr/member-multi-select';
import { FUNKTION_LABEL } from '@/lib/heimatfeuerwehr/report-constants';
import { updateReportDraft, updateReportMembers, type ReportMemberPatchEntry } from '../../actions';

const FUNKTIONEN = ['KOMMANDANT', 'FAHRER', 'MANNSCHAFT'] as const;

export function Schritt2Form({
  reportId,
  fromBooking,
  initialVehicleId,
  initialVehicleKm,
  vehicles,
  members,
  initialMembers,
  filledById,
}: {
  reportId: string;
  fromBooking: boolean;
  initialVehicleId: string | null;
  initialVehicleKm: number | null;
  vehicles: { id: string; taktischeBezeichnung: string; kennzeichen: string }[];
  members: ReportMemberOption[];
  initialMembers: ReportMemberPatchEntry[];
  filledById: string;
}) {
  const [vehicleId, setVehicleId] = useState<string>(initialVehicleId ?? '');
  const [vehicleKm, setVehicleKm] = useState<string>(initialVehicleKm?.toString() ?? '');
  const [reportMembers, setReportMembers] = useState<ReportMemberPatchEntry[]>(
    initialMembers.length > 0 ? initialMembers : [{ userId: filledById, funktion: 'MANNSCHAFT' }],
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateReportDraft(reportId, {
        vehicleId: vehicleId || null,
        vehicleKm: vehicleId ? Number(vehicleKm) || null : null,
      });
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, vehicleKm]);

  useEffect(() => {
    const timeout = setTimeout(() => updateReportMembers(reportId, reportMembers), 500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportMembers]);

  function addMember(ids: string[]) {
    const newId = ids[ids.length - 1];
    setReportMembers((current) => [...current, { userId: newId, funktion: 'MANNSCHAFT' }]);
  }
  function removeMember(userId: string) {
    setReportMembers((current) => current.filter((m) => m.userId !== userId));
  }
  function setFunktion(userId: string, funktion: (typeof FUNKTIONEN)[number]) {
    setReportMembers((current) => current.map((m) => (m.userId === userId ? { ...m, funktion } : m)));
  }

  const canContinue = true;

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">Fahrzeug</label>
        <select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        >
          <option value="">Kein Fahrzeug</option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.taktischeBezeichnung} ({vehicle.kennzeichen})
            </option>
          ))}
        </select>
        {vehicleId && (
          <div className="mt-2">
            <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">km</label>
            <input
              type="number"
              inputMode="numeric"
              value={vehicleKm}
              onChange={(e) => setVehicleKm(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        )}
        {fromBooking && (
          <p className="mt-2 text-xs text-neutral-400">Aus der Reservierung übernommen, änderbar.</p>
        )}
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Eingesetzte Mitglieder</label>
        <div className="flex flex-col gap-2">
          {reportMembers.map((entry) => {
            const member = members.find((m) => m.id === entry.userId);
            return (
              <div key={entry.userId} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-[#1c1c1e]">
                  {member ? `${member.lastName} ${member.firstName}` : entry.userId}
                </span>
                <select
                  value={entry.funktion}
                  onChange={(e) => setFunktion(entry.userId, e.target.value as (typeof FUNKTIONEN)[number])}
                  className="rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                >
                  {FUNKTIONEN.map((f) => (
                    <option key={f} value={f}>
                      {FUNKTION_LABEL[f]}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => removeMember(entry.userId)} className="text-red-700">
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-2">
          <MemberMultiSelect
            members={members.filter((m) => !reportMembers.some((entry) => entry.userId === m.id))}
            value={reportMembers.map((entry) => entry.userId)}
            onChange={addMember}
            placeholder="Mitglied hinzufügen"
          />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white p-4">
        <Link
          href={canContinue ? `/meine-feuerwehr/berichte/${reportId}/schritt-3` : '#'}
          className="flex h-[52px] w-full items-center justify-center rounded-lg bg-brand text-[15px] font-semibold text-white"
        >
          Weiter
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the Schritt 3 page**

Create `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-3/page.tsx`:

```tsx
import { prisma } from '@/lib/db/prisma';
import { loadReportForEdit } from '@/lib/heimatfeuerwehr/report-access';
import { ReportWizardHeader } from '../report-wizard-header';
import { Schritt3Form } from './schritt-3-form';

export default async function ReportSchritt3Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const report = await loadReportForEdit(reportId);
  const quantities = await prisma.reportQuantity.findMany({ where: { reportId } });

  return (
    <div className="flex flex-col gap-4">
      <ReportWizardHeader step={3} backHref={`/meine-feuerwehr/berichte/${reportId}/schritt-2`} backLabel="Zurück" />
      <Schritt3Form
        reportId={reportId}
        initialRemark={report.remark ?? ''}
        initialQuantities={quantities.map((q) => ({ kind: q.kind, code: q.code, value: Number(q.value) }))}
      />
    </div>
  );
}
```

- [ ] **Step 5: Create the Schritt 3 client form**

Create `src/app/(app)/meine-feuerwehr/berichte/[reportId]/schritt-3/schritt-3-form.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MATERIALS, EQUIPMENT, LOESCHER_CODES } from '@/lib/heimatfeuerwehr/report-constants';
import { updateReportDraft, updateReportQuantities, type ReportQuantityPatchEntry } from '../../actions';
import { submitReport } from '../../submit-actions';

function useQuantityMap(initial: ReportQuantityPatchEntry[]) {
  const map: Record<string, number> = {};
  for (const entry of initial) map[`${entry.kind}:${entry.code}`] = entry.value;
  return map;
}

export function Schritt3Form({
  reportId,
  initialRemark,
  initialQuantities,
}: {
  reportId: string;
  initialRemark: string;
  initialQuantities: ReportQuantityPatchEntry[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, number>>(useQuantityMap(initialQuantities));
  const [visible, setVisible] = useState<Set<string>>(new Set(Object.keys(useQuantityMap(initialQuantities))));
  const [showLoescher, setShowLoescher] = useState(LOESCHER_CODES.some((code) => `MATERIAL:${code}` in useQuantityMap(initialQuantities)));
  const [remark, setRemark] = useState(initialRemark);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setValue(kind: 'MATERIAL' | 'EQUIPMENT', code: string, value: number) {
    setValues((current) => ({ ...current, [`${kind}:${code}`]: value }));
  }
  function reveal(kind: 'MATERIAL' | 'EQUIPMENT', code: string) {
    setVisible((current) => new Set(current).add(`${kind}:${code}`));
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const quantities: ReportQuantityPatchEntry[] = Object.entries(values)
        .filter(([key]) => visible.has(key))
        .map(([key, value]) => {
          const [kind, code] = key.split(':') as ['MATERIAL' | 'EQUIPMENT', string];
          return { kind, code, value };
        });
      updateReportQuantities(reportId, quantities);
      updateReportDraft(reportId, { remark });
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, visible, remark]);

  const nonLoescherMaterials = MATERIALS.filter((m) => !LOESCHER_CODES.includes(m.code));
  const loescherMaterials = MATERIALS.filter((m) => LOESCHER_CODES.includes(m.code));

  function renderRow(kind: 'MATERIAL' | 'EQUIPMENT', option: { code: string; label: string; unit: string }) {
    const key = `${kind}:${option.code}`;
    if (!visible.has(key)) {
      return (
        <button
          key={option.code}
          type="button"
          onClick={() => reveal(kind, option.code)}
          className="rounded-full border border-dashed border-brand px-3 py-1 text-xs font-medium text-brand"
        >
          + {option.label}
        </button>
      );
    }
    return (
      <div key={option.code} className="flex items-center justify-between gap-2 border-b border-neutral-100 py-2">
        <span className="text-sm text-[#1c1c1e]">
          {option.label} <span className="text-xs text-neutral-400">({option.unit === 'LITER' ? 'Liter' : option.unit === 'SAECKE' ? 'Säcke' : option.unit === 'STUECK' ? 'Stk.' : 'Betriebsstunden'})</span>
        </span>
        <input
          type="number"
          inputMode={option.unit === 'LITER' || option.unit === 'BETRIEBSSTUNDEN' ? 'decimal' : 'numeric'}
          step={option.unit === 'LITER' || option.unit === 'BETRIEBSSTUNDEN' ? '0.1' : '1'}
          value={values[key] ?? ''}
          onChange={(e) => setValue(kind, option.code, Number(e.target.value))}
          className="w-24 rounded-lg border border-neutral-300 px-2 py-1 text-right text-sm"
        />
      </div>
    );
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const result = await submitReport(reportId);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
    } else {
      router.push(`/meine-feuerwehr/berichte/${reportId}/abgeschlossen`);
    }
  }

  const canSubmit = remark.trim().length > 0;

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Verbrauchsmaterial</label>
        <div className="flex flex-col gap-1">{nonLoescherMaterials.map((m) => renderRow('MATERIAL', m))}</div>
        {!showLoescher ? (
          <button type="button" onClick={() => setShowLoescher(true)} className="mt-2 rounded-full border border-dashed border-brand px-3 py-1 text-xs font-medium text-brand">
            + Löscher (4)
          </button>
        ) : (
          <div className="mt-2 flex flex-col gap-1">{loescherMaterials.map((m) => renderRow('MATERIAL', m))}</div>
        )}
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Eingesetzte Geräte</label>
        <div className="flex flex-col gap-1">{EQUIPMENT.map((e) => renderRow('EQUIPMENT', e))}</div>
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Bemerkung</label>
        <textarea
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white p-4">
        <button
          type="button"
          disabled={!canSubmit || submitting}
          onClick={handleSubmit}
          className={`flex h-[52px] w-full items-center justify-center rounded-lg text-[15px] font-semibold text-white ${
            canSubmit && !submitting ? 'bg-brand' : 'bg-neutral-300'
          }`}
        >
          {submitting ? 'Wird abgegeben …' : 'Bericht abgeben'}
        </button>
      </div>
    </div>
  );
}
```

Note: `submitReport` is imported from a sibling `submit-actions.ts` module built in Task 7 — this task's
own `npx tsc --noEmit` check (Step 6 below) is expected to fail only on that one missing import, matching
the same pattern as Task 3/Task 4's handoff.

- [ ] **Step 6: Verify**

Run:
```bash
npx tsc --noEmit
```
Expected: fails only on the missing `../../submit-actions` import — confirm no other error in this task's
files.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/berichte"
git commit -m "feat: Formular Schritt 2 (Fahrzeug/Mitglieder) und Schritt 3 (Material/Geräte/Bemerkung)"
```

---

### Task 6: Cron-Auslöser bei Reservierungsende

**Files:**
- Create: `src/app/api/cron/report-drafts/route.ts`
- Modify: `docker/README.md` (document the new cron script, matching every other `/api/cron/*` entry)
- Test: manual (`npx tsc --noEmit`; hit the route directly with `curl` against local dev + `CRON_SECRET`)

**Interfaces:**
- Consumes: `Report`/`VehicleBooking` (Prisma), no new lib function needed — the whole logic fits in the
  route handler, mirroring `src/app/api/cron/atemschutz-warnung/route.ts`'s thin-wrapper shape.

- [ ] **Step 1: Create the cron route**

Create `src/app/api/cron/report-drafts/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

/** Bericht-Brief.md §3 Einstieg A: "Endet eine Reservierung, wird automatisch ein Report(DRAFT,
 * reservationId) angelegt." Design-Spec §1 Punkt 3 legt den Mechanismus fest: ein periodischer Cron
 * (alle ~15 Min, gleiches Secret-Muster wie /api/cron/atemschutz-warnung), keine Auslösung bei
 * Seitenaufruf. Findet jede GENEHMIGT-Reservierung, deren Ende bereits vergangen ist und die noch
 * keinen verknüpften Report hat (Report.vehicleBookingId ist @unique, daher reicht `report: null`). */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const providedSecret = new URL(request.url).searchParams.get('secret');
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const endedBookings = await prisma.vehicleBooking.findMany({
    where: { status: 'GENEHMIGT', endsAt: { lt: now }, report: null },
    include: { vehicle: { select: { organizationId: true } } },
  });

  let created = 0;
  for (const booking of endedBookings) {
    await prisma.report.create({
      data: {
        type: 'ACTIVITY',
        fireDepartmentId: booking.vehicle.organizationId,
        vehicleBookingId: booking.id,
        filledById: booking.userId,
        createdById: booking.userId,
        startAt: booking.startsAt,
        endAt: booking.endsAt,
        vehicleId: booking.vehicleId,
      },
    });
    created += 1;
  }

  return NextResponse.json({ ok: true, created, checkedAt: now.toISOString() });
}
```

- [ ] **Step 2: Document the cron in `docker/README.md`**

Read `docker/README.md`'s existing cron section (the entries for `atemschutz-warnung-email.sh`/
`send-scheduled-news.sh`) and add one new entry in the same table/list shape, e.g.:

```
*/15 * * * * curl -fsS "https://<domain>/api/cron/report-drafts?secret=$CRON_SECRET" >> /var/log/report-drafts.log 2>&1
```

with a one-line description: "Legt automatisch einen Tätigkeitsbericht-Entwurf an, sobald eine genehmigte
Fahrzeug-Reservierung endet (alle 15 Minuten)."

- [ ] **Step 3: Verify locally**

Start the dev server (`npm run dev`), then with a `CRON_SECRET` set in `.env`:
```bash
curl "http://localhost:3000/api/cron/report-drafts?secret=<your-local-CRON_SECRET>"
```
Expected: `{"ok":true,"created":0,"checkedAt":"..."}` against a fresh dev DB with no ended, un-reported
bookings. To verify the actual creation logic, insert a `GENEHMIGT` `VehicleBooking` with `endsAt` in the
past directly via `npx prisma studio`, re-run the curl command, and confirm exactly one `Report` row now
exists with `vehicleBookingId` pointing at it and `status: 'DRAFT'`. Delete the test rows afterward.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/report-drafts/route.ts docker/README.md
git commit -m "feat: Cron-Auslöser legt Tätigkeitsbericht-Entwurf bei Reservierungsende an"
```

---

### Task 7: Abgabe-Transaktion (submitReport, Nummernvergabe)

**Files:**
- Create: `src/app/(app)/meine-feuerwehr/berichte/submit-actions.ts`
- Create: `src/app/(app)/meine-feuerwehr/berichte/[reportId]/abgeschlossen/page.tsx`
- Test: manual (`npx tsc --noEmit`, `npm run build`, a standalone script exercising `submitReport` against
  the local dev DB)

**Interfaces:**
- Consumes: `getNextReportNumber` (Task 1), `loadReportForEdit`/`assertReportIsEditable` (Task 3),
  `canManageHeimatfeuerwehrFor` is NOT used here (submission is by the filler/creator, not an admin action).
- Produces: `submitReport(reportId: string): Promise<{ error?: string }>` — on success, the caller (Task
  5's `Schritt3Form`) navigates to `/meine-feuerwehr/berichte/{id}/abgeschlossen`. Does **not** call PDF
  generation or email itself — Task 9 wires those in as the final step of this same function, added there
  as a small, additive follow-up call (documented in Task 9's brief) rather than duplicated here, since
  neither the PDF generator nor the S3 client exist yet at this point in the plan.

- [ ] **Step 1: Create `submitReport`**

Create `src/app/(app)/meine-feuerwehr/berichte/submit-actions.ts`:

```typescript
'use server';

import { prisma } from '@/lib/db/prisma';
import { loadReportForEdit, assertReportIsEditable } from '@/lib/heimatfeuerwehr/report-access';
import { getNextReportNumber } from '@/lib/heimatfeuerwehr/report-sequence';

/**
 * Abgabe-Transaktion (Bericht-Brief.md §6, Design-Spec §7): serverseitige Pflichtfeldprüfung, dann
 * Nummer/Jahr vergeben und status auf SUBMITTED setzen - alles in einer prisma.$transaction, damit ein
 * gleichzeitiger zweiter Abgabe-Versuch derselben Feuerwehr/desselben Jahres nie zwei Berichte mit
 * derselben Nummer erzeugen kann. PDF-Erzeugung/S3-Upload/E-Mail passieren NICHT hier (siehe Task 9) -
 * das sind keine DB-Operationen und dürfen die Transaktion nicht offen halten.
 */
export async function submitReport(reportId: string): Promise<{ error?: string }> {
  const report = await loadReportForEdit(reportId);
  assertReportIsEditable(report);

  if (report.ownActivity === null) {
    return { error: '"Eigene Tätigkeit" muss angegeben werden.' };
  }
  if (report.activityKinds.length === 0 && !report.activityOther?.trim()) {
    return { error: 'Mindestens eine Tätigkeitsart oder "Sonstige" muss angegeben werden.' };
  }
  if (!report.remark?.trim()) {
    return { error: 'Eine Bemerkung ist erforderlich.' };
  }
  if (report.vehicleId !== null && report.vehicleKm === null) {
    return { error: 'Bitte die gefahrenen Kilometer angeben.' };
  }

  const now = new Date();
  const year = now.getFullYear();

  await prisma.$transaction(async (tx) => {
    const number = await getNextReportNumber(tx, report.fireDepartmentId, year);
    await tx.report.update({
      where: { id: reportId },
      data: { number, year, status: 'SUBMITTED', submittedAt: now },
    });
  });

  return {};
}
```

- [ ] **Step 2: Create the confirmation page**

Create `src/app/(app)/meine-feuerwehr/berichte/[reportId]/abgeschlossen/page.tsx`:

```tsx
import Link from 'next/link';
import { loadReportForEdit } from '@/lib/heimatfeuerwehr/report-access';
import { REPORT_TYPE_LABEL } from '@/lib/heimatfeuerwehr/report-constants';

export default async function ReportAbgeschlossenPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const report = await loadReportForEdit(reportId);

  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <h1 className="text-[22px] font-bold text-[#1c1c1e]">Bericht abgegeben</h1>
      <p className="text-sm text-neutral-500">
        {REPORT_TYPE_LABEL[report.type]} Nr. {report.number} / {report.year}
      </p>
      <Link href="/meine-feuerwehr" className="mt-4 rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white">
        Zur Startseite
      </Link>
    </div>
  );
}
```

Note: a "PDF öffnen" link is intentionally not included yet — the PDF only exists once Task 8/9 wire in
generation/storage; this page is revisited implicitly by Task 9 when it becomes possible to link to the
stored file (no separate task step needed — the confirmation page's own content is static text plus a
static link, and Task 9's brief will note the one-line addition of a download link once
`report.pdfStorageKey`-equivalent data exists — see Task 9 Step 3).

- [ ] **Step 3: Verify**

Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: both succeed with no errors — every import this task's files need already exists (Tasks 1/3).

Write a standalone script (in the scratchpad directory, not committed) that calls `submitReport` twice in
parallel (`Promise.all`) against two freshly-created, fully-filled-in draft reports for the **same**
Feuerwehr and current year, and confirms the two resulting `number` values are consecutive and distinct
(e.g. 1 and 2, not both 1) — this is the concurrency guarantee `getNextReportNumber` is supposed to provide
per Task 1. Delete the test rows afterward.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/berichte"
git commit -m "feat: Abgabe-Transaktion mit Nummernvergabe für Tätigkeitsbericht"
```

---

### Task 8: PDF-Generierung (@react-pdf/renderer) + S3-Storage-Client

**Files:**
- Modify: `package.json` (add `@react-pdf/renderer`)
- Create: `src/lib/heimatfeuerwehr/report-pdf.tsx`
- Create: `src/lib/storage/report-pdf-s3.ts`
- Modify: `.env.example`, `docker/docker-compose.yml` (add `S3_REPORTS_BUCKET`, matching the root
  CLAUDE.md's explicit "any new application-read env var must be added to the `environment:` block, not
  just `.env.example`" rule)
- Test: manual (a standalone script that generates a PDF from a fixture `Report` and writes it to disk for
  visual inspection)

**Interfaces:**
- Produces: `export interface ReportForPdf { number: number; year: number; type: 'ACTIVITY' | 'EXERCISE' |
  'INCIDENT'; fireDepartmentName: string; filledByName: string; filledByStbNr: string | null; startAt: Date;
  endAt: Date; ownActivity: boolean; activityKinds: string[]; activityOther: string | null; vehicleLabel:
  string | null; vehicleKm: number | null; remark: string; members: { name: string; stbNr: string | null;
  funktion: string }[]; materials: { code: string; value: number }[]; equipment: { code: string; value:
  number }[] }` and `generateReportPdf(report: ReportForPdf): Promise<Buffer>` in `report-pdf.tsx`.
- Produces: `putReportPdf(storageKey: string, body: Buffer): Promise<void>` and
  `presignReportPdfDownload(storageKey: string): Promise<string>` in `report-pdf-s3.ts`, mirroring
  `photo-uploads-s3.ts`'s `putPreviewObject`/`presignPhotoDownload` shape exactly but against
  `S3_REPORTS_BUCKET`.

- [ ] **Step 1: Add the new dependency**

Run:
```bash
npm install @react-pdf/renderer
```
Confirm `package.json`'s `dependencies` now lists `@react-pdf/renderer`.

- [ ] **Step 2: Create the S3 storage client**

Create `src/lib/storage/report-pdf-s3.ts` (mirrors `photo-uploads-s3.ts`'s client-construction/region
derivation exactly, but a fully separate bucket — never touched by `photo-cleanup`):

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function regionFromEndpoint(endpointUrl: string): string {
  const match = endpointUrl.match(/^https?:\/\/sos-([^.]+)\.exo\.io/);
  return match?.[1] ?? 'us-east-1';
}

let cachedClient: S3Client | null = null;

function getReportPdfS3Client(): S3Client {
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

function getReportsBucket(): string {
  const bucket = process.env.S3_REPORTS_BUCKET;
  if (!bucket) throw new Error('S3_REPORTS_BUCKET ist nicht konfiguriert.');
  return bucket;
}

/** Tätigkeitsberichte sind offizielle Dokumente und werden DAUERHAFT aufbewahrt - bewusst ein eigener
 * Bucket (S3_REPORTS_BUCKET), niemals S3_PHOTOS_BUCKET, damit die 96-Stunden-Löschung des
 * photo-cleanup-Crons dieses Bucket niemals betreffen kann. */
export async function putReportPdf(storageKey: string, body: Buffer): Promise<void> {
  const client = getReportPdfS3Client();
  await client.send(
    new PutObjectCommand({ Bucket: getReportsBucket(), Key: storageKey, Body: body, ContentType: 'application/pdf' }),
  );
}

export async function presignReportPdfDownload(storageKey: string): Promise<string> {
  const client = getReportPdfS3Client();
  const command = new GetObjectCommand({ Bucket: getReportsBucket(), Key: storageKey });
  return getSignedUrl(client, command, { expiresIn: 60 });
}
```

- [ ] **Step 3: Create the PDF generator**

Create `src/lib/heimatfeuerwehr/report-pdf.tsx`:

```tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { ACTIVITY_KINDS, MATERIALS, EQUIPMENT, FUNKTION_LABEL, REPORT_TYPE_LABEL } from './report-constants';

export interface ReportForPdf {
  number: number;
  year: number;
  type: 'ACTIVITY' | 'EXERCISE' | 'INCIDENT';
  fireDepartmentName: string;
  filledByName: string;
  filledByStbNr: string | null;
  startAt: Date;
  endAt: Date;
  ownActivity: boolean;
  activityKinds: string[];
  activityOther: string | null;
  vehicleLabel: string | null;
  vehicleKm: number | null;
  remark: string;
  members: { name: string; stbNr: string | null; funktion: string }[];
  materials: { code: string; value: number }[];
  equipment: { code: string; value: number }[];
}

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: 'Helvetica' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 14, fontWeight: 700 },
  section: { marginBottom: 8 },
  sectionTitle: { fontSize: 10, fontWeight: 700, marginBottom: 3 },
  row: { flexDirection: 'row' },
  twoCol: { flexDirection: 'row', flexWrap: 'wrap' },
  kindItem: { width: '50%', flexDirection: 'row', marginBottom: 2 },
  checkbox: { width: 9, height: 9, borderWidth: 1, borderColor: '#000', marginRight: 4 },
  checkboxChecked: { backgroundColor: '#000' },
  table: { borderTopWidth: 1, borderColor: '#000' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#999', paddingVertical: 2 },
  tableCell: { flex: 1, paddingHorizontal: 2 },
  tableCellRight: { flex: 1, paddingHorizontal: 2, textAlign: 'right' },
  footer: { marginTop: 14, flexDirection: 'row', justifyContent: 'space-between' },
});

function formatDateTime(date: Date): string {
  return `${date.toLocaleDateString('de-AT')} ${date.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}`;
}

function ReportDocument({ report }: { report: ReportForPdf }) {
  const selectedKinds = new Set(report.activityKinds);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{REPORT_TYPE_LABEL[report.type].toUpperCase()}</Text>
          <Text>
            {report.fireDepartmentName} · Nr. {String(report.number).padStart(3, '0')} / {report.year}
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text>Von: {formatDateTime(report.startAt)}</Text>
            <Text style={{ marginLeft: 16 }}>Bis: {formatDateTime(report.endAt)}</Text>
          </View>
          <Text style={{ marginTop: 2 }}>
            Eigene Tätigkeit: {report.ownActivity ? '☒ Ja  ☐ Nein' : '☐ Ja  ☒ Nein'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tätigkeitsart</Text>
          <View style={styles.twoCol}>
            {ACTIVITY_KINDS.map((option) => {
              const checked = selectedKinds.has(option.code);
              return (
                <View key={option.code} style={styles.kindItem}>
                  <View style={[styles.checkbox, checked ? styles.checkboxChecked : {}]} />
                  <Text style={checked ? { fontWeight: 700 } : {}}>{option.label}</Text>
                </View>
              );
            })}
            <View style={styles.kindItem}>
              <View style={[styles.checkbox, report.activityOther ? styles.checkboxChecked : {}]} />
              <Text style={report.activityOther ? { fontWeight: 700 } : {}}>
                Sonstige{report.activityOther ? `: ${report.activityOther}` : ''}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bemerkung</Text>
          <Text>{report.remark}</Text>
        </View>

        <View style={styles.section}>
          <Text>
            Fahrzeug: {report.vehicleLabel ?? 'Kein Fahrzeug'}
            {report.vehicleKm !== null ? ` · ${report.vehicleKm} km` : ''}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Eingesetzte Mitglieder</Text>
          {report.members.map((member, index) => (
            <Text key={index}>
              {member.name} ({member.stbNr ?? '-'}) · {FUNKTION_LABEL[member.funktion] ?? member.funktion}
            </Text>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verbrauchsmaterial</Text>
          <View style={styles.table}>
            {MATERIALS.map((option) => {
              const value = report.materials.find((m) => m.code === option.code)?.value ?? 0;
              return (
                <View key={option.code} style={styles.tableRow}>
                  <Text style={styles.tableCell}>{option.label}</Text>
                  <Text style={styles.tableCellRight}>{value}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Eingesetzte Geräte</Text>
          <View style={styles.table}>
            {EQUIPMENT.map((option) => {
              const value = report.equipment.find((e) => e.code === option.code)?.value ?? 0;
              return (
                <View key={option.code} style={styles.tableRow}>
                  <Text style={styles.tableCell}>{option.label}</Text>
                  <Text style={styles.tableCellRight}>{value}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.footer}>
          <Text>
            Ausgefüllt: {report.filledByName} ({report.filledByStbNr ?? '-'}) · {formatDateTime(new Date())}
          </Text>
          <Text>Kommandant / Stellvertreter: ______________________</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function generateReportPdf(report: ReportForPdf): Promise<Buffer> {
  return renderToBuffer(<ReportDocument report={report} />);
}

export function reportPdfFileName(number: number, submittedAt: Date): string {
  const yyyymmdd = submittedAt.toISOString().slice(0, 10).replace(/-/g, '');
  return `Taetigkeitsbericht_${String(number).padStart(3, '0')}_${yyyymmdd}.pdf`;
}
```

Note: `ACTIVITY_KINDS`/`MATERIALS`/`EQUIPMENT` are printed in full (every entry, not just selected ones),
per the design spec §8 "nicht nur die gewählten"/"alle Zeilen" — confirmed by this file importing the
constants directly rather than any filtered subset.

- [ ] **Step 4: Add the new env var**

In `.env.example`, add next to the existing `S3_PHOTOS_BUCKET`/`S3_BACKUP_BUCKET` lines:
```
S3_REPORTS_BUCKET=
```

In `docker/docker-compose.yml`, add `S3_REPORTS_BUCKET: ${S3_REPORTS_BUCKET}` to the `app` service's
`environment:` block, directly beside the existing `S3_PHOTOS_BUCKET` entry — per the root CLAUDE.md's
explicit, twice-already-hit rule that a new application-read env var must be added to this block, not just
to `.env.example`.

- [ ] **Step 5: Verify**

Write a standalone script (scratchpad directory) that builds a fixture `ReportForPdf` object (a few
selected `activityKinds`, one material, one equipment row, two members) and calls `generateReportPdf`,
writing the result to a local `.pdf` file. Open it (e.g. via the Read tool, which can render PDFs) and
visually confirm: the title/Feuerwehr/number header, all activity kinds printed with the selected ones
bold/checked, the material/equipment tables showing all rows (zeros for unselected ones), and the
member/footer lines render correctly on one A4 page.

Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/heimatfeuerwehr/report-pdf.tsx src/lib/storage/report-pdf-s3.ts .env.example docker/docker-compose.yml
git commit -m "feat: PDF-Erzeugung und S3-Speicherung für Tätigkeitsbericht"
```

---

### Task 9: E-Mail-Versand verdrahten (best-effort) in submitReport

**Files:**
- Create: `src/lib/heimatfeuerwehr/notify-report-submitted.ts`
- Modify: `src/app/(app)/meine-feuerwehr/berichte/submit-actions.ts` (call PDF/S3/email after the
  transaction commits)
- Modify: `src/app/(app)/meine-feuerwehr/berichte/[reportId]/abgeschlossen/page.tsx` (add "Als PDF öffnen"
  link)
- Test: manual (a standalone script exercising the full `submitReport` path against the local dev DB,
  confirming `emailSentAt`/`emailError` and the S3 object; Mailjet itself need not be configured locally —
  a failure there must be caught and recorded, not thrown)

**Interfaces:**
- Consumes: `generateReportPdf`/`reportPdfFileName` (Task 8), `putReportPdf`/`presignReportPdfDownload`
  (Task 8), `sendEmail` with `replyTo`/`attachments` (Task 1).
- Produces: `sendReportSubmittedEmail(report: ReportForPdf & { fireDepartmentEmail: string[]; filledByEmail:
  string }, pdf: Buffer, storageKey: string): Promise<void>` in `notify-report-submitted.ts` — never
  throws (try/catch internally, matching every other notification in this codebase).

- [ ] **Step 1: Create the notification function**

Create `src/lib/heimatfeuerwehr/notify-report-submitted.ts`:

```typescript
import { sendEmail } from '@/lib/email/mailjet';
import { REPORT_TYPE_LABEL } from './report-constants';
import type { ReportForPdf } from './report-pdf';

export interface ReportSubmittedEmailContext extends ReportForPdf {
  fireDepartmentEmails: string[];
  filledByEmail: string;
}

/**
 * Bericht-Brief.md §8: Betreff/Text/Anhang. Best-effort, kein Retry (Design-Spec §1 Punkt 4) - sendet
 * einzeln an jeden konfigurierten Empfänger (gleiches "kein gemeinsames To/Cc"-Muster wie
 * notify-photo-upload.ts), Reply-To ist immer die E-Mail des Ausfüllers. Wirft nie - Aufrufer (submitReport,
 * Task 7/9) fängt trotzdem selbst try/catch ab und schreibt das Ergebnis in Report.emailSentAt/emailError.
 */
export async function sendReportSubmittedEmail(
  context: ReportSubmittedEmailContext,
  pdfBuffer: Buffer,
  pdfFileName: string,
): Promise<void> {
  if (context.fireDepartmentEmails.length === 0) return;

  const subjectVehiclePart = context.vehicleLabel ? ` · ${context.vehicleLabel}` : '';
  const subject = `${REPORT_TYPE_LABEL[context.type]} Nr. ${String(context.number).padStart(3, '0')} · ${context.startAt.toLocaleDateString('de-AT')}${subjectVehiclePart} · ${context.filledByName}`;

  const tableRows = [
    ['Ausgefüllt von', context.filledByName],
    ['Zeitraum', `${context.startAt.toLocaleString('de-AT')} – ${context.endAt.toLocaleString('de-AT')}`],
    ['Eigene Tätigkeit', context.ownActivity ? 'Ja' : 'Nein'],
    ['Tätigkeitsart', context.activityKinds.join(', ') || context.activityOther || '-'],
    ...(context.vehicleLabel ? [['Fahrzeug', `${context.vehicleLabel} (${context.vehicleKm ?? '-'} km)`]] : []),
    ['Mitglieder', context.members.map((m) => m.name).join(', ') || '-'],
    ['Bemerkung', context.remark],
  ];
  const textPart = tableRows.map(([label, value]) => `${label}: ${value}`).join('\n');
  const htmlPart = `<table>${tableRows.map(([label, value]) => `<tr><td><strong>${label}</strong></td><td>${value}</td></tr>`).join('')}</table>`;

  for (const recipient of context.fireDepartmentEmails) {
    try {
      await sendEmail({
        to: recipient,
        replyTo: context.filledByEmail,
        subject,
        textPart,
        htmlPart,
        attachments: [{ filename: pdfFileName, contentType: 'application/pdf', content: pdfBuffer }],
      });
    } catch (error) {
      console.error(`Tätigkeitsbericht-E-Mail an ${recipient} fehlgeschlagen:`, error);
    }
  }
}
```

- [ ] **Step 2: Wire PDF/S3/email into `submitReport`**

In `src/app/(app)/meine-feuerwehr/berichte/submit-actions.ts`, add the imports and extend the function
(everything after the `prisma.$transaction` call, replacing the previous bare `return {}`):

```typescript
import { prisma } from '@/lib/db/prisma';
import { loadReportForEdit, assertReportIsEditable } from '@/lib/heimatfeuerwehr/report-access';
import { getNextReportNumber } from '@/lib/heimatfeuerwehr/report-sequence';
import { generateReportPdf, reportPdfFileName, type ReportForPdf } from '@/lib/heimatfeuerwehr/report-pdf';
import { putReportPdf } from '@/lib/storage/report-pdf-s3';
import { sendReportSubmittedEmail } from '@/lib/heimatfeuerwehr/notify-report-submitted';

// ... (existing validation + transaction unchanged) ...

  await prisma.$transaction(async (tx) => {
    const number = await getNextReportNumber(tx, report.fireDepartmentId, year);
    await tx.report.update({
      where: { id: reportId },
      data: { number, year, status: 'SUBMITTED', submittedAt: now },
    });
  });

  // Ab hier: keine DB-Transaktion mehr offen. PDF/S3/E-Mail sind bewusst NICHT Teil der Transaktion
  // oben (Design-Spec §7) - ein Fehler hier darf die bereits abgegebene Nummer nie zurückrollen.
  const [fullReport, fireDepartment] = await Promise.all([
    prisma.report.findUniqueOrThrow({
      where: { id: reportId },
      include: {
        filledBy: { select: { firstName: true, lastName: true, stbNr: true, email: true } },
        vehicle: { select: { taktischeBezeichnung: true, kennzeichen: true } },
        members: { include: { user: { select: { firstName: true, lastName: true, stbNr: true } } } },
        materials: true,
      },
    }),
    prisma.organization.findUniqueOrThrow({
      where: { id: report.fireDepartmentId },
      select: { name: true, reportRecipients: true },
    }),
  ]);

  const pdfData: ReportForPdf = {
    number: fullReport.number!,
    year: fullReport.year!,
    type: fullReport.type,
    fireDepartmentName: fireDepartment.name,
    filledByName: `${fullReport.filledBy.firstName} ${fullReport.filledBy.lastName}`,
    filledByStbNr: fullReport.filledBy.stbNr,
    startAt: fullReport.startAt,
    endAt: fullReport.endAt,
    ownActivity: fullReport.ownActivity!,
    activityKinds: fullReport.activityKinds,
    activityOther: fullReport.activityOther,
    vehicleLabel: fullReport.vehicle ? `${fullReport.vehicle.taktischeBezeichnung} (${fullReport.vehicle.kennzeichen})` : null,
    vehicleKm: fullReport.vehicleKm,
    remark: fullReport.remark!,
    members: fullReport.members.map((m) => ({ name: `${m.user.firstName} ${m.user.lastName}`, stbNr: m.user.stbNr, funktion: m.funktion })),
    materials: fullReport.materials.filter((m) => m.kind === 'MATERIAL').map((m) => ({ code: m.code, value: Number(m.value) })),
    equipment: fullReport.materials.filter((m) => m.kind === 'EQUIPMENT').map((m) => ({ code: m.code, value: Number(m.value) })),
  };

  const pdfFileName = reportPdfFileName(pdfData.number, now);
  const storageKey = `${report.fireDepartmentId}/${pdfFileName}`;

  try {
    const pdfBuffer = await generateReportPdf(pdfData);
    await putReportPdf(storageKey, pdfBuffer);
    await sendReportSubmittedEmail(
      { ...pdfData, fireDepartmentEmails: fireDepartment.reportRecipients, filledByEmail: fullReport.filledBy.email },
      pdfBuffer,
      pdfFileName,
    );
    await prisma.report.update({ where: { id: reportId }, data: { emailSentAt: now, emailError: null } });
  } catch (error) {
    await prisma.report.update({
      where: { id: reportId },
      data: { emailError: error instanceof Error ? error.message : 'Unbekannter Fehler' },
    });
  }

  return {};
```

Note: `Report` does not yet store its own `storageKey` as a column — the design spec doesn't call for one,
and the admin page (Task 10) re-derives the same deterministic key
(`${fireDepartmentId}/${pdfFileName}`, where `pdfFileName` is computed from the report's own
`number`/`submittedAt`) rather than storing it redundantly. This is a deliberate, minimal choice consistent
with the spec's schema (§2) not listing a storage-key field.

- [ ] **Step 3: Add the PDF download link to the confirmation page**

In `src/app/(app)/meine-feuerwehr/berichte/[reportId]/abgeschlossen/page.tsx`, add an import of
`presignReportPdfDownload`/`reportPdfFileName` and a second link:

```tsx
import { presignReportPdfDownload } from '@/lib/storage/report-pdf-s3';
import { reportPdfFileName } from '@/lib/heimatfeuerwehr/report-pdf';

// inside the component, after loading `report`:
const pdfFileName = reportPdfFileName(report.number!, report.submittedAt!);
const pdfStorageKey = `${report.fireDepartmentId}/${pdfFileName}`;
const pdfUrl = await presignReportPdfDownload(pdfStorageKey);
```

and render a second link right below the existing "Zur Startseite" link:
```tsx
<a href={pdfUrl} className="rounded-lg border border-brand px-6 py-3 text-sm font-semibold text-brand">
  Als PDF öffnen
</a>
```

- [ ] **Step 4: Verify**

Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: both succeed with no errors.

Write a standalone script (scratchpad directory) that creates a fully-filled-in draft report for a real
seeded Feuerwehr/user, sets a `reportRecipients` test address on that organization, calls `submitReport`,
and confirms: the `Report` row now has `number`/`year`/`status: 'SUBMITTED'`; an object exists at the
expected `S3_REPORTS_BUCKET` key (or, if S3/Mailjet aren't configured in this dev environment, that
`emailError` is set to a caught error message rather than the script throwing uncaught). Delete test rows
and the S3 object afterward.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/berichte" src/lib/heimatfeuerwehr/notify-report-submitted.ts
git commit -m "feat: E-Mail-Versand (best-effort) nach Tätigkeitsbericht-Abgabe verdrahtet"
```

---

### Task 10: Verwaltung „Berichte" (Empfänger-Picker + Statusliste)

**Files:**
- Modify: `src/app/(app)/admin/heimatfeuerwehr/actions.ts` (add `setReportRecipients`)
- Modify: `src/app/(app)/admin/heimatfeuerwehr/page.tsx` (add the new card + submitted-reports query)
- Create: `src/app/(app)/admin/heimatfeuerwehr/report-recipients-form.tsx`
- Test: manual (`npx tsc --noEmit`, `npm run build`; visual check via dev server against a seeded org)

**Interfaces:**
- Consumes: `emailListSchema` (already defined in `admin/heimatfeuerwehr/actions.ts`, reused verbatim —
  same as `setFahrzeugReservierungEmails`/`setPhotoUploadNotificationEmails`), `canManageHeimatfeuerwehrFor`,
  `heimatfeuerwehrPickerMembers` (already queried in `page.tsx`), `presignReportPdfDownload`/
  `reportPdfFileName` (Task 8/9), `REPORT_TYPE_LABEL` (Task 1).

- [ ] **Step 1: Add `setReportRecipients` to `admin/heimatfeuerwehr/actions.ts`**

Append, directly mirroring `setPhotoUploadNotificationEmails` exactly (same file already read in full
during planning):

```typescript
export interface ReportRecipientsState {
  success?: boolean;
  error?: string;
}

/** Bericht-Brief.md §8: Empfänger der Tätigkeitsbericht-E-Mail - identisches Muster wie
 * setFahrzeugReservierungEmails/setPhotoUploadNotificationEmails. */
export async function setReportRecipients(
  organizationId: string,
  _prevState: ReportRecipientsState,
  formData: FormData,
): Promise<ReportRecipientsState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const parsed = emailListSchema.safeParse(formData.get('emails'));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { reportRecipients: [...new Set(parsed.data)] },
  });

  revalidatePath('/admin/heimatfeuerwehr');
  return { success: true };
}
```

- [ ] **Step 2: Create the recipients form component**

Create `src/app/(app)/admin/heimatfeuerwehr/report-recipients-form.tsx`, copying
`photo-upload-notification-emails-form.tsx`'s structure exactly (same chip-list + free-text-add +
member-select pattern), swapping in `setReportRecipients`:

```tsx
'use client';

import { useActionState, useEffect, useState } from 'react';
import { setReportRecipients, type ReportRecipientsState } from './actions';

const initialState: ReportRecipientsState = {};

export function ReportRecipientsForm({
  organizationId,
  initialEmails,
  members,
}: {
  organizationId: string;
  initialEmails: string[];
  members: { id: string; firstName: string; lastName: string; email: string }[];
}) {
  const boundAction = setReportRecipients.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [emails, setEmails] = useState<string[]>(initialEmails);
  const [newEmail, setNewEmail] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.success) setDirty(false);
  }, [state]);

  const saved = state.success && !dirty;

  function addEmail(email: string) {
    const trimmed = email.trim();
    if (!trimmed || emails.includes(trimmed)) return;
    setEmails((prev) => [...prev, trimmed]);
    setDirty(true);
  }

  function removeEmail(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email));
    setDirty(true);
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-3">
      <input type="hidden" name="emails" value={JSON.stringify(emails)} />

      {emails.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {emails.map((email) => (
            <span key={email} className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-3 py-1 text-sm text-ink">
              {email}
              <button type="button" onClick={() => removeEmail(email)} aria-label={`${email} entfernen`} className="text-ink-muted hover:text-danger">
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="newReportRecipientEmail" className="text-[13px] font-medium text-ink">
            E-Mail-Adresse hinzufügen
          </label>
          <div className="flex gap-2">
            <input
              id="newReportRecipientEmail"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="z. B. kommando@ff-wolfsgraben.at"
              className="flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
            />
            <button
              type="button"
              onClick={() => {
                addEmail(newEmail);
                setNewEmail('');
              }}
              className="rounded-md bg-neutral-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-600"
            >
              Hinzufügen
            </button>
          </div>
        </div>

        {members.length > 0 && (
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="reportRecipientPicker" className="text-[13px] font-medium text-ink">
              Aus Mitgliedern wählen
            </label>
            <select
              id="reportRecipientPicker"
              value=""
              onChange={(e) => {
                if (e.target.value) addEmail(e.target.value);
                e.target.value = '';
              }}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
            >
              <option value="">Mitglied auswählen…</option>
              {members.map((member) => (
                <option key={member.id} value={member.email}>
                  {member.lastName} {member.firstName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
            saved ? 'bg-success hover:opacity-90' : 'bg-brand hover:bg-brand-hover'
          }`}
        >
          {pending ? 'Speichern…' : saved ? 'Gespeichert' : 'Speichern'}
        </button>
        {state.error && <p className="text-xs text-danger">{state.error}</p>}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Wire the new card into `admin/heimatfeuerwehr/page.tsx`**

Add the import (alongside the existing `PhotoUploadNotificationEmailsForm` import):
```tsx
import { ReportRecipientsForm } from './report-recipients-form';
import { REPORT_TYPE_LABEL } from '@/lib/heimatfeuerwehr/report-constants';
import { reportPdfFileName } from '@/lib/heimatfeuerwehr/report-pdf';
```

Add a new query alongside the existing `heimatfeuerwehrPickerMembers`/`selectedOrgFull` queries (same
`selectedOrgId`-scoped pattern):
```tsx
  const recentReports = await prisma.report.findMany({
    where: { fireDepartmentId: selectedOrgId, status: 'SUBMITTED' },
    orderBy: { submittedAt: 'desc' },
    take: 20,
    include: { filledBy: { select: { firstName: true, lastName: true } } },
  });
```

Add the new card directly after the existing "Foto Upload Benachrichtigung" card (before "Kalender-Import
(ICS)"):
```tsx
      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Berichte</h2>
        <p className="mb-2 text-xs text-ink-faint">
          Tätigkeitsbericht: Aktiv · Übungsbericht: Nicht aktiv · Einsatzbericht: Nicht aktiv
        </p>
        <p className="mb-3 text-xs text-ink-faint">
          Diese Adressen erhalten eine E-Mail mit PDF-Anhang, sobald ein Tätigkeitsbericht abgegeben wird.
        </p>
        <ReportRecipientsForm
          key={selectedOrgId}
          organizationId={selectedOrgId}
          initialEmails={selectedOrgFull.reportRecipients}
          members={heimatfeuerwehrPickerMembers}
        />
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Nr.</TableHead>
              <TableHead>Art</TableHead>
              <TableHead>Ausgefüllt von</TableHead>
              <TableHead>Abgegeben am</TableHead>
              <TableHead>E-Mail</TableHead>
              <TableHead>PDF</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentReports.map((report) => {
              const pdfFileName = reportPdfFileName(report.number!, report.submittedAt!);
              return (
                <TableRow key={report.id}>
                  <TableCell>{report.number}/{report.year}</TableCell>
                  <TableCell>{REPORT_TYPE_LABEL[report.type]}</TableCell>
                  <TableCell>{report.filledBy.lastName} {report.filledBy.firstName}</TableCell>
                  <TableCell>{report.submittedAt?.toLocaleString('de-AT')}</TableCell>
                  <TableCell>{report.emailSentAt ? 'Gesendet' : report.emailError ? 'Fehlgeschlagen' : '–'}</TableCell>
                  <TableCell>
                    <a href={`/admin/heimatfeuerwehr/berichte/${report.id}/pdf`} className="text-brand hover:underline">
                      {pdfFileName}
                    </a>
                  </TableCell>
                </TableRow>
              );
            })}
            {recentReports.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-ink-muted">
                  Noch keine abgegebenen Berichte für diese Feuerwehr.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
```

This references a download route (`/admin/heimatfeuerwehr/berichte/[reportId]/pdf`) built in the next step
rather than a raw presigned URL rendered at page-render time — a presigned URL embedded directly in server
HTML would be a stale, non-expiring-looking link cached in the page; a thin redirect route re-signs on each
click instead, matching this codebase's existing "session-gated route calls presign only after its own
permission check" pattern (see `photo-uploads-s3.ts`'s own comment on `presignPhotoDownload`).

- [ ] **Step 4: Create the PDF download redirect route**

Create `src/app/(app)/admin/heimatfeuerwehr/berichte/[reportId]/pdf/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { presignReportPdfDownload } from '@/lib/storage/report-pdf-s3';
import { reportPdfFileName } from '@/lib/heimatfeuerwehr/report-pdf';

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const user = await requireUser();

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report || report.status !== 'SUBMITTED' || !report.number || !report.submittedAt) {
    return NextResponse.json({ error: 'Bericht nicht gefunden.' }, { status: 404 });
  }
  assertPermission(canManageHeimatfeuerwehrFor(user, report.fireDepartmentId));

  const pdfFileName = reportPdfFileName(report.number, report.submittedAt);
  const storageKey = `${report.fireDepartmentId}/${pdfFileName}`;
  const url = await presignReportPdfDownload(storageKey);
  return NextResponse.redirect(url);
}
```

- [ ] **Step 5: Verify**

Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: both succeed with no errors. Start the dev server and confirm the new "Berichte" card renders on
`/admin/heimatfeuerwehr` for a seeded org (empty list is fine if no reports have been submitted yet in this
dev DB).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/admin/heimatfeuerwehr"
git commit -m "feat: Verwaltung Berichte-Karte (Empfänger + Statusliste + PDF-Download)"
```

---

### Task 11: Startseite-Integration (Aktionsreihe, Zu erledigen, Meine Berichte)

**Files:**
- Modify: `src/app/(app)/meine-feuerwehr/page.tsx` (replace lines 357-369, add two new query blocks and two
  new rendered blocks)
- Test: manual (`npx tsc --noEmit`, `npm run build`; visual check via dev server)

**Interfaces:**
- Consumes: `Report` (Prisma), `REPORT_TYPE_LABEL` (Task 1), `createReportDraft`/`ReportTypeSheet` (Task 3).

- [ ] **Step 1: Replace the single "Foto Upload" button block**

In `src/app/(app)/meine-feuerwehr/page.tsx`, replace the existing block at lines 357-369 (the
`canManagePhotoUploadsFor` guarded single "Foto Upload" link) with the brief's 1:1 two-tile grid. First add
the import at the top of the file:
```tsx
import { ReportTypeSheet } from './berichte/report-type-sheet';
```

Since opening the Berichtsart-Sheet needs client-side `useState`, this whole block becomes a small client
component. Create `src/app/(app)/meine-feuerwehr/action-row.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ReportTypeSheet } from './berichte/report-type-sheet';

/** Bericht-Brief.md §4: Aktionsreihe ersetzt den bisherigen einzelnen Foto-Upload-Button - zwei gleich
 * große Kacheln im 1:1-Grid, min. 96px hoch. "Neuer Bericht" öffnet zuerst das Berichtsart-Sheet
 * (Task 3), "Foto Upload" ist unverändert derselbe Link/dieselbe Berechtigung wie zuvor. */
export function ActionRow({ showPhotoUpload }: { showPhotoUpload: boolean }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <div className={showPhotoUpload ? 'grid grid-cols-2 gap-2.5' : 'grid grid-cols-1 gap-2.5'}>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-brand bg-white text-[15px] font-semibold text-brand shadow-sm"
        >
          Neuer Bericht
        </button>
        {showPhotoUpload && (
          <Link
            href="/foto-uploads/neu"
            className="flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-xl bg-white text-[15px] font-semibold text-[#1c1c1e] shadow-sm"
          >
            Foto Upload
          </Link>
        )}
      </div>
      {sheetOpen && <ReportTypeSheet onClose={() => setSheetOpen(false)} />}
    </>
  );
}
```

Now in `page.tsx`, replace the old block (lines 357-369):
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
with:
```tsx
      <ActionRow showPhotoUpload={canManagePhotoUploadsFor(user, user.homeOrganizationId)} />
      {canManagePhotoUploadsFor(user, user.homeOrganizationId) && (
        <Link href="/foto-uploads" className="-mt-2 self-end text-sm font-medium text-neutral-600 hover:underline">
          Alle Foto Uploads
        </Link>
      )}
```
and add the import at the top of `page.tsx`:
```tsx
import { ActionRow } from './action-row';
```

- [ ] **Step 2: Add the "Zu erledigen"/"Meine Berichte" queries**

In `page.tsx`'s existing `Promise.all` data-loading block, add two more queries (as additional array
entries, following the same destructuring pattern already used there):

```tsx
    prisma.report.findMany({
      where: { status: 'DRAFT', vehicleBookingId: { not: null }, OR: [{ createdById: user.id }, { filledById: user.id }] },
      orderBy: { startAt: 'asc' },
      include: { vehicle: { select: { taktischeBezeichnung: true } } },
    }),
    prisma.report.findMany({
      where: { OR: [{ createdById: user.id }, { filledById: user.id }] },
      orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 3,
    }),
```
destructured as `openReportDrafts` and `myRecentReports` respectively (append to the existing destructuring
array and the `Promise.all([...])` array in the same positions).

- [ ] **Step 3: Render "Zu erledigen" and "Meine Berichte" blocks**

Directly below the new `<ActionRow .../>` block (before the existing
`Fahrzeug Reservierungen`/`Flug registrieren` grid), add:

```tsx
      {openReportDrafts.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Zu erledigen</span>
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[12px] font-bold text-white">
              {openReportDrafts.length}
            </span>
          </div>
          {openReportDrafts.map((draft) => (
            <Link
              key={draft.id}
              href={`/meine-feuerwehr/berichte/${draft.id}/schritt-1`}
              className="flex items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm"
            >
              <span className="text-[14px] text-[#1c1c1e]">
                {draft.vehicle?.taktischeBezeichnung ?? 'Kein Fahrzeug'} · {draft.startAt.toLocaleDateString('de-AT')} ·{' '}
                {draft.startAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}–
                {draft.endAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="flex-none rounded-lg bg-brand px-3 py-1.5 text-[13px] font-semibold text-white">Ausfüllen</span>
            </Link>
          ))}
        </div>
      )}

      {myRecentReports.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Meine Berichte</span>
            <Link href="/meine-feuerwehr/berichte" className="text-sm font-medium text-brand">
              Alle
            </Link>
          </div>
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            {myRecentReports.map((report, index) => (
              <div
                key={report.id}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${index === myRecentReports.length - 1 ? '' : 'border-b border-[#f0f0f2]'}`}
              >
                <span className="text-[14px] text-[#1c1c1e]">
                  {report.status === 'SUBMITTED' ? `Nr. ${report.number}/${report.year}` : 'Entwurf'} ·{' '}
                  {report.startAt.toLocaleDateString('de-AT')}
                </span>
                <span
                  className={`flex-none rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                    report.status === 'SUBMITTED' ? 'bg-[#eaf6f0] text-[#1b7a52]' : 'bg-neutral-100 text-neutral-600'
                  }`}
                >
                  {report.status === 'SUBMITTED' ? 'Abgegeben' : 'Entwurf'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
```

Note: this plan does not include an `/meine-feuerwehr/berichte` (list-all) page — the "Alle" link above is
a forward-reference the design spec's §12 Umsetzungsreihenfolge doesn't call for as its own step; leave the
link in place (matching the brief's own mockup, which shows it), pointing at a route that doesn't exist yet
is an accepted, explicitly out-of-scope gap for this plan, not a bug to silently fix by removing the link.

- [ ] **Step 4: Verify**

Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: both succeed with no errors.

Start the dev server, log in as a seeded member, and visually confirm on `/meine-feuerwehr`: the two-tile
Aktionsreihe renders, clicking "Neuer Bericht" opens the Berichtsart-Sheet, choosing "Tätigkeitsbericht"
creates a draft and navigates to Schritt 1. With no drafts/reports yet, confirm "Zu erledigen"/"Meine
Berichte" are both correctly omitted (no empty placeholder blocks).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr"
git commit -m "feat: Startseite-Integration (Aktionsreihe, Zu erledigen, Meine Berichte) für Tätigkeitsbericht"
```

---

## Self-Review Notes

- **Spec coverage**: §1 (corrections) baked into Task 1's constants/schema; §2 (Datenmodell) = Task 1; §3
  (Nummerierung) = Task 1/7; §4 (Konstanten) = Task 1; §5 (Einstiege/Startseite) = Task 3/6/11; §6 (Formular)
  = Task 3/4/5; §7 (Abgabe) = Task 7; §8 (PDF) = Task 8; §9 (E-Mail) = Task 9; §10 (Verwaltung) = Task 10;
  §11 (Berechtigungen) = Task 1/3 (`canCreateReportFor`/`canViewReport`/`assertReportIsEditable`); §12/§13
  (Reihenfolge/Abnahme) = this plan's own task ordering.
- **Type consistency checked**: `ReportDraftPatch`/`ReportMemberPatchEntry`/`ReportQuantityPatchEntry`
  (Task 3/5) match the fields `submit-actions.ts` (Task 7) reads back; `ReportForPdf` (Task 8) matches the
  fields `submit-actions.ts` (Task 9) constructs from the Prisma `include`; `getNextReportNumber`'s
  `tx: Prisma.TransactionClient` parameter matches how Task 7 calls it inside `prisma.$transaction(async
  (tx) => ...)`.
- **No placeholder scan**: every step above contains complete, runnable code — no "implement like the
  brief says" steps; the two deliberately-out-of-scope items (`/meine-feuerwehr/berichte` list-all page,
  Übungs-/Einsatzbericht's own forms) are explicitly called out as accepted gaps, not silently omitted.
