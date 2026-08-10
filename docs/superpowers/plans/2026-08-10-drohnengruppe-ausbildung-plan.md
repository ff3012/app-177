# Drohnengruppe: 5-stufige Ausbildungsverfolgung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fünf sequentielle Ausbildungsstufen (A1/A3, A2, Stützpunktausbildung, BOS1, BOS2), je mit
Datum, für Drohnengruppen-Mitglieder erfassbar machen - in `UserFormSheet`, mit serverseitiger
Durchsetzung der Reihenfolge.

**Architecture:** Fünf neue nullable `DateTime`-Felder auf `DrohnengruppeMembership` (nicht `User`).
Eine einzige "gültiger Präfix"-Invariante (siehe Design-Spec §3) prüft sowohl das Setzen einer neuen
Stufe als auch das Entfernen einer bestehenden - als zusätzlicher `.refine()` auf `userSchema`,
derselben Mehrfach-`.refine()`-Verkettung, die bereits für die Bezirks-Drohnenadmin-Regel existiert.
`syncDroneMembership` (bereits bestehende Funktion) bekommt die fünf Werte als zusätzliche Parameter
und schreibt sie im bestehenden `upsert` mit. UI: fünf neue Datumszeilen in `UserFormSheet`s
bestehendem, auf `droneRole !== 'NONE'` bedingtem Block, mit demselben `<Input type="date">`-Element
wie in `AtemschutzEditDialog`.

**Tech Stack:** Next.js App Router, Prisma, react-hook-form + zod, shadcn `Input`.

## Global Constraints

- Die fünf Felder leben auf `DrohnengruppeMembership`, nicht auf `User` - sie sind nur für
  tatsächliche Drohnengruppen-Mitglieder sinnvoll.
- Eine einzige "gültiger Präfix"-Invariante (Stufe N nur gesetzt, wenn alle Stufen davor auch gesetzt
  sind) deckt sowohl das Setzen als auch das Entfernen ab - keine separate Lösch-Sperre nötig, die
  Validierung selbst verhindert bereits jeden ungültigen Endzustand.
- Datumswerte werden clientseitig als reine `"YYYY-MM-DD"`-Strings gehalten (dasselbe Muster wie
  `AtemschutzEditDialog`/`atemschutzUntersuchungAm`), nicht als volle ISO-Datumszeit - Konvertierung
  zu/von `Date` passiert nur beim DB-Schreiben (`new Date(dateStr)`) bzw. beim Aufbau der Props
  (`date.toISOString().slice(0, 10)`).
- Keine neue Berechtigungsstufe - bearbeitbar von jedem, der dieses Formular für diesen Benutzer schon
  heute öffnen und die Drohnengruppen-Zuordnung ändern darf.
- Keine Anzeige/Auswertung der erreichten Stufe irgendwo in dieser Phase (kein Badge, keine Ampel,
  kein Self-View) - reine Datenerfassung.
- Es gibt keine Testsuite in diesem Repo. Verifikation je Task über `npx tsc --noEmit`, ein
  eigenständiges Skript gegen die echte Dev-Datenbank (danach löschen), und (letzter Task)
  `npm run build`.

---

### Task 1: Schema + Validierung

**Files:**
- Modify: `prisma/schema.prisma`
- Create: Migration (via `npm run db:migrate`)
- Modify: `src/lib/validation/user.schema.ts`

**Interfaces:**
- Produces: `userSchema` bekommt fünf neue optionale String-Felder
  (`a1a3LizenzAm`/`a2LizenzAm`/`stuetzpunktausbildungAm`/`bos1AusbildungAm`/`bos2AusbildungAm`) plus
  einen zusätzlichen `.refine()`; `parseUserFormData` liest sie aus `FormData`.

- [ ] **Step 1: Schema-Änderung**

In `prisma/schema.prisma`, im bestehenden `model DrohnengruppeMembership { ... }`-Block, direkt nach
der bestehenden `addedAt DateTime @default(now())`-Zeile einfügen:

```prisma
  a1a3LizenzAm            DateTime?
  a2LizenzAm              DateTime?
  stuetzpunktausbildungAm DateTime?
  bos1AusbildungAm        DateTime?
  bos2AusbildungAm        DateTime?
```

- [ ] **Step 2: Migration erzeugen**

```bash
npm run db:migrate
```

Bei der Namensabfrage: `drohnengruppe_ausbildung` verwenden. Additiv, alle Felder nullable - keine
Backfill-Besonderheit.

- [ ] **Step 3: `user.schema.ts` - neue Felder + Sequenz-Validierung**

Ersetze die aktuelle `userSchema`-Definition:

```typescript
export const userSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Vorname ist erforderlich.').max(100),
    lastName: z.string().trim().min(1, 'Nachname ist erforderlich.').max(100),
    email: z.string().trim().email('Ungültige E-Mail-Adresse.'),
    stbNr: z.string().trim().max(50).optional().or(z.literal('')),
    phone: z
      .string()
      .trim()
      .refine((value) => value === '' || E164_PHONE_REGEX.test(value), {
        message: 'Telefonnummer muss im E.164-Format sein (z. B. +436601234567).',
      })
      .optional()
      .or(z.literal('')),
    isActive: z.boolean(),
    istAtemschutzgeraeteTraeger: z.boolean(),
    dienstgradId: z.string().optional().or(z.literal('')),
    homeOrganizationId: z.string().min(1, 'Feuerwehr/Organisation ist erforderlich.'),
    adminOrgIds: z.array(z.string()),
    droneRole: z.enum(DRONE_ROLE_OPTIONS),
    droneGroupId: z.string().nullable(),
    isBezirksAdmin: z.boolean(),
    isBezirksDrohnenAdmin: z.boolean(),
    sendWelcomeEmail: z.boolean(),
  })
  .refine((data) => !data.isBezirksDrohnenAdmin || data.droneRole === 'ADMIN', {
    message: 'Bezirks-Drohnenadmin erfordert die Rolle "Admin" in der zugeordneten Gruppe.',
    path: ['droneRole'],
  })
  .refine((data) => data.droneRole === 'NONE' || !!data.droneGroupId, {
    message: 'Bitte eine Drohnengruppe wählen.',
    path: ['droneGroupId'],
  });
```

mit:

```typescript
export const AUSBILDUNGSSTUFEN = [
  'a1a3LizenzAm',
  'a2LizenzAm',
  'stuetzpunktausbildungAm',
  'bos1AusbildungAm',
  'bos2AusbildungAm',
] as const;
export type Ausbildungsstufe = (typeof AUSBILDUNGSSTUFEN)[number];

export const userSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Vorname ist erforderlich.').max(100),
    lastName: z.string().trim().min(1, 'Nachname ist erforderlich.').max(100),
    email: z.string().trim().email('Ungültige E-Mail-Adresse.'),
    stbNr: z.string().trim().max(50).optional().or(z.literal('')),
    phone: z
      .string()
      .trim()
      .refine((value) => value === '' || E164_PHONE_REGEX.test(value), {
        message: 'Telefonnummer muss im E.164-Format sein (z. B. +436601234567).',
      })
      .optional()
      .or(z.literal('')),
    isActive: z.boolean(),
    istAtemschutzgeraeteTraeger: z.boolean(),
    dienstgradId: z.string().optional().or(z.literal('')),
    homeOrganizationId: z.string().min(1, 'Feuerwehr/Organisation ist erforderlich.'),
    adminOrgIds: z.array(z.string()),
    droneRole: z.enum(DRONE_ROLE_OPTIONS),
    droneGroupId: z.string().nullable(),
    a1a3LizenzAm: z.string(),
    a2LizenzAm: z.string(),
    stuetzpunktausbildungAm: z.string(),
    bos1AusbildungAm: z.string(),
    bos2AusbildungAm: z.string(),
    isBezirksAdmin: z.boolean(),
    isBezirksDrohnenAdmin: z.boolean(),
    sendWelcomeEmail: z.boolean(),
  })
  .refine((data) => !data.isBezirksDrohnenAdmin || data.droneRole === 'ADMIN', {
    message: 'Bezirks-Drohnenadmin erfordert die Rolle "Admin" in der zugeordneten Gruppe.',
    path: ['droneRole'],
  })
  .refine((data) => data.droneRole === 'NONE' || !!data.droneGroupId, {
    message: 'Bitte eine Drohnengruppe wählen.',
    path: ['droneGroupId'],
  })
  .refine(
    (data) => {
      let seenGap = false;
      for (const key of AUSBILDUNGSSTUFEN) {
        if (!data[key]) {
          seenGap = true;
        } else if (seenGap) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Ausbildungsstufen müssen der Reihe nach abgeschlossen werden.',
      path: ['bos2AusbildungAm'],
    },
  );
```

(Jedes der fünf neuen Felder ist ein reiner `z.string()` ohne `.optional()`/`.or(z.literal(''))` -
anders als `stbNr`/`phone` - weil eine leere Zeichenkette hier selbst der gültige "nicht erreicht"-Wert
ist, kein Sonderfall. `parseUserFormData` unten liefert immer einen String, nie `undefined`.)

Update `parseUserFormData` - füge nach der bestehenden
`droneGroupId: (formData.get('droneGroupId') as string) || null,`-Zeile ein:

```typescript
    a1a3LizenzAm: String(formData.get('a1a3LizenzAm') ?? ''),
    a2LizenzAm: String(formData.get('a2LizenzAm') ?? ''),
    stuetzpunktausbildungAm: String(formData.get('stuetzpunktausbildungAm') ?? ''),
    bos1AusbildungAm: String(formData.get('bos1AusbildungAm') ?? ''),
    bos2AusbildungAm: String(formData.get('bos2AusbildungAm') ?? ''),
```

- [ ] **Step 4: Verify with `tsc`**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Verify with a standalone script**

Create `scripts-tmp-verify-ausbildung-schema.ts`:

```typescript
import { userSchema } from './src/lib/validation/user.schema';

const base = {
  firstName: 'A', lastName: 'B', email: 'a@b.com', stbNr: '', phone: '',
  isActive: true, istAtemschutzgeraeteTraeger: false, dienstgradId: '',
  homeOrganizationId: 'org1', adminOrgIds: [], droneRole: 'PILOT' as const, droneGroupId: 'group1',
  isBezirksAdmin: false, isBezirksDrohnenAdmin: false, sendWelcomeEmail: true,
};

const allEmpty = userSchema.safeParse({
  ...base, a1a3LizenzAm: '', a2LizenzAm: '', stuetzpunktausbildungAm: '', bos1AusbildungAm: '', bos2AusbildungAm: '',
});
console.log('Alle Stufen leer ist gültig:', allEmpty.success === true);

const gap = userSchema.safeParse({
  ...base, a1a3LizenzAm: '', a2LizenzAm: '2026-01-01', stuetzpunktausbildungAm: '', bos1AusbildungAm: '', bos2AusbildungAm: '',
});
console.log('A2 ohne A1/A3 wird abgelehnt:', gap.success === false);

const validPrefix = userSchema.safeParse({
  ...base, a1a3LizenzAm: '2025-01-01', a2LizenzAm: '2025-06-01', stuetzpunktausbildungAm: '', bos1AusbildungAm: '', bos2AusbildungAm: '',
});
console.log('A1/A3 + A2 ohne den Rest ist gültig:', validPrefix.success === true);

const full = userSchema.safeParse({
  ...base,
  a1a3LizenzAm: '2020-01-01', a2LizenzAm: '2020-06-01', stuetzpunktausbildungAm: '2021-01-01',
  bos1AusbildungAm: '2022-01-01', bos2AusbildungAm: '2023-01-01',
});
console.log('Alle fünf Stufen der Reihe nach ist gültig:', full.success === true);

const revokedMiddle = userSchema.safeParse({
  ...base,
  a1a3LizenzAm: '2020-01-01', a2LizenzAm: '', stuetzpunktausbildungAm: '2021-01-01',
  bos1AusbildungAm: '', bos2AusbildungAm: '',
});
console.log('A2 entfernt, während Stützpunkt noch gesetzt ist, wird abgelehnt:', revokedMiddle.success === false);
```

Run: `npx tsx scripts-tmp-verify-ausbildung-schema.ts` - alle 5 Zeilen müssen `true` ausgeben. Danach
löschen.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/validation/user.schema.ts
git commit -m "Drohnengruppe: Ausbildungsstufen im Schema + Sequenz-Validierung"
```

---

### Task 2: Server Actions - `syncDroneMembership` erweitern

**Files:**
- Modify: `src/app/(app)/admin/benutzer/actions.ts`

**Interfaces:**
- Consumes: `AUSBILDUNGSSTUFEN`, `userSchema`'s fünf neue Felder (Task 1).
- Produces: `syncDroneMembership` schreibt die fünf Datumsfelder mit.

- [ ] **Step 1: `syncDroneMembership`-Signatur + Persistenz**

Ersetze die aktuelle Funktion:

```typescript
async function syncDroneMembership(
  currentUser: SessionUser,
  userId: string,
  droneRole: DroneRoleOption,
  droneGroupId: string | null,
) {
  const existing = await prisma.drohnengruppeMembership.findUnique({ where: { userId } });
  const currentRole: DroneRoleOption = !existing ? 'NONE' : existing.role === DroneRole.ADMIN ? 'ADMIN' : 'PILOT';
  const currentGroupId = existing?.droneGroupId ?? null;
  const targetGroupId = droneRole === 'NONE' ? null : droneGroupId;

  if (currentRole === droneRole && currentGroupId === targetGroupId) {
    return;
  }

  const affectedGroupIds = Array.from(
    new Set([currentGroupId, targetGroupId].filter((id): id is string => Boolean(id))),
  );
  for (const groupId of affectedGroupIds) {
    const group = await prisma.droneGroup.findUnique({
      where: { id: groupId },
      select: { id: true, organizationId: true },
    });
    assertPermission(
      group !== null && canManageDroneGroupFor(currentUser, group),
      'Keine Berechtigung, Mitglieder dieser Drohnengruppe zu verwalten.',
    );
  }

  if (droneRole === 'NONE') {
    await prisma.drohnengruppeMembership.deleteMany({ where: { userId } });
    return;
  }
  if (!droneGroupId) {
    throw new Error('Drohnengruppe ist erforderlich, wenn eine Rolle gewählt wurde.');
  }
  const role = droneRole === 'ADMIN' ? DroneRole.ADMIN : DroneRole.PILOT;
  await prisma.drohnengruppeMembership.upsert({
    where: { userId },
    update: { role, droneGroupId },
    create: { userId, role, droneGroupId },
  });
}
```

mit:

```typescript
interface AusbildungsDaten {
  a1a3LizenzAm: string;
  a2LizenzAm: string;
  stuetzpunktausbildungAm: string;
  bos1AusbildungAm: string;
  bos2AusbildungAm: string;
}

function toAusbildungsUpdate(daten: AusbildungsDaten) {
  return {
    a1a3LizenzAm: daten.a1a3LizenzAm ? new Date(daten.a1a3LizenzAm) : null,
    a2LizenzAm: daten.a2LizenzAm ? new Date(daten.a2LizenzAm) : null,
    stuetzpunktausbildungAm: daten.stuetzpunktausbildungAm ? new Date(daten.stuetzpunktausbildungAm) : null,
    bos1AusbildungAm: daten.bos1AusbildungAm ? new Date(daten.bos1AusbildungAm) : null,
    bos2AusbildungAm: daten.bos2AusbildungAm ? new Date(daten.bos2AusbildungAm) : null,
  };
}

async function syncDroneMembership(
  currentUser: SessionUser,
  userId: string,
  droneRole: DroneRoleOption,
  droneGroupId: string | null,
  ausbildung: AusbildungsDaten,
) {
  const existing = await prisma.drohnengruppeMembership.findUnique({ where: { userId } });
  const currentRole: DroneRoleOption = !existing ? 'NONE' : existing.role === DroneRole.ADMIN ? 'ADMIN' : 'PILOT';
  const currentGroupId = existing?.droneGroupId ?? null;
  const targetGroupId = droneRole === 'NONE' ? null : droneGroupId;

  const ausbildungChanged =
    existing !== null &&
    AUSBILDUNGSSTUFEN.some((key) => {
      const current = existing[key];
      const currentStr = current ? current.toISOString().slice(0, 10) : '';
      return currentStr !== ausbildung[key];
    });

  if (currentRole === droneRole && currentGroupId === targetGroupId && !ausbildungChanged) {
    return;
  }

  const affectedGroupIds = Array.from(
    new Set([currentGroupId, targetGroupId].filter((id): id is string => Boolean(id))),
  );
  for (const groupId of affectedGroupIds) {
    const group = await prisma.droneGroup.findUnique({
      where: { id: groupId },
      select: { id: true, organizationId: true },
    });
    assertPermission(
      group !== null && canManageDroneGroupFor(currentUser, group),
      'Keine Berechtigung, Mitglieder dieser Drohnengruppe zu verwalten.',
    );
  }

  if (droneRole === 'NONE') {
    await prisma.drohnengruppeMembership.deleteMany({ where: { userId } });
    return;
  }
  if (!droneGroupId) {
    throw new Error('Drohnengruppe ist erforderlich, wenn eine Rolle gewählt wurde.');
  }
  const role = droneRole === 'ADMIN' ? DroneRole.ADMIN : DroneRole.PILOT;
  const ausbildungUpdate = toAusbildungsUpdate(ausbildung);
  await prisma.drohnengruppeMembership.upsert({
    where: { userId },
    update: { role, droneGroupId, ...ausbildungUpdate },
    create: { userId, role, droneGroupId, ...ausbildungUpdate },
  });
}
```

(`ausbildungChanged` erweitert den bestehenden frühen `return`, der bisher nur Rolle/Gruppe verglich -
ohne diese Erweiterung würde eine reine Ausbildungsstufen-Änderung ohne gleichzeitige Rollen-/
Gruppenänderung fälschlich als "keine Änderung" übersprungen und nie gespeichert.)

- [ ] **Step 2: Aufrufstellen aktualisieren**

In `createUser`, ersetze die bestehende Zeile:
```typescript
  await syncDroneMembership(currentUser, user.id, data.droneRole, data.droneGroupId);
```
mit:
```typescript
  await syncDroneMembership(currentUser, user.id, data.droneRole, data.droneGroupId, {
    a1a3LizenzAm: data.a1a3LizenzAm,
    a2LizenzAm: data.a2LizenzAm,
    stuetzpunktausbildungAm: data.stuetzpunktausbildungAm,
    bos1AusbildungAm: data.bos1AusbildungAm,
    bos2AusbildungAm: data.bos2AusbildungAm,
  });
```

In `updateUser`, ersetze die entsprechende bestehende Zeile:
```typescript
  await syncDroneMembership(currentUser, userId, data.droneRole, data.droneGroupId);
```
mit derselben fünf-Felder-Objekt-Erweiterung wie oben (Parameter `userId` statt `user.id`).

Ergänze den Import: die bestehende Zeile `import { type DroneRoleOption, parseUserFormData, userSchema } from '@/lib/validation/user.schema';` wird zu:
```typescript
import { AUSBILDUNGSSTUFEN, type DroneRoleOption, parseUserFormData, userSchema } from '@/lib/validation/user.schema';
```

- [ ] **Step 3: Verify with `tsc`**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Verify with a standalone script against the real dev database**

Create `scripts-tmp-verify-ausbildung-actions.ts` that directly exercises the Prisma-level logic
`syncDroneMembership` uses (not the exported Server Action itself, since it needs `requireUser()`'s
request-scoped session, unreachable from a standalone script - the same established pattern this
codebase already uses for verifying `createUser`/`updateUser`-adjacent logic outside a request
context):

```typescript
import { PrismaClient, DroneRole } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const group = await prisma.droneGroup.findFirstOrThrow();
  const user = await prisma.user.findFirstOrThrow({ where: { droneMembership: null } });

  // Simulate the upsert createUser/updateUser now perform, including the five new fields.
  await prisma.drohnengruppeMembership.upsert({
    where: { userId: user.id },
    update: {
      role: DroneRole.PILOT,
      droneGroupId: group.id,
      a1a3LizenzAm: new Date('2020-01-01'),
      a2LizenzAm: new Date('2020-06-01'),
      stuetzpunktausbildungAm: null,
      bos1AusbildungAm: null,
      bos2AusbildungAm: null,
    },
    create: {
      userId: user.id,
      role: DroneRole.PILOT,
      droneGroupId: group.id,
      a1a3LizenzAm: new Date('2020-01-01'),
      a2LizenzAm: new Date('2020-06-01'),
      stuetzpunktausbildungAm: null,
      bos1AusbildungAm: null,
      bos2AusbildungAm: null,
    },
  });

  const saved = await prisma.drohnengruppeMembership.findUniqueOrThrow({ where: { userId: user.id } });
  console.log('a1a3LizenzAm persisted:', saved.a1a3LizenzAm?.toISOString().slice(0, 10) === '2020-01-01');
  console.log('a2LizenzAm persisted:', saved.a2LizenzAm?.toISOString().slice(0, 10) === '2020-06-01');
  console.log('stuetzpunktausbildungAm null:', saved.stuetzpunktausbildungAm === null);

  // Clean up: remove the test membership so the dev DB is left as found.
  await prisma.drohnengruppeMembership.delete({ where: { userId: user.id } });
  console.log('Cleaned up test membership.');
}

main().finally(() => prisma.$disconnect());
```

Run: `npx tsx scripts-tmp-verify-ausbildung-actions.ts` - all lines must print `true`/confirm cleanup.
Delete the script afterward.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/benutzer/actions.ts"
git commit -m "Drohnengruppe: syncDroneMembership persistiert Ausbildungsstufen"
```

---

### Task 3: UI - `UserFormSheet` + Datenfluss

**Files:**
- Modify: `src/components/admin/user-form-sheet.tsx`
- Modify: `src/app/(app)/admin/benutzer/page.tsx`
- Modify: `src/app/(app)/admin/benutzer/user-management-section.tsx`

**Interfaces:**
- Consumes: `userSchema`'s fünf neuen Felder + `AUSBILDUNGSSTUFEN` (Task 1).
- Produces: `UserSheetTarget`/`UserRow` bekommen fünf neue `string`-Felder (leerer String = nicht
  erreicht, sonst `"YYYY-MM-DD"`).

- [ ] **Step 1: `page.tsx` - Ausbildungsdaten aus `droneMembership` in `UserRow` mappen**

Der bestehende `users`-Query lädt bereits `droneMembership: true` (volle Relation, keine `select`-
Einschränkung) - die fünf neuen Spalten aus Task 1 kommen dadurch automatisch mit, ohne die Query
selbst ändern zu müssen.

Im `rows: UserRow[] = users.map((u) => {...})`-Block, füge nach der bestehenden
`droneGroupId: u.droneMembership?.droneGroupId ?? null,`-Zeile ein:

```typescript
      a1a3LizenzAm: u.droneMembership?.a1a3LizenzAm?.toISOString().slice(0, 10) ?? '',
      a2LizenzAm: u.droneMembership?.a2LizenzAm?.toISOString().slice(0, 10) ?? '',
      stuetzpunktausbildungAm: u.droneMembership?.stuetzpunktausbildungAm?.toISOString().slice(0, 10) ?? '',
      bos1AusbildungAm: u.droneMembership?.bos1AusbildungAm?.toISOString().slice(0, 10) ?? '',
      bos2AusbildungAm: u.droneMembership?.bos2AusbildungAm?.toISOString().slice(0, 10) ?? '',
```

- [ ] **Step 2: `user-management-section.tsx` - `UserRow`/`sheetTarget` erweitern**

Füge in der `UserRow`-Interface (nach der bestehenden `droneGroupId: string | null;`-Zeile) ein:

```typescript
  a1a3LizenzAm: string;
  a2LizenzAm: string;
  stuetzpunktausbildungAm: string;
  bos1AusbildungAm: string;
  bos2AusbildungAm: string;
```

In der `sheetTarget`-Objekt-Konstruktion (der `const sheetTarget: UserSheetTarget | undefined =
sheetTargetRow ? {...} : undefined`-Block), füge nach der bestehenden `droneGroupId:
sheetTargetRow.droneGroupId,`-Zeile ein:

```typescript
        a1a3LizenzAm: sheetTargetRow.a1a3LizenzAm,
        a2LizenzAm: sheetTargetRow.a2LizenzAm,
        stuetzpunktausbildungAm: sheetTargetRow.stuetzpunktausbildungAm,
        bos1AusbildungAm: sheetTargetRow.bos1AusbildungAm,
        bos2AusbildungAm: sheetTargetRow.bos2AusbildungAm,
```

- [ ] **Step 3: `user-form-sheet.tsx` - Typen, `buildDefaultValues`, `onSubmit`**

Erweitere `UserSheetTarget` (nach der bestehenden `droneGroupId: string | null;`-Zeile):

```typescript
  a1a3LizenzAm: string;
  a2LizenzAm: string;
  stuetzpunktausbildungAm: string;
  bos1AusbildungAm: string;
  bos2AusbildungAm: string;
```

In `buildDefaultValues`, füge nach der bestehenden `droneGroupId: target?.droneGroupId ?? null,`-Zeile
ein:

```typescript
    a1a3LizenzAm: target?.a1a3LizenzAm ?? '',
    a2LizenzAm: target?.a2LizenzAm ?? '',
    stuetzpunktausbildungAm: target?.stuetzpunktausbildungAm ?? '',
    bos1AusbildungAm: target?.bos1AusbildungAm ?? '',
    bos2AusbildungAm: target?.bos2AusbildungAm ?? '',
```

Beobachte die fünf Felder mit `watch`, direkt neben der bestehenden `const droneRole =
watch('droneRole');`-Zeile:

```typescript
  const a1a3LizenzAm = watch('a1a3LizenzAm');
  const a2LizenzAm = watch('a2LizenzAm');
  const stuetzpunktausbildungAm = watch('stuetzpunktausbildungAm');
  const bos1AusbildungAm = watch('bos1AusbildungAm');
```

(`bos2AusbildungAm` selbst braucht keinen eigenen `watch` - es gibt keine sechste Stufe, die von ihm
abhinge, sein Eingabefeld muss also nur `bos1AusbildungAm` kennen, nicht sich selbst.)

In `onSubmit`'s `FormData`-Aufbau, füge nach der bestehenden `if (values.droneGroupId)
formData.set('droneGroupId', values.droneGroupId);`-Zeile ein:

```typescript
    formData.set('a1a3LizenzAm', values.a1a3LizenzAm);
    formData.set('a2LizenzAm', values.a2LizenzAm);
    formData.set('stuetzpunktausbildungAm', values.stuetzpunktausbildungAm);
    formData.set('bos1AusbildungAm', values.bos1AusbildungAm);
    formData.set('bos2AusbildungAm', values.bos2AusbildungAm);
```

- [ ] **Step 4: `user-form-sheet.tsx` - die fünf neuen Datumszeilen**

Ersetze den bestehenden, auf `droneRole !== 'NONE'` bedingten Block (aktuell nur die "Gruppe"-Zeile):

```tsx
                    {droneRole !== 'NONE' && (
                      <div className="flex items-center justify-between gap-3.5 px-3.5 py-3">
                        <FieldLabel htmlFor="droneGroupId">Gruppe</FieldLabel>
                        <div className="flex-1">
                          <Controller
                            control={control}
                            name="droneGroupId"
                            render={({ field }) => (
                              <Select value={field.value || 'NONE'} onValueChange={(value) => field.onChange(value === 'NONE' ? null : value)}>
                                <SelectTrigger id="droneGroupId" className="w-full">
                                  <SelectValue placeholder="Gruppe wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="NONE" disabled>
                                    Gruppe wählen
                                  </SelectItem>
                                  {droneGroups.map((group) => (
                                    <SelectItem key={group.id} value={group.id}>
                                      {group.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                          <FieldError message={errors.droneGroupId?.message} />
                        </div>
                      </div>
                    )}
```

mit:

```tsx
                    {droneRole !== 'NONE' && (
                      <>
                        <div className="flex items-center justify-between gap-3.5 border-b border-line px-3.5 py-3">
                          <FieldLabel htmlFor="droneGroupId">Gruppe</FieldLabel>
                          <div className="flex-1">
                            <Controller
                              control={control}
                              name="droneGroupId"
                              render={({ field }) => (
                                <Select value={field.value || 'NONE'} onValueChange={(value) => field.onChange(value === 'NONE' ? null : value)}>
                                  <SelectTrigger id="droneGroupId" className="w-full">
                                    <SelectValue placeholder="Gruppe wählen" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="NONE" disabled>
                                      Gruppe wählen
                                    </SelectItem>
                                    {droneGroups.map((group) => (
                                      <SelectItem key={group.id} value={group.id}>
                                        {group.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            />
                            <FieldError message={errors.droneGroupId?.message} />
                          </div>
                        </div>
                        <div className="px-3.5 py-3">
                          <SectionLabel>Ausbildung</SectionLabel>
                          <div className="flex flex-col gap-3">
                            <div>
                              <FieldLabel htmlFor="a1a3LizenzAm">A1/A3 Pilotenlizenz</FieldLabel>
                              <Input id="a1a3LizenzAm" type="date" {...register('a1a3LizenzAm')} />
                            </div>
                            <div>
                              <FieldLabel htmlFor="a2LizenzAm">A2 Pilotenlizenz</FieldLabel>
                              <Input
                                id="a2LizenzAm"
                                type="date"
                                disabled={!a1a3LizenzAm}
                                {...register('a2LizenzAm')}
                              />
                            </div>
                            <div>
                              <FieldLabel htmlFor="stuetzpunktausbildungAm">Stützpunktausbildung</FieldLabel>
                              <Input
                                id="stuetzpunktausbildungAm"
                                type="date"
                                disabled={!a2LizenzAm}
                                {...register('stuetzpunktausbildungAm')}
                              />
                            </div>
                            <div>
                              <FieldLabel htmlFor="bos1AusbildungAm">BOS1 Ausbildung</FieldLabel>
                              <Input
                                id="bos1AusbildungAm"
                                type="date"
                                disabled={!stuetzpunktausbildungAm}
                                {...register('bos1AusbildungAm')}
                              />
                            </div>
                            <div>
                              <FieldLabel htmlFor="bos2AusbildungAm">BOS2 Ausbildung</FieldLabel>
                              <Input
                                id="bos2AusbildungAm"
                                type="date"
                                disabled={!bos1AusbildungAm}
                                {...register('bos2AusbildungAm')}
                              />
                              <FieldError message={errors.bos2AusbildungAm?.message} />
                            </div>
                          </div>
                        </div>
                      </>
                    )}
```

(Die Sequenz-Fehlermeldung aus Task 1's `.refine()` ist auf `path: ['bos2AusbildungAm']` verankert -
deshalb sitzt `<FieldError>` nur bei diesem letzten Feld, dieselbe Konvention wie andernorts in dieser
Datei, wo eine `.refine()`-Fehlermeldung genau an ihrem `path`-Zielfeld angezeigt wird.)

**Wichtig - Deaktivieren löscht den Wert nicht automatisch:** Setzt ein Admin z. B. `a1a3LizenzAm`
nachträglich zurück auf leer, wird `a2LizenzAm`s Feld zwar wieder deaktiviert (das `disabled`-Attribut
reagiert live auf `watch`), sein zuvor eingegebener Wert bleibt aber im Formular-State stehen, bis der
Admin ihn manuell löscht - `react-hook-form`'s `register` deaktiviert das Feld nur für weitere
Eingaben, ändert seinen aktuellen Wert nicht. Das ist beabsichtigt (kein "automatisches Löschen", siehe
Design-Spec §3/die Nutzer-Entscheidung "nur verhindern, nicht automatisch löschen") - der Submit selbst
schlägt dann serverseitig (und clientseitig über denselben `.refine()`) mit der Sequenz-Fehlermeldung
fehl, bis der Admin den jetzt ungültigen späteren Wert selbst entfernt.

- [ ] **Step 5: Verify with `tsc` and `npm run build`**

```bash
npx tsc --noEmit
npm run build
```
Both must be fully clean - this is the last task in the plan.

- [ ] **Step 6: Live verification**

Start the dev server (or reuse one already running for this worktree). Log in as an admin who can
manage a Drohnengruppe, open a member's edit sheet with `droneRole !== 'NONE'`, and confirm:

1. The "Ausbildung" sub-section renders with five date inputs.
2. All fields except "A1/A3 Pilotenlizenz" start disabled for a member with no training recorded yet.
3. Setting "A1/A3 Pilotenlizenz" enables "A2 Pilotenlizenz" (and so on down the chain) without a
   page reload.
4. Setting all five in order and saving persists correctly (reopen the sheet, confirm the dates are
   still there).
5. Directly editing the DB (or via a script) to remove a middle stage while a later one stays set,
   then attempting to save that same inconsistent state through the form, is rejected with the
   sequence error message.
6. A user with `droneRole === 'NONE'` never sees the "Ausbildung" section at all.

Because this browser-automation environment has a documented, harness-wide limitation around
executing client-side JavaScript reliably (see CLAUDE.md and this plan's own prior features' reports),
verify what you can via rendered markup/direct interaction if it works, and fall back to a careful
code-level trace plus the standalone DB scripts from Tasks 1-2 for anything that can't be exercised
live - say so plainly in your report rather than claiming an untested interaction was verified.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/user-form-sheet.tsx "src/app/(app)/admin/benutzer/page.tsx" "src/app/(app)/admin/benutzer/user-management-section.tsx"
git commit -m "Drohnengruppe: Ausbildungsstufen-UI im UserFormSheet"
```
