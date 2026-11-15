# Berichte-Schnellerfassung am iPad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein gemeinsames iPad im Feuerwehrhaus erfasst Tätigkeits-, Übungs- und Einsatzberichte über einen geheimen Link je Feuerwehr ohne Anmeldung, im Querformat-Layout "A" (Schrittleiste links, zwei Spalten).

**Architecture:** Der bestehende Assistent `ReportWizard` wird geteilt: Er bekommt ein zweites Layout (`'tablet'`) und austauschbare Abgabe-/Abschluss-Callbacks. Der Kern von `submitReport` wandert in eine reine Funktion `submitReportCore`, die die App-Aktion (Sitzung) und die neue Kiosk-Aktion (Link) gemeinsam nutzen. Eine neue öffentliche Seite `/berichte-schnell/[token]` führt durch Namenswahl, Berichtsart, Assistent und Bestätigung.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 6 (PostgreSQL), Tailwind 3, vitest 5, `@react-pdf/renderer` (unverändert).

**Spec:** `docs/superpowers/specs/2026-11-14-berichte-schnellerfassung-ipad-design.md` (vom App-Betreiber freigegeben).

## Global Constraints

- Alle sichtbaren Texte deutsch. Code-Bezeichner: deutsch/englisch gemischt, in jeder Datei der dortigen Konvention folgen.
- **Git:** Arbeit auf Branch `feature/berichte-ipad` (von `main`). Pro Aufgabe ein Commit mit **ausdrücklich genannten Dateien** (`git add <pfad> ...`), **nie** `git add -A`/`git add .`. `android/`, jede `AGENTS.md`, `docs/agents/` und `.superpowers/` nie committen. **Nie pushen.** Commit-Nachricht deutsch, Endzeile: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Zeilenenden:** Arbeitsbaum CRLF, Index LF (`core.autocrlf=true`). Bearbeitete Dateien nur per Edit-Werkzeug ändern (bewahrt die Zeilenenden), neue Dateien mit LF anlegen. `git diff --cached --stat` darf kein Ganzdatei-Rauschen zeigen.
- **Datenbank-Tests** (`*.db.test.ts`, `npm run test:db`) laufen **nur gegen die lokale Dev-Datenbank** (`docker compose -f docker-compose.dev.yml up -d`, `.env` aus `.env.example`). Fixtures mit eindeutigem Präfix (`const RUN = \`...-${Date.now()}\``), Aufräumen **geschützt** (nie ein `deleteMany`-Filter, der `undefined` sein kann; Id-Listen vorher auf Leere prüfen).
- **Migration:** nie `prisma migrate dev` (bekannter Reihenfolge-Fehler in der Historie). Migrationsordner von Hand anlegen, lokal mit `npx prisma migrate deploy` anwenden, dann `npx prisma generate`. Bestehende Migrationen nie ändern.
- **Keine neue Umgebungsvariable, keine neue Abhängigkeit.** `docker/docker-compose.yml` bleibt unverändert.
- **PDF/S3/E-Mail in Tests mocken** (`vi.mock`), damit die lokale `.env` nie echte Mails sendet oder in S3 schreibt.
- Nach jeder Aufgabe: `npx tsc --noEmit` muss sauber sein. Vor der letzten Aufgabe zusätzlich `npm test`, `npm run test:db`, `npm run build`.
- Das Handy-Layout und der App-Ablauf in `/meine-feuerwehr/berichte/neu` dürfen sich **nicht** ändern (Charakterisierungstests in Aufgabe 5 sichern das).

## Datei-Übersicht

Neu:
- `prisma/migrations/20261114090000_report_kiosk_token/migration.sql`
- `src/lib/heimatfeuerwehr/report-kiosk-token.ts` (+ `.test.ts`, `.db.test.ts`)
- `src/lib/heimatfeuerwehr/report-kiosk-user.ts` (+ `.db.test.ts`)
- `src/lib/heimatfeuerwehr/recent-activity-kinds.ts` (+ `.test.ts`)
- `src/lib/heimatfeuerwehr/submit-report-core.ts` (+ `.db.test.ts`)
- `src/lib/heimatfeuerwehr/report-kiosk-submit.ts` (+ `.db.test.ts`)
- `src/lib/heimatfeuerwehr/report-kiosk-data.ts` (+ `.db.test.ts`)
- `src/app/(app)/admin/heimatfeuerwehr/report-kiosk-actions.ts`, `report-kiosk-card.tsx`
- `src/components/heimatfeuerwehr/member-tile-select.tsx` (+ `.test.ts`)
- `src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.test.ts`
- `src/app/berichte-schnell/[token]/page.tsx`, `actions.ts`, `kiosk-flow.tsx`, `kiosk-flow.test.ts`

Geändert:
- `prisma/schema.prisma`, `src/middleware.ts`
- `src/app/(app)/meine-feuerwehr/berichte/submit-actions.ts`
- `src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.tsx`, `neu/page.tsx`
- `src/app/(app)/admin/heimatfeuerwehr/page.tsx`
- `src/app/(app)/meine-feuerwehr/CLAUDE.md`, `CLAUDE.md` (Wurzel), Spec (Nachtrag)

---

### Task 1: Datenmodell, Link-Verwaltung und technischer Ersteller

**Files:**
- Create: `prisma/migrations/20261114090000_report_kiosk_token/migration.sql`
- Modify: `prisma/schema.prisma` (Modell `Organization`, direkt nach der Zeile `icsToken`)
- Create: `src/lib/heimatfeuerwehr/report-kiosk-token.ts`, `report-kiosk-token.test.ts`, `report-kiosk-token.db.test.ts`
- Create: `src/lib/heimatfeuerwehr/report-kiosk-user.ts`, `report-kiosk-user.db.test.ts`

**Interfaces:**
- Produces (`report-kiosk-token.ts`):
  - `generateReportKioskToken(): string` (32 Zeichen base64url)
  - `isPlausibleReportKioskToken(token: string): boolean`
  - `setReportKioskToken(organizationId: string): Promise<string>` (erzeugt oder dreht den Link neu; nur aktive `FEUERWEHR`, sonst `Error`)
  - `clearReportKioskToken(organizationId: string): Promise<void>`
  - `findOrganizationByKioskToken(token: string): Promise<{ id: string; name: string } | null>` (nur aktive Organisationen)
- Produces (`report-kiosk-user.ts`): `isReportKioskEmail(email: string): boolean`, `getOrCreateReportKioskUser(): Promise<User>`

- [ ] **Step 1: Branch anlegen**

```bash
git switch -c feature/berichte-ipad
```

- [ ] **Step 2: Reinen Unit-Test schreiben (`report-kiosk-token.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { generateReportKioskToken, isPlausibleReportKioskToken } from './report-kiosk-token';

describe('generateReportKioskToken', () => {
  it('liefert 32 URL-sichere Zeichen', () => {
    expect(generateReportKioskToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('liefert bei jedem Aufruf einen anderen Wert', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateReportKioskToken()));
    expect(tokens.size).toBe(50);
  });
});

describe('isPlausibleReportKioskToken', () => {
  it('akzeptiert einen erzeugten Token', () => {
    expect(isPlausibleReportKioskToken(generateReportKioskToken())).toBe(true);
  });

  it.each(['', 'kurz', 'a'.repeat(31), 'a'.repeat(33), `${'a'.repeat(31)}!`, `${'a'.repeat(31)} `])(
    'lehnt %j ab',
    (value) => {
      expect(isPlausibleReportKioskToken(value)).toBe(false);
    },
  );
});
```

- [ ] **Step 3: Test laufen lassen, muss scheitern**

Run: `npx vitest run src/lib/heimatfeuerwehr/report-kiosk-token.test.ts`
Expected: FAIL (Modul `./report-kiosk-token` existiert nicht).

- [ ] **Step 4: Schema ändern**

In `prisma/schema.prisma`, Modell `Organization`, direkt unter der Zeile `icsToken           String             @unique @default(cuid())` einfügen:

```prisma
  // Geheimer Link der iPad-Berichte-Schnellerfassung (/berichte-schnell/<token>), Klartext wie icsToken
  // (der Admin muss ihn wieder anzeigen können). null = Schnellerfassung aus (Standard für jede Feuerwehr).
  reportKioskToken   String?            @unique
```

- [ ] **Step 5: Migration von Hand anlegen**

`prisma/migrations/20261114090000_report_kiosk_token/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "reportKioskToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_reportKioskToken_key" ON "Organization"("reportKioskToken");
```

Dann lokal anwenden und Client erzeugen:

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: `20261114090000_report_kiosk_token` wird angewendet. Prüfen mit `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` (Ausgabe soll leer sein bzw. "-- This is an empty migration.").

- [ ] **Step 6: `report-kiosk-token.ts` schreiben**

```ts
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db/prisma';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** 24 Zufallsbytes = 192 Bit, als 32 URL-sichere Zeichen. */
export function generateReportKioskToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Formprüfung vor jeder Datenbankabfrage: ein offensichtlich falscher Wert erreicht die DB nie. */
export function isPlausibleReportKioskToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * Erzeugt den Link der Schnellerfassung oder dreht ihn neu (der alte Wert ist sofort ungültig).
 * Nur aktive Feuerwehren (nicht Abschnittskommandos): Berichte gehören immer einer Feuerwehr.
 */
export async function setReportKioskToken(organizationId: string): Promise<string> {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, type: 'FEUERWEHR', isActive: true },
    select: { id: true },
  });
  if (!organization) throw new Error('Die Schnellerfassung gibt es nur für aktive Feuerwehren.');

  const token = generateReportKioskToken();
  await prisma.organization.update({ where: { id: organization.id }, data: { reportKioskToken: token } });
  return token;
}

/** Schaltet die Schnellerfassung ab: der bisherige Link antwortet danach 404. */
export async function clearReportKioskToken(organizationId: string): Promise<void> {
  await prisma.organization.update({ where: { id: organizationId }, data: { reportKioskToken: null } });
}

/** Löst einen Link auf. Unbekannt, abgeschaltet, neu erzeugt oder Organisation deaktiviert: null. */
export async function findOrganizationByKioskToken(token: string): Promise<{ id: string; name: string } | null> {
  if (!isPlausibleReportKioskToken(token)) return null;
  return prisma.organization.findUnique({
    where: { reportKioskToken: token, isActive: true },
    select: { id: true, name: true },
  });
}
```

- [ ] **Step 7: Unit-Test grün**

Run: `npx vitest run src/lib/heimatfeuerwehr/report-kiosk-token.test.ts`
Expected: PASS.

- [ ] **Step 8: DB-Test schreiben (`report-kiosk-token.db.test.ts`)**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import {
  clearReportKioskToken,
  findOrganizationByKioskToken,
  setReportKioskToken,
} from './report-kiosk-token';

const RUN = `kiosk-token-${Date.now()}`;
const orgIds: string[] = [];
let feuerwehrId: string;
let abschnittId: string;
let inaktivId: string;

async function makeOrg(key: string, type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO', isActive = true) {
  const org = await prisma.organization.create({
    data: { name: `${RUN}-${key}`, nummer: `${RUN}-${key}`, type, isActive },
  });
  orgIds.push(org.id);
  return org.id;
}

beforeAll(async () => {
  feuerwehrId = await makeOrg('ff', 'FEUERWEHR');
  abschnittId = await makeOrg('afkdo', 'ABSCHNITTSKOMMANDO');
  inaktivId = await makeOrg('inaktiv', 'FEUERWEHR', false);
});

afterAll(async () => {
  if (orgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe('Link der Berichte-Schnellerfassung', () => {
  it('erzeugt einen Link, der die Feuerwehr auflöst', async () => {
    const token = await setReportKioskToken(feuerwehrId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await findOrganizationByKioskToken(token)).toEqual({ id: feuerwehrId, name: `${RUN}-ff` });
  });

  it('dreht den Link neu: der alte Wert ist sofort ungültig', async () => {
    const alt = await setReportKioskToken(feuerwehrId);
    const neu = await setReportKioskToken(feuerwehrId);
    expect(neu).not.toBe(alt);
    expect(await findOrganizationByKioskToken(alt)).toBeNull();
    expect(await findOrganizationByKioskToken(neu)).not.toBeNull();
  });

  it('schaltet ab: der Link löst nichts mehr auf', async () => {
    const token = await setReportKioskToken(feuerwehrId);
    await clearReportKioskToken(feuerwehrId);
    expect(await findOrganizationByKioskToken(token)).toBeNull();
    const row = await prisma.organization.findUnique({ where: { id: feuerwehrId }, select: { reportKioskToken: true } });
    expect(row?.reportKioskToken).toBeNull();
  });

  it('lehnt Abschnittskommandos und inaktive Feuerwehren ab', async () => {
    await expect(setReportKioskToken(abschnittId)).rejects.toThrow('nur für aktive Feuerwehren');
    await expect(setReportKioskToken(inaktivId)).rejects.toThrow('nur für aktive Feuerwehren');
  });

  it('löst einen Link nicht mehr auf, sobald die Feuerwehr deaktiviert wurde', async () => {
    const token = await setReportKioskToken(feuerwehrId);
    await prisma.organization.update({ where: { id: feuerwehrId }, data: { isActive: false } });
    try {
      expect(await findOrganizationByKioskToken(token)).toBeNull();
    } finally {
      await prisma.organization.update({ where: { id: feuerwehrId }, data: { isActive: true } });
    }
  });

  it('antwortet auf unbekannte oder formal falsche Werte mit null', async () => {
    expect(await findOrganizationByKioskToken('')).toBeNull();
    expect(await findOrganizationByKioskToken('x'.repeat(32))).toBeNull();
  });
});
```

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/report-kiosk-token.db.test.ts`
Expected: PASS (alle 6).

- [ ] **Step 9: `report-kiosk-user.ts` schreiben** (Struktur wie `src/lib/drone/quick-register-user.ts`, zusätzlich mit Schutz gegen gleichzeitige Anlage)

```ts
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { hashPassword } from '@/lib/password';

const REPORT_KIOSK_EMAIL = 'berichte-schnellerfassung@system.local';

/** Ob eine E-Mail dem technischen Platzhalter der iPad-Schnellerfassung gehört (kein echter Mensch). */
export function isReportKioskEmail(email: string): boolean {
  return email === REPORT_KIOSK_EMAIL;
}

/**
 * Technischer Ersteller (`Report.createdById`) für Berichte der Schnellerfassung. `isActive: false`
 * und zufälliges Passwort: eine Anmeldung ist ausgeschlossen, der Weg läuft komplett an der Sitzung
 * vorbei (siehe /berichte-schnell/[token]). Die Heimatorganisation ist irgendein Abschnittskommando
 * (Pflichtfeld), nie eine Feuerwehr - der Platzhalter taucht deshalb in keiner Mitgliederliste einer
 * Feuerwehr auf.
 */
export async function getOrCreateReportKioskUser() {
  const existing = await prisma.user.findUnique({ where: { email: REPORT_KIOSK_EMAIL } });
  if (existing) return existing;

  const homeOrganization = await prisma.organization.findFirstOrThrow({ where: { type: 'ABSCHNITTSKOMMANDO' } });
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));

  try {
    return await prisma.user.create({
      data: {
        email: REPORT_KIOSK_EMAIL,
        passwordHash,
        firstName: 'Schnellerfassung',
        lastName: '(iPad)',
        isActive: false,
        homeOrganizationId: homeOrganization.id,
      },
    });
  } catch (error) {
    // Zwei gleichzeitige erste Abgaben: die zweite scheitert am Unique-Index der E-Mail - dann den
    // inzwischen angelegten Platzhalter laden.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.user.findUniqueOrThrow({ where: { email: REPORT_KIOSK_EMAIL } });
    }
    throw error;
  }
}
```

- [ ] **Step 10: DB-Test für den Platzhalter (`report-kiosk-user.db.test.ts`)**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getOrCreateReportKioskUser, isReportKioskEmail } from './report-kiosk-user';

const RUN = `kiosk-user-${Date.now()}`;
let abschnittId: string | null = null;
let userExistedBefore = false;

beforeAll(async () => {
  userExistedBefore = (await prisma.user.findUnique({ where: { email: 'berichte-schnellerfassung@system.local' } })) !== null;
  const org = await prisma.organization.create({ data: { name: `${RUN}-afkdo`, nummer: `${RUN}-afkdo`, type: 'ABSCHNITTSKOMMANDO' } });
  abschnittId = org.id;
});

afterAll(async () => {
  if (!userExistedBefore) {
    await prisma.user.deleteMany({ where: { email: 'berichte-schnellerfassung@system.local' } });
  }
  if (abschnittId) await prisma.organization.deleteMany({ where: { id: abschnittId } });
});

describe('getOrCreateReportKioskUser', () => {
  it('legt einen nicht anmeldbaren Platzhalter an und liefert beim zweiten Aufruf denselben', async () => {
    const first = await getOrCreateReportKioskUser();
    const second = await getOrCreateReportKioskUser();
    expect(second.id).toBe(first.id);
    expect(first.isActive).toBe(false);
    expect(isReportKioskEmail(first.email)).toBe(true);
  });

  it('übersteht zwei gleichzeitige erste Aufrufe', async () => {
    const [a, b] = await Promise.all([getOrCreateReportKioskUser(), getOrCreateReportKioskUser()]);
    expect(a.id).toBe(b.id);
  });
});

describe('isReportKioskEmail', () => {
  it('erkennt nur die Platzhalter-Adresse', () => {
    expect(isReportKioskEmail('berichte-schnellerfassung@system.local')).toBe(true);
    expect(isReportKioskEmail('max@example.at')).toBe(false);
  });
});
```

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/report-kiosk-user.db.test.ts`
Expected: PASS.

- [ ] **Step 11: Typprüfung und Commit**

```bash
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations/20261114090000_report_kiosk_token/migration.sql \
  src/lib/heimatfeuerwehr/report-kiosk-token.ts src/lib/heimatfeuerwehr/report-kiosk-token.test.ts \
  src/lib/heimatfeuerwehr/report-kiosk-token.db.test.ts src/lib/heimatfeuerwehr/report-kiosk-user.ts \
  src/lib/heimatfeuerwehr/report-kiosk-user.db.test.ts \
  docs/superpowers/specs/2026-11-14-berichte-schnellerfassung-ipad-design.md \
  docs/superpowers/plans/2026-11-14-berichte-schnellerfassung-ipad.md
git commit -m "feat: Berichte-Schnellerfassung - Link je Feuerwehr, technischer Ersteller (Spec, Plan, Datenmodell)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Geteilter Abgabe-Kern und "Zuletzt verwendet" je Feuerwehr

**Files:**
- Create: `src/lib/heimatfeuerwehr/submit-report-core.ts`, `submit-report-core.db.test.ts`
- Create: `src/lib/heimatfeuerwehr/recent-activity-kinds.ts`, `recent-activity-kinds.test.ts`
- Modify: `src/app/(app)/meine-feuerwehr/berichte/submit-actions.ts` (wird dünn)
- Modify: `src/app/(app)/meine-feuerwehr/berichte/neu/page.tsx` (Import der Hilfsfunktion)
- Modify: `src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.tsx` (nur der Typ-Import, siehe Step 9)

**Interfaces:**
- Produces (`submit-report-core.ts`):
  - `interface SubmitReportInput` (Felder unverändert wie bisher in `submit-actions.ts` Zeilen 14-45)
  - `interface SubmitReportResult { error?: string; reportId?: string; number?: number; year?: number }`
  - `submitReportCore(params: { fireDepartmentId: string; createdById: string; input: SubmitReportInput }): Promise<SubmitReportResult>`
- Produces (`recent-activity-kinds.ts`): `distinctRecentKinds(reports, limit?)`, `getRecentActivityKindsForUser(userId, type)`, `getRecentActivityKindsForOrg(fireDepartmentId, type)`

- [ ] **Step 1: Test für die Hilfsfunktion (`recent-activity-kinds.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { distinctRecentKinds } from './recent-activity-kinds';

describe('distinctRecentKinds', () => {
  it('liefert die ersten drei verschiedenen Codes, neueste Berichte zuerst', () => {
    const reports = [
      { activityKinds: ['A'] },
      { activityKinds: ['B', 'A'] },
      { activityKinds: ['C'] },
      { activityKinds: ['D'] },
    ];
    expect(distinctRecentKinds(reports)).toEqual(['A', 'B', 'C']);
  });

  it('liefert weniger, wenn es weniger gibt', () => {
    expect(distinctRecentKinds([{ activityKinds: ['A'] }, { activityKinds: [] }])).toEqual(['A']);
    expect(distinctRecentKinds([])).toEqual([]);
  });

  it('beachtet ein anderes Limit', () => {
    expect(distinctRecentKinds([{ activityKinds: ['A', 'B', 'C'] }], 2)).toEqual(['A', 'B']);
  });
});
```

Run: `npx vitest run src/lib/heimatfeuerwehr/recent-activity-kinds.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 2: `recent-activity-kinds.ts` schreiben** (Logik wörtlich aus `neu/page.tsx` `getRecentActivityKinds` übernommen, plus Feuerwehr-Variante)

```ts
import type { ReportType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export const RECENT_ACTIVITY_KIND_LIMIT = 3;

/** Reine Logik: die ersten `limit` verschiedenen Codes in der Reihenfolge der Berichte (neueste zuerst). */
export function distinctRecentKinds(
  reports: { activityKinds: string[] }[],
  limit: number = RECENT_ACTIVITY_KIND_LIMIT,
): string[] {
  const seen = new Set<string>();
  for (const report of reports) {
    for (const code of report.activityKinds) {
      seen.add(code);
      if (seen.size >= limit) return [...seen];
    }
  }
  return [...seen];
}

/** "Zuletzt verwendet" eines Benutzers (App): seine eigenen abgegebenen Berichte desselben Typs. */
export async function getRecentActivityKindsForUser(userId: string, type: ReportType): Promise<string[]> {
  const recent = await prisma.report.findMany({
    where: { filledById: userId, type },
    orderBy: { submittedAt: 'desc' },
    take: 10,
    select: { activityKinds: true },
  });
  return distinctRecentKinds(recent);
}

/** "Zuletzt verwendet" einer Feuerwehr (gemeinsames iPad): alle Berichte der Feuerwehr desselben Typs. */
export async function getRecentActivityKindsForOrg(fireDepartmentId: string, type: ReportType): Promise<string[]> {
  const recent = await prisma.report.findMany({
    where: { fireDepartmentId, type },
    orderBy: { submittedAt: 'desc' },
    take: 10,
    select: { activityKinds: true },
  });
  return distinctRecentKinds(recent);
}
```

Run: `npx vitest run src/lib/heimatfeuerwehr/recent-activity-kinds.test.ts`
Expected: PASS.

- [ ] **Step 3: `neu/page.tsx` auf die gemeinsame Funktion umstellen**

In `src/app/(app)/meine-feuerwehr/berichte/neu/page.tsx` die lokale Funktion `getRecentActivityKinds` samt ihrem Kommentar (Zeilen 9-29) **ersatzlos löschen**, den Import `import type { ReportType } from '@prisma/client';` beibehalten, und ergänzen:

```ts
import { getRecentActivityKindsForUser } from '@/lib/heimatfeuerwehr/recent-activity-kinds';
```

Den Aufruf `getRecentActivityKinds(user.id, type)` (Zeile 59) ersetzen durch `getRecentActivityKindsForUser(user.id, type)`.

- [ ] **Step 4: DB-Test für den Kern schreiben (`submit-report-core.db.test.ts`)**

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { submitReportCore, type SubmitReportInput } from './submit-report-core';

// PDF, S3 und E-Mail sind nicht Gegenstand dieser Tests und dürfen mit einer lokalen .env nie echt auslösen.
vi.mock('@/lib/storage/report-pdf-s3', () => ({ putReportPdf: vi.fn(async () => undefined) }));
vi.mock('@/lib/heimatfeuerwehr/notify-report-submitted', () => ({
  sendReportSubmittedEmail: vi.fn(async () => ({ attempted: 0, failed: 0 })),
}));
vi.mock('@/lib/heimatfeuerwehr/report-pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/heimatfeuerwehr/report-pdf')>()),
  generateReportPdf: vi.fn(async () => Buffer.from('pdf')),
}));

const RUN = `submit-core-${Date.now()}`;
const ids: Record<string, string> = {};
const vehicleIds: Record<string, string> = {};
let orgA = '';
let orgB = '';

async function makeUser(key: string, organizationId: string, extra: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'x',
      firstName: key,
      lastName: RUN,
      stbNr: '4711',
      homeOrganizationId: organizationId,
      ...extra,
    },
  });
  ids[key] = user.id;
}

function input(over: Partial<SubmitReportInput> = {}): SubmitReportInput {
  return {
    type: 'ACTIVITY',
    filledById: ids.fillerA,
    startAt: '2030-06-15T08:00:00.000Z',
    endAt: '2030-06-15T10:00:00.000Z',
    ownActivity: true,
    activityKinds: [],
    activityOther: 'Test',
    vehicles: [],
    remark: 'Bemerkung',
    members: [],
    quantities: [],
    uebungsleiterId: null,
    uebungsueberwachungId: null,
    uebungsbeobachterId: null,
    uebungsortStrasse: null,
    uebungsortNr: null,
    uebungsortPlz: null,
    uebungsortOrt: null,
    weitereFeuerwehren: null,
    uebungsziel: null,
    uebungslage: null,
    uebungsdarstellung: null,
    fuerUebungVerstaendigen: null,
    uebungserkenntnis: null,
    uebungszielsetzung: null,
    vorschlaege: null,
    ...over,
  };
}

beforeAll(async () => {
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  orgB = (await prisma.organization.create({ data: { name: `${RUN}-b`, nummer: `${RUN}-b`, type: 'FEUERWEHR' } })).id;
  await makeUser('creator', orgA);
  await makeUser('fillerA', orgA);
  await makeUser('memberA', orgA);
  await makeUser('fillerB', orgB);
  await makeUser('gone', orgA, { isActive: false, passwordChangedAt: new Date() });
  vehicleIds.a = (
    await prisma.vehicle.create({ data: { organizationId: orgA, taktischeBezeichnung: 'KLF', kennzeichen: `${RUN}-KA`, marke: 'M', typ: 'T' } })
  ).id;
  vehicleIds.b = (
    await prisma.vehicle.create({ data: { organizationId: orgB, taktischeBezeichnung: 'TLF', kennzeichen: `${RUN}-KB`, marke: 'M', typ: 'T' } })
  ).id;
});

afterAll(async () => {
  const orgIds = [orgA, orgB].filter((id) => id !== '');
  if (orgIds.length > 0) {
    await prisma.report.deleteMany({ where: { fireDepartmentId: { in: orgIds } } });
    await prisma.reportSequence.deleteMany({ where: { fireDepartmentId: { in: orgIds } } });
    await prisma.vehicle.deleteMany({ where: { organizationId: { in: orgIds } } });
  }
  const userIds = Object.values(ids);
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (orgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe('submitReportCore', () => {
  it('legt den Bericht mit Ersteller, Ausfüller und Feuerwehr an und liefert Nummer und Jahr', async () => {
    const result = await submitReportCore({
      fireDepartmentId: orgA,
      createdById: ids.creator,
      input: input({
        vehicles: [{ vehicleId: vehicleIds.a, km: 12 }],
        members: [{ userId: ids.memberA, funktion: 'FAHRER', vehicleId: vehicleIds.a }],
      }),
    });
    expect(result.error).toBeUndefined();
    expect(result.number).toBe(1);
    expect(result.year).toBe(new Date().getFullYear());

    const report = await prisma.report.findUniqueOrThrow({
      where: { id: result.reportId },
      include: { vehicles: true, members: true },
    });
    expect(report.fireDepartmentId).toBe(orgA);
    expect(report.createdById).toBe(ids.creator);
    expect(report.filledById).toBe(ids.fillerA);
    expect(report.vehicles).toHaveLength(1);
    expect(report.members).toHaveLength(1);
    expect(report.members[0].reportVehicleId).toBe(report.vehicles[0].id);
  });

  it('vergibt fortlaufende Nummern je Feuerwehr', async () => {
    const first = await submitReportCore({ fireDepartmentId: orgB, createdById: ids.creator, input: input({ filledById: ids.fillerB }) });
    const second = await submitReportCore({ fireDepartmentId: orgB, createdById: ids.creator, input: input({ filledById: ids.fillerB }) });
    expect(second.number).toBe((first.number ?? 0) + 1);
  });

  it('lehnt einen Ausfüller einer anderen Feuerwehr ab', async () => {
    const result = await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ filledById: ids.fillerB }) });
    expect(result.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
    expect(result.reportId).toBeUndefined();
  });

  it('lehnt einen bewusst deaktivierten Ausfüller ab', async () => {
    const result = await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ filledById: ids.gone }) });
    expect(result.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
  });

  it('lehnt ein Fahrzeug einer anderen Feuerwehr ab', async () => {
    const result = await submitReportCore({
      fireDepartmentId: orgA,
      createdById: ids.creator,
      input: input({ vehicles: [{ vehicleId: vehicleIds.b, km: 1 }] }),
    });
    expect(result.error).toBe('Mindestens ein ausgewähltes Fahrzeug gehört nicht zu dieser Feuerwehr.');
  });

  it('lehnt ein eingesetztes Mitglied einer anderen Feuerwehr ab', async () => {
    const result = await submitReportCore({
      fireDepartmentId: orgA,
      createdById: ids.creator,
      input: input({ members: [{ userId: ids.fillerB, funktion: 'MANNSCHAFT', vehicleId: null }] }),
    });
    expect(result.error).toBe('Mindestens ein eingesetztes Mitglied gehört nicht zu dieser Feuerwehr.');
  });

  it('lehnt einen Übungsleiter einer anderen Feuerwehr ab', async () => {
    const result = await submitReportCore({
      fireDepartmentId: orgA,
      createdById: ids.creator,
      input: input({ type: 'EXERCISE', uebungsleiterId: ids.fillerB }),
    });
    expect(result.error).toBe('Übungsleiter/-überwachung/-beobachter muss zu dieser Feuerwehr gehören.');
  });

  it('verlangt eine Bemerkung', async () => {
    const result = await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ remark: '   ' }) });
    expect(result.error).toBe('Eine Bemerkung ist erforderlich.');
  });

  it('verlangt, dass das Ende nach dem Beginn liegt', async () => {
    const result = await submitReportCore({
      fireDepartmentId: orgA,
      createdById: ids.creator,
      input: input({ startAt: '2030-06-15T10:00:00.000Z', endAt: '2030-06-15T08:00:00.000Z' }),
    });
    expect(result.error).toBe('Das Ende muss nach dem Beginn liegen.');
  });
});
```

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/submit-report-core.db.test.ts`
Expected: FAIL (Modul `./submit-report-core` fehlt).

- [ ] **Step 5: `submit-report-core.ts` durch Verschieben anlegen**

Neue Datei `src/lib/heimatfeuerwehr/submit-report-core.ts` (ohne `'use server'`). Inhalt = der bisherige Inhalt von `src/app/(app)/meine-feuerwehr/berichte/submit-actions.ts` mit **genau diesen Änderungen** (alles andere wörtlich übernehmen, inklusive aller Kommentare):

1. Kopfzeile: `'use server';` und die Imports `requireUser`, `assertPermission, canCreateReportFor` **weglassen**. Übrige Imports bleiben, `prisma` aus `@/lib/db/prisma`.
2. `export interface SubmitReportInput { ... }` und `const FUNKTIONEN` unverändert übernehmen.
3. Direkt nach `FUNKTIONEN` ergänzen:

```ts
export interface SubmitReportResult {
  error?: string;
  reportId?: string;
  number?: number;
  year?: number;
}
```

4. Die Funktion `submitReport(input)` wird zu:

```ts
export async function submitReportCore(params: {
  fireDepartmentId: string;
  createdById: string;
  input: SubmitReportInput;
}): Promise<SubmitReportResult> {
  const { fireDepartmentId, createdById, input } = params;
```

   Die drei Zeilen `const user = await requireUser();`, `assertPermission(canCreateReportFor(user, user.homeOrganizationId));` und `const fireDepartmentId = user.homeOrganizationId;` **entfallen** (stehen jetzt im Aufrufer).
5. Im `tx.report.create`-`data` ersetzen: `createdById: user.id,` durch `createdById,`.
6. Letzte Zeile `return { reportId };` ersetzen durch `return { reportId, number, year };`.
7. Der Doc-Kommentar über der Funktion bleibt; vor dessen erstem Satz ergänzen: `Geteilter Kern von submitReport (App, Sitzung) und submitReportViaKiosk (Link). Der Aufrufer prüft die Berechtigung und liefert fireDepartmentId und createdById - alles Übrige prüft diese Funktion selbst.`

- [ ] **Step 6: `submit-actions.ts` auf einen dünnen Aufruf reduzieren**

Der gesamte Inhalt von `src/app/(app)/meine-feuerwehr/berichte/submit-actions.ts` wird ersetzt durch:

```ts
'use server';

import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import {
  submitReportCore,
  type SubmitReportInput,
  type SubmitReportResult,
} from '@/lib/heimatfeuerwehr/submit-report-core';

/**
 * Legt einen Bericht aus der App an (angemeldeter Benutzer, seine Heimatfeuerwehr). Die gesamte
 * Prüfung und das Anlegen liegen in submitReportCore (geteilt mit der iPad-Schnellerfassung), siehe dort.
 */
export async function submitReport(input: SubmitReportInput): Promise<SubmitReportResult> {
  const user = await requireUser();
  assertPermission(canCreateReportFor(user, user.homeOrganizationId));
  return submitReportCore({ fireDepartmentId: user.homeOrganizationId, createdById: user.id, input });
}
```

- [ ] **Step 7: Kern-Test grün**

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/submit-report-core.db.test.ts`
Expected: PASS (alle 9).

- [ ] **Step 8: Typimport im Assistenten umstellen**

In `src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.tsx` Zeile 16 ersetzen:

```ts
import { submitReport, type SubmitReportInput } from '../submit-actions';
```

durch

```ts
import { submitReport } from '../submit-actions';
import type { SubmitReportInput } from '@/lib/heimatfeuerwehr/submit-report-core';
```

- [ ] **Step 9: Prüfen und Commit**

```bash
npx tsc --noEmit
npm test
git add src/lib/heimatfeuerwehr/submit-report-core.ts src/lib/heimatfeuerwehr/submit-report-core.db.test.ts \
  src/lib/heimatfeuerwehr/recent-activity-kinds.ts src/lib/heimatfeuerwehr/recent-activity-kinds.test.ts \
  "src/app/(app)/meine-feuerwehr/berichte/submit-actions.ts" \
  "src/app/(app)/meine-feuerwehr/berichte/neu/page.tsx" \
  "src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.tsx"
git commit -m "refactor: Abgabe-Kern von submitReport geteilt, Zuletzt verwendet auch je Feuerwehr

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Kiosk-Abgabe (Link prüfen, Limit, Ersteller) und Daten für die Seite

**Files:**
- Create: `src/lib/heimatfeuerwehr/report-kiosk-submit.ts`, `report-kiosk-submit.db.test.ts`
- Create: `src/lib/heimatfeuerwehr/report-kiosk-data.ts`, `report-kiosk-data.db.test.ts`
- Create: `src/app/berichte-schnell/[token]/actions.ts`

**Interfaces:**
- Consumes: `findOrganizationByKioskToken`, `getOrCreateReportKioskUser`, `submitReportCore`, `checkRateLimit` (aus `@/lib/mcp/rate-limit`), `getRecentActivityKindsForOrg`
- Produces (`report-kiosk-submit.ts`): `KIOSK_SUBMIT_MAX = 20`, `KIOSK_SUBMIT_WINDOW_MS`, `kioskRateKey(token)`, `submitReportForKiosk(token, input): Promise<SubmitReportResult>`
- Produces (`report-kiosk-data.ts`): `KioskData` und `loadKioskData(token): Promise<KioskData | null>`
- Produces (`actions.ts`): `submitReportViaKiosk(token, input)` (Server Action, dünn)

- [ ] **Step 1: DB-Test für die Abgabe schreiben (`report-kiosk-submit.db.test.ts`)**

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { checkRateLimit } from '@/lib/mcp/rate-limit';
import { clearReportKioskToken, setReportKioskToken } from './report-kiosk-token';
import { isReportKioskEmail } from './report-kiosk-user';
import { KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS, kioskRateKey, submitReportForKiosk } from './report-kiosk-submit';
import type { SubmitReportInput } from './submit-report-core';

vi.mock('@/lib/storage/report-pdf-s3', () => ({ putReportPdf: vi.fn(async () => undefined) }));
vi.mock('@/lib/heimatfeuerwehr/notify-report-submitted', () => ({
  sendReportSubmittedEmail: vi.fn(async () => ({ attempted: 0, failed: 0 })),
}));
vi.mock('@/lib/heimatfeuerwehr/report-pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/heimatfeuerwehr/report-pdf')>()),
  generateReportPdf: vi.fn(async () => Buffer.from('pdf')),
}));

const RUN = `kiosk-submit-${Date.now()}`;
const ids: Record<string, string> = {};
let orgA = '';
let orgB = '';
let abschnittId = '';
let kioskUserExistedBefore = false;

async function makeUser(key: string, organizationId: string) {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${key}@example.local`, passwordHash: 'x', firstName: key, lastName: RUN, stbNr: '1', homeOrganizationId: organizationId },
  });
  ids[key] = user.id;
}

function input(over: Partial<SubmitReportInput> = {}): SubmitReportInput {
  return {
    type: 'ACTIVITY',
    filledById: ids.fillerA,
    startAt: '2030-06-15T08:00:00.000Z',
    endAt: '2030-06-15T10:00:00.000Z',
    ownActivity: true,
    activityKinds: [],
    activityOther: 'Test',
    vehicles: [],
    remark: 'Bemerkung',
    members: [],
    quantities: [],
    uebungsleiterId: null,
    uebungsueberwachungId: null,
    uebungsbeobachterId: null,
    uebungsortStrasse: null,
    uebungsortNr: null,
    uebungsortPlz: null,
    uebungsortOrt: null,
    weitereFeuerwehren: null,
    uebungsziel: null,
    uebungslage: null,
    uebungsdarstellung: null,
    fuerUebungVerstaendigen: null,
    uebungserkenntnis: null,
    uebungszielsetzung: null,
    vorschlaege: null,
    ...over,
  };
}

beforeAll(async () => {
  kioskUserExistedBefore = (await prisma.user.findUnique({ where: { email: 'berichte-schnellerfassung@system.local' } })) !== null;
  abschnittId = (await prisma.organization.create({ data: { name: `${RUN}-afkdo`, nummer: `${RUN}-afkdo`, type: 'ABSCHNITTSKOMMANDO' } })).id;
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  orgB = (await prisma.organization.create({ data: { name: `${RUN}-b`, nummer: `${RUN}-b`, type: 'FEUERWEHR' } })).id;
  await makeUser('fillerA', orgA);
  await makeUser('fillerB', orgB);
});

afterAll(async () => {
  const orgIds = [orgA, orgB].filter((id) => id !== '');
  if (orgIds.length > 0) {
    await prisma.report.deleteMany({ where: { fireDepartmentId: { in: orgIds } } });
    await prisma.reportSequence.deleteMany({ where: { fireDepartmentId: { in: orgIds } } });
  }
  const userIds = Object.values(ids);
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (!kioskUserExistedBefore) await prisma.user.deleteMany({ where: { email: 'berichte-schnellerfassung@system.local' } });
  const allOrgIds = [orgA, orgB, abschnittId].filter((id) => id !== '');
  if (allOrgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: allOrgIds } } });
});

describe('submitReportForKiosk', () => {
  it('legt mit gültigem Link einen Bericht an: Ersteller ist der Platzhalter, Ausfüller die gewählte Person', async () => {
    const token = await setReportKioskToken(orgA);
    const result = await submitReportForKiosk(token, input());
    expect(result.error).toBeUndefined();
    expect(result.number).toBe(1);

    const report = await prisma.report.findUniqueOrThrow({ where: { id: result.reportId }, include: { createdBy: true } });
    expect(report.fireDepartmentId).toBe(orgA);
    expect(report.filledById).toBe(ids.fillerA);
    expect(isReportKioskEmail(report.createdBy.email)).toBe(true);
  });

  it('lehnt einen unbekannten Link ab und legt nichts an', async () => {
    const before = await prisma.report.count({ where: { fireDepartmentId: { in: [orgA, orgB] } } });
    const result = await submitReportForKiosk('x'.repeat(32), input());
    expect(result.error).toBe('Die Schnellerfassung ist nicht mehr aktiv.');
    expect(await prisma.report.count({ where: { fireDepartmentId: { in: [orgA, orgB] } } })).toBe(before);
  });

  it('lehnt einen abgeschalteten Link ab (auch wenn die Seite noch offen war)', async () => {
    const token = await setReportKioskToken(orgA);
    await clearReportKioskToken(orgA);
    const result = await submitReportForKiosk(token, input());
    expect(result.error).toBe('Die Schnellerfassung ist nicht mehr aktiv.');
  });

  it('lehnt einen neu erzeugten (alten) Link ab', async () => {
    const alt = await setReportKioskToken(orgA);
    await setReportKioskToken(orgA);
    const result = await submitReportForKiosk(alt, input());
    expect(result.error).toBe('Die Schnellerfassung ist nicht mehr aktiv.');
  });

  it('bindet die Abgabe an die Feuerwehr des Links: ein Ausfüller einer anderen Feuerwehr wird abgelehnt', async () => {
    const token = await setReportKioskToken(orgA);
    const result = await submitReportForKiosk(token, input({ filledById: ids.fillerB }));
    expect(result.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
  });

  it('begrenzt die Abgaben je Link', async () => {
    const token = await setReportKioskToken(orgB);
    for (let i = 0; i < KIOSK_SUBMIT_MAX; i += 1) {
      expect(checkRateLimit(kioskRateKey(token), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS).allowed).toBe(true);
    }
    const result = await submitReportForKiosk(token, input({ filledById: ids.fillerB }));
    expect(result.error).toBe('Zu viele Abgaben. Bitte später erneut versuchen.');
  });

  it('zählt unbekannte Links nicht gegen das Limit (kein Speicherwachstum durch Raten)', async () => {
    const unknown = 'y'.repeat(32);
    await submitReportForKiosk(unknown, input());
    // Der Zähler für diesen Schlüssel darf noch leer sein: das gesamte Kontingent ist frei.
    for (let i = 0; i < KIOSK_SUBMIT_MAX; i += 1) {
      expect(checkRateLimit(kioskRateKey(unknown), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS).allowed).toBe(true);
    }
  });
});
```

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/report-kiosk-submit.db.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 2: `report-kiosk-submit.ts` schreiben**

```ts
import { checkRateLimit } from '@/lib/mcp/rate-limit';
import { findOrganizationByKioskToken } from './report-kiosk-token';
import { getOrCreateReportKioskUser } from './report-kiosk-user';
import { submitReportCore, type SubmitReportInput, type SubmitReportResult } from './submit-report-core';

/** Höchstens 20 Abgaben pro Stunde und Link - weit über dem Bedarf eines Feuerwehrhauses, bremst nur Schleifen. */
export const KIOSK_SUBMIT_MAX = 20;
export const KIOSK_SUBMIT_WINDOW_MS = 60 * 60 * 1000;

export function kioskRateKey(token: string): string {
  return `berichte-schnell:${token}`;
}

/**
 * Abgabe über den geheimen Link, ohne Sitzung. Der Link wird bei JEDER Abgabe neu aufgelöst (ein
 * abgeschalteter oder neu erzeugter Link wirkt sofort, auch bei noch geöffneter Seite), die Feuerwehr
 * kommt ausschließlich aus dem Link. Das Limit wird erst NACH der Linkprüfung gezählt, damit ratende
 * Anfragen mit erfundenen Links keine Zähler anlegen.
 */
export async function submitReportForKiosk(token: string, input: SubmitReportInput): Promise<SubmitReportResult> {
  const organization = await findOrganizationByKioskToken(token);
  if (!organization) return { error: 'Die Schnellerfassung ist nicht mehr aktiv.' };

  const limit = checkRateLimit(kioskRateKey(token), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS);
  if (!limit.allowed) return { error: 'Zu viele Abgaben. Bitte später erneut versuchen.' };

  const kioskUser = await getOrCreateReportKioskUser();
  return submitReportCore({ fireDepartmentId: organization.id, createdById: kioskUser.id, input });
}
```

Run den Test aus Step 1: Expected PASS (alle 7).

- [ ] **Step 3: Server Action (`src/app/berichte-schnell/[token]/actions.ts`)**

```ts
'use server';

import { submitReportForKiosk } from '@/lib/heimatfeuerwehr/report-kiosk-submit';
import type { SubmitReportInput, SubmitReportResult } from '@/lib/heimatfeuerwehr/submit-report-core';

/** Öffentliche Abgabe der iPad-Schnellerfassung. Bewusst OHNE requireUser(): die Prüfung (Link, Limit,
 * Zugehörigkeit aller Personen und Fahrzeuge zur Feuerwehr des Links) liegt in submitReportForKiosk. */
export async function submitReportViaKiosk(token: string, input: SubmitReportInput): Promise<SubmitReportResult> {
  return submitReportForKiosk(token, input);
}
```

- [ ] **Step 4: DB-Test für die Seitendaten schreiben (`report-kiosk-data.db.test.ts`)**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { setReportKioskToken } from './report-kiosk-token';
import { loadKioskData } from './report-kiosk-data';

const RUN = `kiosk-data-${Date.now()}`;
const userIds: string[] = [];
let orgA = '';
let orgB = '';
let abschnittId = '';
let reportId = '';

async function makeUser(key: string, organizationId: string, extra: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'x',
      firstName: key,
      lastName: `${RUN}-${key}`,
      stbNr: '777',
      phone: '0664 1234567',
      homeOrganizationId: organizationId,
      ...extra,
    },
  });
  userIds.push(user.id);
  return user.id;
}

beforeAll(async () => {
  abschnittId = (await prisma.organization.create({ data: { name: `${RUN}-afkdo`, nummer: `${RUN}-afkdo`, type: 'ABSCHNITTSKOMMANDO' } })).id;
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  orgB = (await prisma.organization.create({ data: { name: `${RUN}-b`, nummer: `${RUN}-b`, type: 'FEUERWEHR' } })).id;
  const bauer = await makeUser('bauer', orgA);
  await makeUser('anton', orgA);
  await makeUser('fremd', orgB);
  await makeUser('gone', orgA, { isActive: false, passwordChangedAt: new Date() });
  await prisma.vehicle.create({ data: { organizationId: orgA, taktischeBezeichnung: 'KLF', kennzeichen: `${RUN}-K1`, marke: 'M', typ: 'T', isActive: true } });
  await prisma.vehicle.create({ data: { organizationId: orgA, taktischeBezeichnung: 'Alt', kennzeichen: `${RUN}-K2`, marke: 'M', typ: 'T', isActive: false } });
  await prisma.vehicle.create({ data: { organizationId: orgB, taktischeBezeichnung: 'Fremd', kennzeichen: `${RUN}-K3`, marke: 'M', typ: 'T' } });
  const report = await prisma.report.create({
    data: {
      number: 1, year: 2999, type: 'ACTIVITY', fireDepartmentId: orgA, filledById: bauer, createdById: bauer,
      startAt: new Date('2030-06-15T08:00:00Z'), endAt: new Date('2030-06-15T10:00:00Z'), ownActivity: true,
      activityKinds: ['KIND_X'], remark: 'x', submittedAt: new Date(),
    },
  });
  reportId = report.id;
});

afterAll(async () => {
  const orgIds = [orgA, orgB].filter((id) => id !== '');
  if (reportId) await prisma.report.deleteMany({ where: { id: reportId } });
  if (orgIds.length > 0) await prisma.vehicle.deleteMany({ where: { organizationId: { in: orgIds } } });
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  const allOrgIds = [orgA, orgB, abschnittId].filter((id) => id !== '');
  if (allOrgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: allOrgIds } } });
});

describe('loadKioskData', () => {
  it('liefert null für einen unbekannten Link', async () => {
    expect(await loadKioskData('z'.repeat(32))).toBeNull();
  });

  it('liefert nur aktive Mitglieder und aktive Fahrzeuge der Feuerwehr des Links, alphabetisch', async () => {
    const token = await setReportKioskToken(orgA);
    const data = await loadKioskData(token);
    expect(data?.organization).toEqual({ id: orgA, name: `${RUN}-a` });
    expect(data?.members.map((m) => m.firstName)).toEqual(['anton', 'bauer']);
    expect(data?.vehicles.map((v) => v.taktischeBezeichnung)).toEqual(['KLF']);
  });

  it('gibt von den Mitgliedern nur Id und Namen aus - nie E-Mail, Stb-Nr. oder Telefon', async () => {
    const token = await setReportKioskToken(orgA);
    const data = await loadKioskData(token);
    for (const member of data?.members ?? []) {
      expect(Object.keys(member).sort()).toEqual(['firstName', 'id', 'lastName']);
    }
  });

  it('liefert "Zuletzt verwendet" je Berichtsart aus den Berichten der Feuerwehr', async () => {
    const token = await setReportKioskToken(orgA);
    const data = await loadKioskData(token);
    expect(data?.recentKindsByType.ACTIVITY).toEqual(['KIND_X']);
    expect(data?.recentKindsByType.EXERCISE).toEqual([]);
  });
});
```

Run: Expected FAIL (Modul fehlt).

- [ ] **Step 5: `report-kiosk-data.ts` schreiben**

```ts
import type { ReportType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { ACTIVE_REPORT_TYPES } from './report-constants';
import { findOrganizationByKioskToken } from './report-kiosk-token';
import { getRecentActivityKindsForOrg } from './recent-activity-kinds';

export interface KioskData {
  organization: { id: string; name: string };
  /** Nur Id und Name: das Gerät ist öffentlich, E-Mail/Stb-Nr./Telefon verlassen den Server nie. */
  members: { id: string; firstName: string; lastName: string }[];
  vehicles: { id: string; taktischeBezeichnung: string; kennzeichen: string }[];
  recentKindsByType: Record<string, string[]>;
}

/** Alles, was die Seite /berichte-schnell/[token] braucht - null bei unbekanntem/abgeschaltetem Link. */
export async function loadKioskData(token: string): Promise<KioskData | null> {
  const organization = await findOrganizationByKioskToken(token);
  if (!organization) return null;

  const [members, vehicles, recent] = await Promise.all([
    prisma.user.findMany({
      where: { homeOrganizationId: organization.id, ...NOT_DEACTIVATED_WHERE },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.vehicle.findMany({
      where: { organizationId: organization.id, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
    }),
    Promise.all(
      ACTIVE_REPORT_TYPES.map(async (type) => [type, await getRecentActivityKindsForOrg(organization.id, type as ReportType)] as const),
    ),
  ]);

  return { organization, members, vehicles, recentKindsByType: Object.fromEntries(recent) };
}
```

Hinweis: `ACTIVE_REPORT_TYPES` ist `readonly string[] = ['ACTIVITY', 'EXERCISE']` (`report-constants.ts`): der **Einsatzbericht ist in der App noch nicht freigeschaltet** und bekommt deshalb auch keinen Eintrag in `recentKindsByType` (die Seite behandelt ihn mit `?? []`, siehe Aufgabe 7, wo er als ausgegraute Kachel erscheint wie im Berichtsart-Blatt der App).

- [ ] **Step 6: Tests grün, Typen, Commit**

```bash
npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/report-kiosk-data.db.test.ts src/lib/heimatfeuerwehr/report-kiosk-submit.db.test.ts
npx tsc --noEmit
git add src/lib/heimatfeuerwehr/report-kiosk-submit.ts src/lib/heimatfeuerwehr/report-kiosk-submit.db.test.ts \
  src/lib/heimatfeuerwehr/report-kiosk-data.ts src/lib/heimatfeuerwehr/report-kiosk-data.db.test.ts \
  "src/app/berichte-schnell/[token]/actions.ts"
git commit -m "feat: Kiosk-Abgabe der Berichte-Schnellerfassung (Link-Prüfung, Limit, Seitendaten)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verwaltung des Links und öffentlicher Pfad

**Files:**
- Create: `src/app/(app)/admin/heimatfeuerwehr/report-kiosk-actions.ts`, `report-kiosk-card.tsx`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/page.tsx`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `setReportKioskToken`, `clearReportKioskToken` (Task 1), `canManageHeimatfeuerwehrFor`, `requireUser`, `assertPermission`
- Produces: `createReportKioskLink(organizationId)`, `disableReportKioskLink(organizationId)` (Server Actions, `Promise<void>`), `<ReportKioskCard link createAction disableAction />`

Diese Aufgabe ist reine Verdrahtung (Server Actions, Karte, Pfad); die Logik ist in Aufgabe 1 getestet. Geprüft wird mit `tsc`, Build und der Browser-Prüfung in Aufgabe 8.

- [ ] **Step 1: Server Actions (`report-kiosk-actions.ts`)**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { clearReportKioskToken, setReportKioskToken } from '@/lib/heimatfeuerwehr/report-kiosk-token';

/** Erzeugt den Link der iPad-Schnellerfassung oder dreht ihn neu (der alte Link ist sofort ungültig). */
export async function createReportKioskLink(organizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  await setReportKioskToken(organizationId);
  revalidatePath('/admin/heimatfeuerwehr');
}

/** Schaltet die Schnellerfassung ab: der bisherige Link antwortet 404. */
export async function disableReportKioskLink(organizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  await clearReportKioskToken(organizationId);
  revalidatePath('/admin/heimatfeuerwehr');
}
```

- [ ] **Step 2: Karte (`report-kiosk-card.tsx`)**

```tsx
'use client';

import { CopyLinkButton } from '@/components/ui/copy-link-button';

/**
 * Verwaltung der iPad-Berichte-Schnellerfassung einer Feuerwehr: Link anzeigen/kopieren, neu erzeugen,
 * abschalten. `createAction`/`disableAction` sind die bereits an die Organisation gebundenen Server
 * Actions (kein Client-seitiges Vertrauen: beide prüfen die Berechtigung erneut).
 */
export function ReportKioskCard({
  link,
  createAction,
  disableAction,
}: {
  link: string | null;
  createAction: () => Promise<void>;
  disableAction: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-3">
      {link ? (
        <>
          <div className="flex items-center gap-2">
            <p className="flex-1 break-all rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">{link}</p>
            <CopyLinkButton text={link} />
          </div>
          <div className="flex flex-wrap gap-2">
            <form
              action={createAction}
              onSubmit={(event) => {
                if (!window.confirm('Neuen Link erzeugen? Der bisherige Link funktioniert danach nicht mehr, das iPad muss neu geöffnet werden.')) {
                  event.preventDefault();
                }
              }}
            >
              <button type="submit" className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken">
                Neuen Link erzeugen
              </button>
            </form>
            <form
              action={disableAction}
              onSubmit={(event) => {
                if (!window.confirm('Schnellerfassung abschalten? Der Link antwortet danach nicht mehr.')) event.preventDefault();
              }}
            >
              <button type="submit" className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-danger hover:bg-surface-sunken">
                Abschalten
              </button>
            </form>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-muted">Noch nicht aktiv.</p>
          <form action={createAction}>
            <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover">
              Link erzeugen
            </button>
          </form>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: In `admin/heimatfeuerwehr/page.tsx` einbinden**

1. Imports ergänzen (zu den bestehenden, z. B. nach `import { ReportRecipientsForm } from './report-recipients-form';`):

```tsx
import { ReportKioskCard } from './report-kiosk-card';
import { createReportKioskLink, disableReportKioskLink } from './report-kiosk-actions';
```

2. Hilfsfunktion neben `buildDashboardLink` ergänzen:

```tsx
function buildReportKioskLink(token: string): string {
  const baseUrl = process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
  return `${baseUrl}/berichte-schnell/${token}`;
}
```

3. Im `prisma.organization.findUnique`-`select` (die Abfrage mit `reportRecipients: true`) ergänzen: `reportKioskToken: true,`.
4. Direkt **nach** dem schließenden `</div>` der Karte, die `<h2 ...>Berichte</h2>` enthält (also nach der Berichte-Tabelle, vor der nächsten Karte), neue Karte einfügen:

```tsx
      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Berichte-Schnellerfassung (iPad)</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Geheimer Link für ein gemeinsames iPad im Feuerwehrhaus: Mitglieder wählen ihren Namen und erfassen Berichte ohne
          Anmeldung. Wer den Link kennt, kann Berichte unter dem Namen jedes aktiven Mitglieds dieser Feuerwehr anlegen. Den Link
          deshalb nur auf dem Gerät hinterlegen.
        </p>
        <ReportKioskCard
          key={selectedOrgId}
          link={selectedOrgFull.reportKioskToken ? buildReportKioskLink(selectedOrgFull.reportKioskToken) : null}
          createAction={createReportKioskLink.bind(null, selectedOrgId)}
          disableAction={disableReportKioskLink.bind(null, selectedOrgId)}
        />
      </div>
```

- [ ] **Step 4: Öffentlichen Pfad freischalten (`src/middleware.ts`)**

In `PUBLIC_PATH_PREFIXES` nach `'/drohnen-schnell',` ergänzen: `'/berichte-schnell',`.

- [ ] **Step 5: Prüfen und Commit**

```bash
npx tsc --noEmit
git add "src/app/(app)/admin/heimatfeuerwehr/report-kiosk-actions.ts" "src/app/(app)/admin/heimatfeuerwehr/report-kiosk-card.tsx" \
  "src/app/(app)/admin/heimatfeuerwehr/page.tsx" src/middleware.ts
git commit -m "feat: Verwaltung des Schnellerfassungs-Links und öffentlicher Pfad /berichte-schnell

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Assistent lösen: Callbacks statt fester App-Navigation (Handy bleibt gleich)

**Files:**
- Create: `src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.test.ts`
- Modify: `src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.tsx`

**Interfaces:**
- Produces: neue optionale Props von `ReportWizard`: `onSubmit`, `onDone`, `onCancel` (in dieser Aufgabe), `layout`, `tabletHeader`, `lockFilledBy` (Typen schon jetzt; wirksam in Aufgabe 6)

```ts
layout?: 'mobile' | 'tablet';                       // Standard 'mobile'
onSubmit?: (payload: SubmitReportInput) => Promise<SubmitReportResult>;   // Standard: submitReport
onDone?: (result: { reportId: string; number?: number; year?: number }) => void; // Standard: router.push zur Abgeschlossen-Seite
onCancel?: () => void;                              // Standard: Link "‹ Abbrechen" nach /meine-feuerwehr
tabletHeader?: { title: string; subtitle?: string };
lockFilledBy?: boolean;                             // blendet die Auswahl "Ausgefüllt von" aus
```

- [ ] **Step 1: Charakterisierungstests schreiben (`report-wizard.test.ts`)**

```ts
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: (props: { href: string; className?: string; children?: ReactNode }) =>
    createElement('a', { href: props.href, className: props.className }, props.children),
}));
vi.mock('../submit-actions', () => ({ submitReport: vi.fn() }));

import { ReportWizard } from './report-wizard';

type WizardProps = ComponentProps<typeof ReportWizard>;

const base = {
  type: 'ACTIVITY' as const,
  filledById: 'u1',
  members: [
    { id: 'u1', firstName: 'Anna', lastName: 'Huber' },
    { id: 'u2', firstName: 'Bernd', lastName: 'Bauer' },
  ],
  vehicles: [{ id: 'v1', taktischeBezeichnung: 'KLF', kennzeichen: 'PL-1F' }],
  recentActivityKinds: [] as string[],
};

function render(props: Partial<WizardProps> = {}): string {
  return renderToStaticMarkup(createElement(ReportWizard, { ...base, ...props }));
}

describe('ReportWizard (Handy-Layout, Standard)', () => {
  it('zeigt Schrittkopf, Ausfüller-Auswahl und die feste untere Leiste', () => {
    const html = render();
    expect(html).toContain('Schritt 1 von 3');
    expect(html).toContain('Ausgefüllt von');
    expect(html).toContain('pb-safe-tabbar');
    expect(html).toContain('href="/meine-feuerwehr"');
  });

  it('hat bei einem Übungsbericht vier Schritte', () => {
    expect(render({ type: 'EXERCISE' })).toContain('Schritt 1 von 4');
  });

  it('ersetzt mit onCancel den Abbrechen-Link durch eine Schaltfläche', () => {
    const html = render({ onCancel: () => undefined });
    expect(html).toContain('‹ Abbrechen');
    expect(html).not.toContain('href="/meine-feuerwehr"');
  });
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `npx vitest run "src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.test.ts"`
Expected: Die ersten beiden Tests PASS (Verhalten unverändert), der dritte FAIL (`onCancel` gibt es noch nicht, der Link bleibt).

- [ ] **Step 3: Imports, Props und Header im Assistenten ändern** (alle Edits in `report-wizard.tsx`)

1. Import-Zeilen 16 und die zuvor in Aufgabe 2 gesetzte Typ-Zeile ersetzen durch:

```ts
import { submitReport } from '../submit-actions';
import type { SubmitReportInput, SubmitReportResult } from '@/lib/heimatfeuerwehr/submit-report-core';
```

   und `REPORT_TYPE_LABEL` in den Import aus `@/lib/heimatfeuerwehr/report-constants` aufnehmen (neben `MATERIALS, EQUIPMENT, ...`).

2. `WizardHeader` bekommt `onCancel`:

```tsx
function WizardHeader({
  step,
  totalSteps,
  onBack,
  onCancel,
}: {
  step: number;
  totalSteps: number;
  onBack: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        {step === 1 ? (
          onCancel ? (
            <button type="button" onClick={onCancel} className="text-sm font-medium text-brand">
              ‹ Abbrechen
            </button>
          ) : (
            <Link href="/meine-feuerwehr" className="text-sm font-medium text-brand">
              ‹ Abbrechen
            </Link>
          )
        ) : (
          <button type="button" onClick={onBack} className="text-sm font-medium text-brand">
            ‹ Zurück
          </button>
        )}
```

   (der Rest von `WizardHeader`, ab `<span className="text-xs font-medium text-neutral-500">`, bleibt unverändert.)

3. Im Props-Objekt von `ReportWizard` (Parameterliste und Typ) ergänzen:

```tsx
  layout = 'mobile',
  onSubmit,
  onDone,
  onCancel,
  tabletHeader,
  lockFilledBy = false,
```

   und im Typ:

```tsx
  layout?: 'mobile' | 'tablet';
  onSubmit?: (payload: SubmitReportInput) => Promise<SubmitReportResult>;
  onDone?: (result: { reportId: string; number?: number; year?: number }) => void;
  onCancel?: () => void;
  tabletHeader?: { title: string; subtitle?: string };
  lockFilledBy?: boolean;
```

4. In `handleSubmit` die Zeilen `const result = await submitReport(payload);` ... `router.push(...)` ersetzen durch:

```tsx
      const result = await (onSubmit ?? submitReport)(payload);
      if (result.error || !result.reportId) {
        setError(result.error ?? 'Der Bericht konnte nicht abgegeben werden. Bitte erneut versuchen.');
        setSubmitting(false);
        return;
      }
      if (onDone) {
        onDone({ reportId: result.reportId, number: result.number, year: result.year });
      } else {
        router.push(`/meine-feuerwehr/berichte/${result.reportId}/abgeschlossen`);
      }
```

5. Den Aufruf `<WizardHeader step={step} totalSteps={totalSteps} onBack={goBack} />` ergänzen um `onCancel={onCancel}`.

   `layout`, `tabletHeader`, `lockFilledBy` werden in dieser Aufgabe noch nicht gelesen. Damit `tsc` ohne "unused"-Warnung bleibt, direkt unter der Props-Destrukturierung `void layout; void tabletHeader; void lockFilledBy;` einfügen und in Aufgabe 6 wieder entfernen.

- [ ] **Step 4: Tests grün, Typen, Commit**

```bash
npx vitest run "src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.test.ts"
npx tsc --noEmit
git add "src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.tsx" "src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.test.ts"
git commit -m "refactor: Berichts-Assistent mit austauschbarer Abgabe, Abschluss und Abbruch (Handy unverändert)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: alle drei Tests PASS.

---

### Task 6: Tablet-Layout (A) mit Kachelauswahl

**Files:**
- Create: `src/components/heimatfeuerwehr/member-tile-select.tsx`, `member-tile-select.test.ts`
- Modify: `src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.tsx`
- Modify: `src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.test.ts` (Tablet-Tests ergänzen)

**Interfaces:**
- Produces: `MemberTileSelect({ members, excludeIds, onAdd, placeholder })` (gleiche Schnittstelle wie `MemberMultiSelect`), `filterSelectableMembers(members, excludeIds, search)`
- `ReportWizard` `layout='tablet'` rendert eine vollständige Seite mit `data-layout="tablet"`

- [ ] **Step 1: Test für die Kachelauswahl (`member-tile-select.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { filterSelectableMembers } from './member-tile-select';

const members = [
  { id: '1', firstName: 'Anna', lastName: 'Huber' },
  { id: '2', firstName: 'Bernd', lastName: 'Bauer' },
  { id: '3', firstName: 'Clara', lastName: 'Bauer' },
];

describe('filterSelectableMembers', () => {
  it('schließt bereits eingetragene Mitglieder aus', () => {
    expect(filterSelectableMembers(members, ['2'], '').map((m) => m.id)).toEqual(['1', '3']);
  });

  it('sucht ohne Beachtung der Groß-/Kleinschreibung in "Nachname Vorname"', () => {
    expect(filterSelectableMembers(members, [], 'bauer c').map((m) => m.id)).toEqual(['3']);
    expect(filterSelectableMembers(members, [], '  HUBER ').map((m) => m.id)).toEqual(['1']);
  });

  it('liefert bei leerer Suche alle nicht ausgeschlossenen', () => {
    expect(filterSelectableMembers(members, [], '')).toHaveLength(3);
  });
});
```

Run: `npx vitest run src/components/heimatfeuerwehr/member-tile-select.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 2: `member-tile-select.tsx` schreiben**

```tsx
'use client';

import { useMemo, useState } from 'react';
import type { ReportMemberOption } from './member-search-select';

function memberName(member: ReportMemberOption): string {
  return `${member.lastName} ${member.firstName}`;
}

/** Reine Filterlogik: ohne bereits eingetragene Mitglieder, Suche in "Nachname Vorname". */
export function filterSelectableMembers(
  members: ReportMemberOption[],
  excludeIds: string[],
  search: string,
): ReportMemberOption[] {
  const needle = search.trim().toLowerCase();
  return members.filter((member) => !excludeIds.includes(member.id) && memberName(member).toLowerCase().includes(needle));
}

/**
 * Tablet-Variante von MemberMultiSelect (gleiche Schnittstelle): statt eines Popovers öffnet sich ein
 * Vollbild-Blatt mit großen Namenskacheln. Antippen wählt an/ab, "Fertig" bestätigt die ganze Auswahl
 * auf einmal (`onAdd` bekommt nur die neu gewählten Ids). Alle Tipp-Ziele mindestens 48 px.
 */
export function MemberTileSelect({
  members,
  excludeIds,
  onAdd,
  placeholder,
}: {
  members: ReportMemberOption[];
  excludeIds: string[];
  onAdd: (ids: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<string[]>([]);

  const available = useMemo(() => filterSelectableMembers(members, excludeIds, search), [members, excludeIds, search]);

  function toggle(id: string) {
    setPending((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }
  function close() {
    setPending([]);
    setSearch('');
    setOpen(false);
  }
  function commit() {
    if (pending.length > 0) onAdd(pending);
    close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[48px] items-center rounded-lg border border-dashed border-brand px-4 text-[15px] font-medium text-brand"
      >
        + {placeholder}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={placeholder}>
          <div className="flex items-center gap-3 border-b border-neutral-200 p-4">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Mitglied suchen …"
              className="min-h-[48px] flex-1 rounded-lg border border-neutral-300 px-4 text-base"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {available.length === 0 ? (
              <p className="py-8 text-center text-base text-neutral-400">Keine Treffer.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {available.map((member) => {
                  const checked = pending.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggle(member.id)}
                      className={`min-h-[56px] rounded-lg border px-3 py-2 text-left text-[15px] font-semibold ${
                        checked ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-[#1c1c1e]'
                      }`}
                    >
                      {checked ? '✓ ' : ''}
                      {memberName(member)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-neutral-200 p-4">
            <button type="button" onClick={close} className="min-h-[52px] rounded-lg border border-neutral-300 px-6 text-[15px] font-semibold">
              Abbrechen
            </button>
            <button type="button" onClick={commit} className="min-h-[52px] rounded-lg bg-brand px-8 text-[15px] font-semibold text-white">
              Fertig ({pending.length})
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

Run den Test aus Step 1: Expected PASS.

- [ ] **Step 3: Tablet-Tests im Assistenten-Test ergänzen** (ans Ende von `report-wizard.test.ts`)

```ts
describe('ReportWizard (Tablet-Layout)', () => {
  const tablet = {
    layout: 'tablet' as const,
    tabletHeader: { title: 'Tätigkeitsbericht', subtitle: 'FF Wolfsgraben · Ausfüller: Anna Huber' },
  };

  it('rendert eine eigene Seite mit Schrittleiste, ohne die feste Handy-Leiste', () => {
    const html = render(tablet);
    expect(html).toContain('data-layout="tablet"');
    expect(html).toContain('Grunddaten');
    expect(html).toContain('Fahrzeuge / Mitglieder');
    expect(html).toContain('Abschluss');
    expect(html).toContain('FF Wolfsgraben · Ausfüller: Anna Huber');
    expect(html).not.toContain('pb-safe-tabbar');
    expect(html).not.toContain('Schritt 1 von');
  });

  it('zeigt bei einem Übungsbericht zusätzlich den Schritt Übungsdetails', () => {
    expect(render({ ...tablet, type: 'EXERCISE' })).toContain('Übungsdetails');
    expect(render(tablet)).not.toContain('Übungsdetails');
  });

  it('sperrt "Weiter", solange Eigene Tätigkeit und Tätigkeitsart fehlen', () => {
    expect(render(tablet)).toMatch(/<button[^>]*disabled=""[^>]*>Weiter<\/button>/);
  });

  it('blendet mit lockFilledBy die Auswahl "Ausgefüllt von" aus, sonst zeigt sie sie', () => {
    expect(render({ ...tablet, lockFilledBy: true })).not.toContain('Ausgefüllt von');
    expect(render(tablet)).toContain('Ausgefüllt von');
  });

  it('bietet am Tablet statt des Abbrechen-Links die Abbrechen-Schaltfläche (onCancel) im Fuß', () => {
    const html = render({ ...tablet, onCancel: () => undefined });
    expect(html).toContain('Abbrechen');
    expect(html).not.toContain('href="/meine-feuerwehr"');
  });
});
```

Run: `npx vitest run "src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.test.ts"`
Expected: die fünf neuen Tests FAIL, die drei aus Aufgabe 5 PASS.

- [ ] **Step 4: Assistent umbauen: Schrittinhalte in Konstanten ziehen** (Edits in `report-wizard.tsx`)

Zeilenangaben beziehen sich auf den Stand nach Aufgabe 5 (± wenige Zeilen). Ziel: Der **Inhalt jedes Schritts ohne die feste Handy-Leiste** wird in eine Konstante verschoben und im Handy-Zweig nur referenziert. Der Handy-DOM bleibt dabei identisch.

1. Direkt unter `const [step, setStep] = useState(1);` (alle Hooks müssen vor dem späteren `if (layout === 'tablet') return` stehen) einfügen:

```tsx
  const [maxStep, setMaxStep] = useState(1);
  function goTo(next: number) {
    setStep(next);
    setMaxStep((current) => Math.max(current, next));
  }
```

   und die beiden bestehenden Funktionen `goToStep1Next` und `goToNextStep` (weiter unten, bisher mit `setStep((current) => ...)`) ersetzen durch:

```tsx
  function goToStep1Next() {
    if (!canContinueStep1) return;
    goTo(step + 1);
  }
  function goToNextStep() {
    goTo(Math.min(step + 1, totalSteps));
  }
```

2. `MemberRow` bekommt `large`:

```tsx
function MemberRow({ entry, members, onFunktionChange, onRemove, large = false }: { ...bisherige Typen..., large?: boolean }) {
  ...
      <button
        type="button"
        onClick={() => onRemove(entry.userId)}
        className={large ? 'min-h-[48px] min-w-[48px] text-xl text-red-700' : 'text-red-700'}
      >
        ×
      </button>
```

3. Schritt-1-Karten in `const step1Cards = (<> ... </>);` verschieben: Das sind die vier Karten **und** der `{pickerOpen && <ActivityKindPicker ... />}`-Block innerhalb von `{step === 1 && ( <> ... </> )}` — **alles vor** `<div className="pb-safe-tabbar fixed ...">`. Die erste Karte ("Ausgefüllt von") wird dabei mit `lockFilledBy` geschützt:

```tsx
          {!lockFilledBy && (
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">Ausgefüllt von</label>
              <MemberSearchSelect members={members} value={filledById} onChange={setFilledById} placeholder="Mitglied wählen" />
            </div>
          )}
```

   Im Handy-Zweig steht danach `{step === 1 && (<>{step1Cards}<div className="pb-safe-tabbar ...">...</div></>)}` (Leiste unverändert).

4. Analog `const uebungCards = (<>...</>)` (alles in `{isExercise && step === 2 && (...)}` vor der Leiste) und `const abschlussCards = (<>...</>)` (alles in `{step === stepAbschluss && (...)}` vor der Leiste, **einschließlich** der Zeile `{error && <p className="text-sm text-red-700">{error}</p>}`). Im Handy-Zweig jeweils nur `{uebungCards}` bzw. `{abschlussCards}` plus die unveränderte Leiste.

5. Die Fahrzeuge/Mitglieder-Karten des Handys (beide Karten "Fahrzeuge" und "Ohne Fahrzeug", alles vor der Leiste in `{step === stepFahrzeuge && (...)}`) als `const fahrzeugeCards = (<>...</>)`, Handy-Zweig wie oben.

6. An drei Karten das Attribut `data-wide` ergänzen (im Handy ohne Wirkung): die "Bemerkung"-Karte, die `{error && ...}`-Zeile (`<p data-wide className="text-sm text-red-700">`) und die Karte "Verbrauchsmaterial".

- [ ] **Step 5: Tablet-Fahrzeugkarten und Tablet-Gerüst ergänzen** (in `report-wizard.tsx`, nach den Konstanten aus Step 4, vor dem `return`)

```tsx
  const fahrzeugeTabletCards = (
    <>
      <div data-wide className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-[13px] font-medium text-[#1c1c1e]">Fahrzeuge</label>
        <div className="grid grid-cols-4 gap-3">
          {vehicles.map((vehicle) => {
            const selected = vehicleEntries.some((entry) => entry.vehicleId === vehicle.id);
            return (
              <button
                key={vehicle.id}
                type="button"
                aria-pressed={selected}
                onClick={() => (selected ? removeVehicle(vehicle.id) : addVehicle(vehicle.id))}
                className={`min-h-[56px] rounded-lg border px-3 py-2 text-[15px] font-semibold ${
                  selected ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-[#1c1c1e]'
                }`}
              >
                {vehicle.taktischeBezeichnung}
                <span className="block text-xs font-normal opacity-80">{vehicle.kennzeichen}</span>
              </button>
            );
          })}
        </div>
      </div>

      {vehicleEntries.map((entry) => {
        const vehicle = vehicles.find((v) => v.id === entry.vehicleId);
        const vehicleMembers = reportMembers.filter((m) => m.vehicleId === entry.vehicleId);
        return (
          <div key={entry.vehicleId} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="mb-2 text-[15px] font-semibold text-[#1c1c1e]">
              {vehicle ? `${vehicle.taktischeBezeichnung} (${vehicle.kennzeichen})` : entry.vehicleId}
            </div>
            <label className="mb-1 block text-[13px] font-medium text-[#1c1c1e]">km</label>
            <input
              type="number"
              inputMode="numeric"
              value={entry.km}
              onChange={(e) => setVehicleKm(entry.vehicleId, e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
            <div className="mt-3 flex flex-col gap-2">
              {vehicleMembers.map((memberEntry) => (
                <MemberRow key={memberEntry.userId} entry={memberEntry} members={members} onFunktionChange={setMemberFunktion} onRemove={removeMember} large />
              ))}
            </div>
            <div className="mt-3">
              <MemberTileSelect
                members={members}
                excludeIds={reportMembers.map((m) => m.userId)}
                onAdd={(ids) => addMembers(entry.vehicleId, ids)}
                placeholder="Mitglied hinzufügen"
              />
            </div>
          </div>
        );
      })}

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-2 text-[15px] font-semibold text-[#1c1c1e]">Ohne Fahrzeug</div>
        <div className="flex flex-col gap-2">
          {reportMembers
            .filter((entry) => entry.vehicleId === null)
            .map((entry) => (
              <MemberRow key={entry.userId} entry={entry} members={members} onFunktionChange={setMemberFunktion} onRemove={removeMember} large />
            ))}
        </div>
        <div className="mt-3">
          <MemberTileSelect
            members={members}
            excludeIds={reportMembers.map((entry) => entry.userId)}
            onAdd={(ids) => addMembers(null, ids)}
            placeholder="Mitglied hinzufügen"
          />
        </div>
      </div>
    </>
  );

  const stepLabels = isExercise
    ? ['Grunddaten', 'Übungsdetails', 'Fahrzeuge / Mitglieder', 'Abschluss']
    : ['Grunddaten', 'Fahrzeuge / Mitglieder', 'Abschluss'];

  if (layout === 'tablet') {
    const content = step === 1 ? step1Cards : isExercise && step === 2 ? uebungCards : step === stepFahrzeuge ? fahrzeugeTabletCards : abschlussCards;
    const isLast = step === totalSteps;
    const primaryDisabled = step === 1 ? !canContinueStep1 : isLast ? submitting : false;
    const primaryLabel = isLast ? (submitting ? 'Wird abgegeben …' : 'Bericht abgeben') : 'Weiter';
    const primaryAction = step === 1 ? goToStep1Next : isLast ? handleSubmit : goToNextStep;

    return (
      <div
        data-layout="tablet"
        className="flex h-[100dvh] flex-col bg-[#f6f6f7] text-[#1c1c1e] [&_input]:min-h-[48px] [&_input]:text-base [&_select]:min-h-[48px] [&_select]:text-base [&_textarea]:text-base"
      >
        <header className="pt-safe flex items-center justify-between bg-[#1c1c1e] px-6 py-3 text-white">
          <span className="text-base font-semibold">{tabletHeader?.title ?? REPORT_TYPE_LABEL[type]}</span>
          {tabletHeader?.subtitle && <span className="text-sm opacity-80">{tabletHeader.subtitle}</span>}
        </header>
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Schritte" className="flex w-60 shrink-0 flex-col gap-2 border-r border-neutral-200 bg-white p-4">
            {stepLabels.map((label, index) => {
              const n = index + 1;
              const current = n === step;
              const done = n < step;
              return (
                <button
                  key={label}
                  type="button"
                  disabled={current || n > maxStep}
                  aria-current={current ? 'step' : undefined}
                  onClick={() => setStep(n)}
                  className={`flex min-h-[52px] items-center rounded-full px-4 text-left text-[15px] font-semibold ${
                    current ? 'bg-[#1c1c1e] text-white' : done ? 'bg-green-100 text-[#1c1c1e]' : 'bg-neutral-200 text-neutral-600'
                  }`}
                >
                  {done ? '✓ ' : `${n} `}
                  {label}
                </button>
              );
            })}
          </nav>
          <main className="min-w-0 flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 items-start gap-5 [&>[data-wide]]:col-span-2">{content}</div>
          </main>
        </div>
        <footer
          className="flex items-center justify-between gap-4 border-t border-neutral-200 bg-white px-6 pt-3"
          style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}
        >
          {step === 1 ? (
            onCancel ? (
              <button type="button" onClick={onCancel} className="min-h-[52px] rounded-lg border border-neutral-300 px-6 text-[15px] font-semibold">
                Abbrechen
              </button>
            ) : (
              <Link href="/meine-feuerwehr" className="flex min-h-[52px] items-center rounded-lg border border-neutral-300 px-6 text-[15px] font-semibold">
                Abbrechen
              </Link>
            )
          ) : (
            <button type="button" onClick={goBack} className="min-h-[52px] rounded-lg border border-neutral-300 px-6 text-[15px] font-semibold">
              ← Zurück
            </button>
          )}
          <button
            type="button"
            disabled={primaryDisabled}
            onClick={primaryAction}
            className={`min-h-[52px] rounded-lg px-10 text-[15px] font-semibold text-white ${primaryDisabled ? 'bg-neutral-300' : 'bg-brand'}`}
          >
            {primaryLabel}
          </button>
        </footer>
      </div>
    );
  }
```

   Die Zeile `void layout; void tabletHeader; void lockFilledBy;` aus Aufgabe 5 **entfernen** (`layout`, `tabletHeader`, `lockFilledBy` werden jetzt gelesen). `MemberTileSelect` importieren: `import { MemberTileSelect } from '@/components/heimatfeuerwehr/member-tile-select';`.

   Hinweis zur Abgabe: `handleSubmit` bricht bei leerer Bemerkung schon selbst ab (`if (remark.trim().length === 0) return;`); die rote Markierung der Bemerkung bleibt sichtbar, die Schaltfläche ist am letzten Schritt nur während des Absendens gesperrt, genau wie am Handy.

- [ ] **Step 6: Tests grün**

Run: `npx vitest run "src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.test.ts" src/components/heimatfeuerwehr/member-tile-select.test.ts`
Expected: PASS (alle 8 Assistenten-Tests, 3 Kachel-Tests).

Falls ein Tablet-Test wegen des Textes in `renderToStaticMarkup` scheitert (z. B. React fügt `<!-- -->` zwischen `{done ? '✓ ' : ...}` und `{label}` ein): die Test-Erwartungen so anpassen, dass sie die Beschriftung innerhalb des Buttons per Teilstring `Fahrzeuge / Mitglieder` finden (die Beschriftung selbst steht in einem eigenen Textknoten) - das Produktivverhalten nicht ändern.

- [ ] **Step 7: Typen, Gesamttests, Commit**

```bash
npx tsc --noEmit
npm test
git add src/components/heimatfeuerwehr/member-tile-select.tsx src/components/heimatfeuerwehr/member-tile-select.test.ts \
  "src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.tsx" "src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.test.ts"
git commit -m "feat: Tablet-Layout des Berichts-Assistenten (Schrittleiste, zwei Spalten, Kachelauswahl)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Öffentliche Seite mit Ablauf (Namenswahl, Art, Assistent, Bestätigung)

**Files:**
- Create: `src/app/berichte-schnell/[token]/page.tsx`, `kiosk-flow.tsx`, `kiosk-flow.test.ts`

**Interfaces:**
- Consumes: `loadKioskData`, `submitReportViaKiosk`, `ReportWizard` (Task 5/6), `ACTIVE_REPORT_TYPES`, `REPORT_TYPE_LABEL`
- Produces: `<KioskFlow token organizationName members vehicles recentKindsByType />`

- [ ] **Step 1: Test für die Namenswahl schreiben (`kiosk-flow.test.ts`)**

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: (props: { href: string; children?: unknown }) => createElement('a', { href: props.href }, props.children as never),
}));
vi.mock('./actions', () => ({ submitReportViaKiosk: vi.fn() }));
vi.mock('@/app/(app)/meine-feuerwehr/berichte/submit-actions', () => ({ submitReport: vi.fn() }));

import { KioskFlow } from './kiosk-flow';

const props = {
  token: 't'.repeat(32),
  organizationName: 'FF Wolfsgraben',
  members: [
    { id: '1', firstName: 'Bernd', lastName: 'Bauer' },
    { id: '2', firstName: 'Anna', lastName: 'Huber' },
  ],
  vehicles: [],
  recentKindsByType: { ACTIVITY: [], EXERCISE: [], INCIDENT: [] },
};

describe('KioskFlow', () => {
  it('beginnt mit der Namenswahl der Feuerwehr, in der übergebenen Reihenfolge', () => {
    const html = renderToStaticMarkup(createElement(KioskFlow, props));
    expect(html).toContain('FF Wolfsgraben');
    expect(html).toContain('Wer schreibt den Bericht?');
    expect(html.indexOf('Bauer Bernd')).toBeGreaterThan(-1);
    expect(html.indexOf('Bauer Bernd')).toBeLessThan(html.indexOf('Huber Anna'));
  });

  it('zeigt am Anfang noch keine Berichtsart und keinen Assistenten', () => {
    const html = renderToStaticMarkup(createElement(KioskFlow, props));
    expect(html).not.toContain('Welcher Bericht?');
    expect(html).not.toContain('data-layout="tablet"');
  });
});
```

Run: Expected FAIL (Modul `./kiosk-flow` fehlt).

- [ ] **Step 2: `kiosk-flow.tsx` schreiben**

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { ReportWizard } from '@/app/(app)/meine-feuerwehr/berichte/neu/report-wizard';
import { ACTIVE_REPORT_TYPES, REPORT_TYPE_LABEL } from '@/lib/heimatfeuerwehr/report-constants';
import type { ReportType } from '@prisma/client';
import { submitReportViaKiosk } from './actions';

export interface KioskFlowProps {
  token: string;
  organizationName: string;
  members: { id: string; firstName: string; lastName: string }[];
  vehicles: { id: string; taktischeBezeichnung: string; kennzeichen: string }[];
  recentKindsByType: Record<string, string[]>;
}

type Phase =
  | { phase: 'name' }
  | { phase: 'type'; filledById: string }
  | { phase: 'wizard'; filledById: string; type: ReportType; run: number }
  | { phase: 'done'; number?: number; year?: number };

const REPORT_TYPES = ['ACTIVITY', 'EXERCISE', 'INCIDENT'] as const;
const DONE_RESET_MS = 30_000;

/**
 * Ablauf der iPad-Schnellerfassung als reiner Client-Zustand: Namenswahl -> Berichtsart -> Assistent ->
 * Bestätigung -> (nach 30 s oder "Neuer Bericht") zurück zur Namenswahl. Damit bleibt keine Person auf
 * dem gemeinsamen Gerät "angemeldet", und die Eingaben der Vorgängerin sind weg (der Assistent hält
 * seinen Zustand nur im Browser-Speicher und wird bei jedem Lauf neu eingehängt).
 */
export function KioskFlow({ token, organizationName, members, vehicles, recentKindsByType }: KioskFlowProps) {
  const [state, setState] = useState<Phase>({ phase: 'name' });
  const [run, setRun] = useState(0);
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<'mobile' | 'tablet'>('tablet');

  // Ab 1024 px das Tablet-Layout, darunter fällt der Assistent auf das Handy-Layout zurück.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const apply = () => setLayout(query.matches ? 'tablet' : 'mobile');
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  // Nach der Bestätigung automatisch zurück zur Namenswahl.
  useEffect(() => {
    if (state.phase !== 'done') return;
    const timer = setTimeout(() => reset(), DONE_RESET_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  function reset() {
    setSearch('');
    setState({ phase: 'name' });
  }

  const filteredMembers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((member) => `${member.lastName} ${member.firstName}`.toLowerCase().includes(needle));
  }, [members, search]);

  if (state.phase === 'wizard') {
    const filledBy = members.find((member) => member.id === state.filledById);
    const wizard = (
      <ReportWizard
        key={state.run}
        type={state.type}
        filledById={state.filledById}
        members={members}
        vehicles={vehicles}
        recentActivityKinds={recentKindsByType[state.type] ?? []}
        layout={layout}
        lockFilledBy
        tabletHeader={{
          title: `${REPORT_TYPE_LABEL[state.type]} · ${organizationName}`,
          subtitle: filledBy ? `Ausfüller: ${filledBy.firstName} ${filledBy.lastName}` : undefined,
        }}
        onSubmit={(payload) => submitReportViaKiosk(token, payload)}
        onDone={(result) => setState({ phase: 'done', number: result.number, year: result.year })}
        onCancel={reset}
      />
    );
    return layout === 'tablet' ? wizard : <div className="pt-safe mx-auto max-w-lg px-4 py-4">{wizard}</div>;
  }

  return (
    <div className="pt-safe flex min-h-[100dvh] flex-col bg-[#f6f6f7] text-[#1c1c1e]">
      <header className="bg-[#1c1c1e] px-6 py-3 text-white">
        <span className="text-base font-semibold">{organizationName}</span>
        <span className="ml-3 text-sm opacity-80">Berichte erfassen</span>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        {state.phase === 'name' && (
          <>
            <h1 className="mb-4 text-2xl font-bold">Wer schreibt den Bericht?</h1>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name suchen …"
              className="mb-5 min-h-[52px] w-full rounded-lg border border-neutral-300 bg-white px-4 text-base"
            />
            {filteredMembers.length === 0 ? (
              <p className="py-8 text-center text-base text-neutral-500">Keine Treffer.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 lg:grid-cols-4">
                {filteredMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => setState({ phase: 'type', filledById: member.id })}
                    className="min-h-[64px] rounded-xl border border-neutral-300 bg-white px-4 py-3 text-left text-[16px] font-semibold shadow-sm"
                  >
                    {member.lastName} {member.firstName}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {state.phase === 'type' && (
          <>
            <h1 className="mb-4 text-2xl font-bold">Welcher Bericht?</h1>
            <div className="grid grid-cols-3 gap-4">
              {REPORT_TYPES.map((type) => {
                const active = ACTIVE_REPORT_TYPES.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={!active}
                    onClick={() => {
                      setRun((current) => current + 1);
                      setState({ phase: 'wizard', filledById: state.filledById, type, run: run + 1 });
                    }}
                    className={`min-h-[96px] rounded-xl px-4 py-6 text-lg font-semibold shadow-sm ${
                      active ? 'bg-brand text-white' : 'bg-neutral-200 text-neutral-400'
                    }`}
                  >
                    {REPORT_TYPE_LABEL[type]}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={reset} className="mt-6 min-h-[52px] rounded-lg border border-neutral-300 bg-white px-6 text-[15px] font-semibold">
              ← Zurück
            </button>
          </>
        )}

        {state.phase === 'done' && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <h1 className="text-3xl font-bold">Bericht abgegeben</h1>
            {state.number !== undefined && state.year !== undefined && (
              <p className="text-lg text-neutral-600">
                Nr. {state.number} / {state.year}
              </p>
            )}
            <button type="button" onClick={reset} className="mt-4 min-h-[56px] rounded-lg bg-brand px-10 text-[16px] font-semibold text-white">
              Neuer Bericht
            </button>
            <p className="text-sm text-neutral-400">Der Bildschirm wechselt nach 30 Sekunden von selbst zurück.</p>
          </div>
        )}
      </main>
    </div>
  );
}
```

Hinweis: In der Berichtsart-Kachel wird `run` hochgezählt, damit jeder Lauf einen neuen `key` bekommt und der Assistent mit leerem Zustand startet. Falls `tsc` über die doppelte Verwendung von `run`/`setRun` klagt, `run` direkt in `setState`-Callback berechnen: `setRun((c) => c + 1)` und im selben Handler `const nextRun = run + 1;` für den `state` verwenden.

Run den Test aus Step 1: Expected PASS.

- [ ] **Step 3: Seite (`page.tsx`)**

```tsx
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { loadKioskData } from '@/lib/heimatfeuerwehr/report-kiosk-data';
import { KioskFlow } from './kiosk-flow';

export const metadata: Metadata = {
  title: 'Berichte erfassen',
  robots: { index: false, follow: false },
};

// Kein Zoomen per Doppeltipp am gemeinsamen Gerät; Farbe und Sicherheitsbereiche wie im Rest der App.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#1c1c1e',
};

// Immer frisch: ein abgeschalteter oder neu erzeugter Link muss sofort 404 liefern.
export const dynamic = 'force-dynamic';

/** Öffentliche iPad-Schnellerfassung. Unbekannter, abgeschalteter oder neu erzeugter Link: 404. */
export default async function BerichteSchnellPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadKioskData(token);
  if (!data) notFound();

  return (
    <KioskFlow
      token={token}
      organizationName={data.organization.name}
      members={data.members}
      vehicles={data.vehicles}
      recentKindsByType={data.recentKindsByType}
    />
  );
}
```

- [ ] **Step 4: Typen, Tests, Commit**

```bash
npx tsc --noEmit
npm test
git add "src/app/berichte-schnell/[token]/page.tsx" "src/app/berichte-schnell/[token]/kiosk-flow.tsx" "src/app/berichte-schnell/[token]/kiosk-flow.test.ts"
git commit -m "feat: öffentliche Seite der Berichte-Schnellerfassung (Namenswahl, Berichtsart, Assistent, Bestätigung)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Dokumentation, Gesamtprüfung und Browser-Check

**Files:**
- Modify: `src/app/(app)/meine-feuerwehr/CLAUDE.md` (neuer Abschnitt nach "Tätigkeitsbericht / Übungsbericht", vor "### Fahrzeug reservieren")
- Modify: `CLAUDE.md` (Wurzel, Abschnitt "Route groups")
- Modify: `docs/superpowers/specs/2026-11-14-berichte-schnellerfassung-ipad-design.md` (Nachtrag)

- [ ] **Step 1: Abschnitt in `src/app/(app)/meine-feuerwehr/CLAUDE.md` einfügen** (direkt vor der Zeile `### Fahrzeug reservieren (neuer Einstieg, Fahrzeug-Statuskacheln)`)

```markdown
### Berichte-Schnellerfassung am iPad (`/berichte-schnell/[token]`)

Gemeinsames iPad im Feuerwehrhaus (Querformat), Berichte ohne Anmeldung. Spec:
`docs/superpowers/specs/2026-11-14-berichte-schnellerfassung-ipad-design.md`, Plan:
`docs/superpowers/plans/2026-11-14-berichte-schnellerfassung-ipad.md`.

- **Link je Feuerwehr:** `Organization.reportKioskToken` (nullable, unique, Klartext wie `icsToken`; null = aus, jede Feuerwehr
  startet aus). Erzeugen, neu erzeugen (alter Link sofort ungültig) und abschalten in `/admin/heimatfeuerwehr`
  (Karte "Berichte-Schnellerfassung (iPad)", `report-kiosk-card.tsx`/`report-kiosk-actions.ts`, Recht
  `canManageHeimatfeuerwehrFor`). Logik und Tests in `lib/heimatfeuerwehr/report-kiosk-token.ts` (nur aktive `FEUERWEHR`).
- **Öffentlich wie `/drohnen-schnell`:** eigenes oberstes Segment, Eintrag in `PUBLIC_PATH_PREFIXES`. Unbekannter,
  abgeschalteter, neu erzeugter Link oder deaktivierte Feuerwehr: 404 (`loadKioskData` -> `notFound()`).
- **Ersteller = technischer Platzhalter** `berichte-schnellerfassung@system.local` (`report-kiosk-user.ts`, `isActive: false`,
  Heimat = irgendein Abschnittskommando, nie in einer Feuerwehr-Mitgliederliste). `Report.filledById` ist die gewählte Person,
  sie sieht den Bericht deshalb unter "Meine Berichte". Wer den Link hat, kann Berichte unter dem Namen jedes aktiven
  Mitglieds anlegen - bewusste Entscheidung ("nur Name wählen").
- **Geteilter Kern:** `lib/heimatfeuerwehr/submit-report-core.ts` (`submitReportCore`) enthält die gesamte Prüfung, das Anlegen,
  PDF, S3 und E-Mail. `submitReport` (App, Sitzung) und `submitReportForKiosk` (Link, `report-kiosk-submit.ts`) rufen ihn auf.
  Die Kiosk-Abgabe löst den Link bei JEDER Abgabe neu auf, nimmt die Feuerwehr nur aus dem Link und zählt das Limit
  (20/Stunde/Link, `checkRateLimit` aus `lib/mcp/rate-limit.ts`) erst NACH der Linkprüfung. Die Server Action
  `submitReportViaKiosk` ist dünn.
- **Seitendaten** (`report-kiosk-data.ts`): nur Id und Name der aktiven Mitglieder, aktive Fahrzeuge, "Zuletzt verwendet" je
  Berichtsart über die ganze Feuerwehr (nicht je Person, weil das Gerät gemeinsam genutzt wird).
- **Assistent geteilt, nicht kopiert:** `ReportWizard` hat optionale Props `layout` ('mobile' Standard | 'tablet'), `onSubmit`,
  `onDone`, `onCancel`, `tabletHeader`, `lockFilledBy`. Ohne sie verhält er sich exakt wie in der App (Charakterisierungstests in
  `report-wizard.test.ts`). `layout='tablet'` rendert eine ganze Seite (Kopf, Schrittleiste links, zwei Spalten, feste untere
  Leiste, Tipp-Ziele >= 48 px); Fahrzeuge und Mitglieder erscheinen als Kacheln (`MemberTileSelect` statt Popover).
- **Berichtsarten:** wie in der App nur die in `ACTIVE_REPORT_TYPES` freigeschalteten (Tätigkeits- und Übungsbericht); der
  Einsatzbericht erscheint ausgegraut und zieht mit der App nach.
- **Ablauf** (`kiosk-flow.tsx`, reiner Client-Zustand): Namenswahl -> Berichtsart -> Assistent -> Bestätigung -> nach 30 s oder
  "Neuer Bericht" zurück zur Namenswahl (keine Person bleibt "angemeldet"). Ab 1024 px Fensterbreite Tablet-Layout, darunter das
  Handy-Layout.
- **Nicht geprüft in der Entwicklungsumgebung:** Hydration/Interaktion (derselbe Gap wie sonst in dieser Datei). Der ganze Ablauf
  muss auf einem echten iPad durchgeklickt werden; offen ist, ob "Zum Home-Bildschirm" auf iOS den geheimen Link öffnet.
```

- [ ] **Step 2: Wurzel-`CLAUDE.md`, Abschnitt "Route groups"**: nach dem Punkt zu `src/app/drohnen-schnell/[token]/*` (endet mit "...(new top-level segment + `PUBLIC_PATH_PREFIXES` entry) for any future no-login, capability-URL page.") einen Punkt ergänzen:

```markdown
- `src/app/berichte-schnell/[token]/*` — the fourth top-level, session-less capability-URL segment (iPad quick capture of
  Tätigkeits-/Übungs-/Einsatzberichte, one secret link per Feuerwehr in `Organization.reportKioskToken`, off by default);
  listed in `PUBLIC_PATH_PREFIXES`. Details in `src/app/(app)/meine-feuerwehr/CLAUDE.md` ("Berichte-Schnellerfassung am iPad").
```

- [ ] **Step 3: Spec-Nachtrag** (am Ende von Abschnitt 4 der Spec, nach der Beschreibung der `MemberTileSelect`)

```markdown
**Nachtrag (Umsetzungsplan):** Zusätzlich zu den vier genannten Props bekommt der Assistent `tabletHeader?: { title; subtitle? }`
(Kopfzeile des Tablet-Layouts) und `lockFilledBy?: boolean` (blendet "Ausgefüllt von" aus, weil die Person am Kiosk schon gewählt
ist). `SubmitReportResult` und `onDone` tragen zusätzlich `year`, damit die Bestätigung "Nr. 12 / 2026" zeigen kann.

**Nachtrag (Berichtsarten):** Der Einsatzbericht ist in der App noch nicht freigeschaltet (`ACTIVE_REPORT_TYPES` =
Tätigkeits- und Übungsbericht). Die Schnellerfassung übernimmt das: Der Einsatzbericht erscheint am iPad als ausgegraute,
nicht antippbare Kachel und wird mit der App zusammen freigeschaltet, sobald er dort aktiv wird.
```

- [ ] **Step 4: Gesamtprüfung** (lokale Datenbank muss laufen)

```bash
npx tsc --noEmit
npm test
npm run test:db
npm run build
```

Expected: alle grün. Bei Fehlern in `.next/types` nach dem Branchwechsel `npm run build` erneut laufen lassen, bevor `tsc` bewertet wird.

- [ ] **Step 5: Browser-Prüfung der Seite (nur serverseitig gerendert)**

1. Lokalen Link anlegen (Datenbank lokal, nie Dev/Prod): im Repo-Root `npx tsx -e "import { prisma } from './src/lib/db/prisma'; import { setReportKioskToken } from './src/lib/heimatfeuerwehr/report-kiosk-token'; (async () => { const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR', isActive: true } }); console.log('/berichte-schnell/' + await setReportKioskToken(org.id)); await prisma.\$disconnect(); })();"` — gibt den Pfad aus (der Link ist ein lokaler Testwert).
2. `preview_start` mit `app-177-dev`, danach die Seite mit dem Pfad aus Schritt 1 öffnen, ohne angemeldet zu sein (privates Fenster/ausgeloggt): Es darf **keine** Weiterleitung auf `/login` geben.
3. `resize_window` auf 1180×820 und `screenshot`: Namenswahl mit Kacheln, Suchfeld, Kopfleiste mit Feuerwehrname.
4. Einen ungültigen Pfad `/berichte-schnell/<32 beliebige Zeichen>` öffnen: 404-Seite.
5. `resize_window` zurück auf `desktop`. Link lokal wieder entfernen: `npx tsx -e` mit `clearReportKioskToken(org.id)` für dieselbe Feuerwehr.
6. Ergebnis (Screenshot und 404) im Bericht festhalten. Die Interaktion (Namen antippen, Assistent) und das Tablet-Layout im Browser sind in dieser Umgebung wegen fehlender Hydration **nicht** prüfbar; dafür stehen die Render-Tests aus Aufgabe 5 bis 7. Das Durchklicken am echten iPad macht der App-Betreiber.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/CLAUDE.md" CLAUDE.md docs/superpowers/specs/2026-11-14-berichte-schnellerfassung-ipad-design.md
git commit -m "docs: Berichte-Schnellerfassung am iPad dokumentiert

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Spec-Abdeckung

| Spec-Abschnitt | Aufgabe |
|---|---|
| 1 Datenmodell, Link, Verwaltung, Route, technischer Ersteller | 1, 4, 7 |
| 2 Ablauf (Namenswahl, Art, Assistent, Bestätigung, "Zuletzt verwendet" je Feuerwehr) | 2, 3, 7 |
| 3 Abgabe und Sicherheit (geteilter Kern, Link-Neuprüfung, Limit, Zugehörigkeitsprüfungen) | 2, 3 |
| 4 Layout A und Assistent-Anpassung | 5, 6 |
| 5 Dateien | Datei-Übersicht oben |
| 6 Tests und Prüfung | je Aufgabe, 8 |
| 7 Rollout | nach Abschluss: DEV, dann PROD (Befehle gibt der Betreiber-Dialog, nicht der Plan) |
| Offene Punkte (Home-Bildschirm, Kachelgrößen) | Aufgabe 8 (Doku), Prüfung am echten iPad |
