# Kiosk-Startbildschirm und Berichtsarten je Feuerwehr Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der iPad-Kiosk bekommt einen Startbildschirm "Welches Formular ausfüllen?" mit fünf Kacheln in den App-Farben; Tätigkeits- und Übungsbericht lassen sich je Feuerwehr einzeln ein-/ausschalten (App und iPad) und haben je eine eigene E-Mail-Empfängerliste; der Kopf zeigt einen einstellbaren Gerätenamen sowie Datum und Uhrzeit.

**Architecture:** Neue Tabelle `ReportTypeSetting` (je Feuerwehr und Berichtsart `enabled` + `recipients`), gelesen über `src/lib/heimatfeuerwehr/report-type-settings.ts`. Der geteilte Abgabe-Kern `submitReportCore` prüft als erstes, ob die Berichtsart verfügbar ist, und nimmt die E-Mail-Empfänger aus der Zeile der Berichtsart. Die App (Berichtsauswahl, `neu`-Seite) und der Kiosk lesen dieselben Einstellungen. Der Kiosk-Ablauf wird zu Formular → Name → Assistent → Bestätigung.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 6 (PostgreSQL), Tailwind 3, vitest 5, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-15-kiosk-startbildschirm-berichtsarten-design.md` (vom App-Betreiber freigegeben).

**Abweichung von der Spec (bewusst):** Die Spec beschreibt eine Migration. Damit jeder Commit baut, wird sie in **zwei** Migrationsordner geteilt, die zusammen ausgerollt werden: Migration A (Aufgabe 1) legt die Tabelle an, kopiert die alten Empfänger und fügt die Spalte `reportKioskDeviceName` hinzu; Migration B (Aufgabe 4) löscht `Organization.reportRecipients`, erst nachdem kein Code die Spalte mehr liest. Das Ergebnis ist dasselbe.

## Global Constraints

- Alle sichtbaren Texte deutsch. Code-Bezeichner: deutsch/englisch gemischt, in jeder Datei der dortigen Konvention folgen.
- **Git:** Arbeit auf Branch `feature/kiosk-startbildschirm` (von `main`; der Controller legt ihn vor Aufgabe 1 an). Pro Aufgabe ein Commit mit **ausdrücklich genannten Dateien** (`git add <pfad> ...`), **nie** `git add -A`/`git add .`. `android/`, jede `AGENTS.md`, `docs/agents/` und `.superpowers/` nie committen. **Nie pushen.** Commit-Nachricht deutsch, Endzeile: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Zeilenenden:** Arbeitsbaum CRLF, Index LF (`core.autocrlf=true`). Bestehende Dateien nur per Edit-Werkzeug ändern, neue Dateien mit LF anlegen. `git diff --cached --stat` darf kein Ganzdatei-Rauschen zeigen.
- **Datenbank-Tests** (`*.db.test.ts`, `npm run test:db`) laufen **nur gegen die lokale Dev-Datenbank** (Docker-Container `app-177-postgres-1`, `DATABASE_URL` in `.env` zeigt auf localhost; nie Werte aus `.env` ausgeben). Fixtures mit eindeutigem Präfix (`const RUN = \`...-${Date.now()}\``), Aufräumen **geschützt** (nie ein `deleteMany`-Filter, der `undefined` sein kann; Id-Listen vorher auf Leere prüfen). Fixture-Organisationen räumen die Zeilen von `ReportTypeSetting` per `onDelete: Cascade` mit ab.
- **Migration:** nie `prisma migrate dev` (bekannter Reihenfolge-Fehler der Historie). Migrationsordner von Hand anlegen, lokal mit `npx prisma migrate deploy` anwenden, dann `npx prisma generate`. Bestehende Migrationen nie ändern. Keine `prisma migrate reset`.
- **Keine neue Umgebungsvariable, keine neue Abhängigkeit** (lucide-react ist schon vorhanden). `docker/docker-compose.yml` bleibt unverändert.
- **PDF/S3/E-Mail in Tests mocken** (`vi.mock`), damit die lokale `.env` nie echte Mails sendet oder in S3 schreibt (Muster siehe `src/lib/heimatfeuerwehr/submit-report-core.db.test.ts`).
- Nach jeder Aufgabe: `npx tsc --noEmit` muss sauber sein. In der letzten Aufgabe zusätzlich `npm test`, `npm run test:db`, `npm run build`.
- `ACTIVE_REPORT_TYPES` (`src/lib/heimatfeuerwehr/report-constants.ts`) bleibt `['ACTIVITY', 'EXERCISE']`. Der Einsatzbericht wird nicht freigeschaltet.
- Das Handy-Layout des Berichts-Assistenten und der PDF-/E-Mail-Inhalt ändern sich nicht.

## Datei-Übersicht

Neu:
- `prisma/migrations/20261115090000_report_type_setting/migration.sql` (Aufgabe 1)
- `prisma/migrations/20261115100000_drop_organization_report_recipients/migration.sql` (Aufgabe 4)
- `src/lib/heimatfeuerwehr/report-type-settings.ts` (+ `.test.ts`, `.db.test.ts`) (Aufgabe 1)
- `src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.test.ts` (Aufgabe 3)
- `src/app/(app)/admin/heimatfeuerwehr/report-type-row.tsx` (Aufgabe 4)
- `src/lib/heimatfeuerwehr/report-kiosk-device-name.ts` (+ `.test.ts`, `.db.test.ts`), `src/app/(app)/admin/heimatfeuerwehr/report-kiosk-device-name-form.tsx` (Aufgabe 5)
- `src/lib/heimatfeuerwehr/kiosk-tiles.ts` (+ `.test.ts`), `kiosk-clock.ts` (+ `.test.ts`) (Aufgabe 6)
- `src/app/berichte-schnell/[token]/kiosk-header.tsx`, `kiosk-form-screen.tsx` (Aufgabe 6)

Geändert:
- `prisma/schema.prisma` (Aufgaben 1 und 4)
- `src/lib/heimatfeuerwehr/submit-report-core.ts`, `report-kiosk-submit.ts`, `submit-report-core.db.test.ts` (Aufgabe 2)
- `src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.tsx`, `meine-feuerwehr/action-row.tsx`, `meine-feuerwehr/page.tsx`, `berichte/neu/page.tsx` (Aufgabe 3)
- `src/app/(app)/admin/heimatfeuerwehr/actions.ts`, `report-recipients-form.tsx`, `page.tsx` (Aufgaben 4 und 5), `report-kiosk-actions.ts` (Aufgabe 5)
- `src/lib/heimatfeuerwehr/report-kiosk-data.ts` (+ `.db.test.ts`) (Aufgabe 5)
- `src/app/berichte-schnell/[token]/kiosk-flow.tsx`, `kiosk-flow.test.ts`, `page.tsx` (Aufgabe 6)
- `src/app/(app)/meine-feuerwehr/CLAUDE.md` (Aufgabe 7)

---

### Task 1: Datenmodell (Migration A) und Einstellungs-Bibliothek

**Files:**
- Modify: `prisma/schema.prisma` (Modell `Organization`: Spalte und Relation; neues Modell `ReportTypeSetting`)
- Create: `prisma/migrations/20261115090000_report_type_setting/migration.sql`
- Create: `src/lib/heimatfeuerwehr/report-type-settings.ts`, `report-type-settings.test.ts`, `report-type-settings.db.test.ts`

**Interfaces:**
- Produces (`report-type-settings.ts`):
  - `interface ReportTypeSettingValue { enabled: boolean; recipients: string[] }`
  - `isActiveReportType(type: string): type is ReportType` (nur Arten aus `ACTIVE_REPORT_TYPES`)
  - `resolveReportTypeSettings(rows: { type: string; enabled: boolean; recipients: string[] }[]): Record<string, ReportTypeSettingValue>` (rein; Eintrag je Art aus `ACTIVE_REPORT_TYPES`, fehlende Zeile = `{ enabled: true, recipients: [] }`)
  - `pickReportType(typeParam: string | undefined | null, enabledTypes: readonly string[]): ReportType | null` (rein)
  - `getReportTypeSettings(organizationId): Promise<Record<string, ReportTypeSettingValue>>`
  - `getEnabledReportTypes(organizationId): Promise<ReportType[]>`
  - `isReportTypeEnabled(organizationId, type: string): Promise<boolean>` (nicht aktive Art: `false`, ohne Zeile: `true`)
  - `getReportRecipients(organizationId, type: string): Promise<string[]>`
  - `saveReportTypeEnabled(organizationId, type: string, enabled: boolean): Promise<void>` und `saveReportTypeRecipients(organizationId, type: string, recipients: string[]): Promise<void>` (je `upsert`; werfen für nicht aktive Art und für Organisationen, die keine `FEUERWEHR` sind)

- [ ] **Step 1: Branch prüfen**

Der Controller hat `feature/kiosk-startbildschirm` bereits angelegt und ausgecheckt. Prüfen: `git branch --show-current` zeigt `feature/kiosk-startbildschirm`. Die zwei Dateien `docs/superpowers/specs/2026-11-15-kiosk-startbildschirm-berichtsarten-design.md` und `docs/superpowers/plans/2026-11-15-kiosk-startbildschirm-berichtsarten.md` sind noch ungetrackt und kommen in den Commit dieser Aufgabe.

- [ ] **Step 2: Reinen Unit-Test schreiben (`report-type-settings.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { pickReportType, resolveReportTypeSettings } from './report-type-settings';

describe('resolveReportTypeSettings', () => {
  it('liefert für jede freigeschaltete Art einen Eintrag, ohne Zeile eingeschaltet und ohne Empfänger', () => {
    expect(resolveReportTypeSettings([])).toEqual({
      ACTIVITY: { enabled: true, recipients: [] },
      EXERCISE: { enabled: true, recipients: [] },
    });
  });

  it('übernimmt gespeicherte Zeilen je Art', () => {
    const result = resolveReportTypeSettings([
      { type: 'EXERCISE', enabled: false, recipients: ['a@x.at'] },
      { type: 'ACTIVITY', enabled: true, recipients: ['b@x.at', 'c@x.at'] },
    ]);
    expect(result.EXERCISE).toEqual({ enabled: false, recipients: ['a@x.at'] });
    expect(result.ACTIVITY).toEqual({ enabled: true, recipients: ['b@x.at', 'c@x.at'] });
  });

  it('ignoriert Zeilen nicht freigeschalteter Arten (Einsatzbericht)', () => {
    const result = resolveReportTypeSettings([{ type: 'INCIDENT', enabled: true, recipients: ['x@x.at'] }]);
    expect(Object.keys(result).sort()).toEqual(['ACTIVITY', 'EXERCISE']);
  });
});

describe('pickReportType', () => {
  it('nimmt den gewünschten Typ, wenn er eingeschaltet ist', () => {
    expect(pickReportType('EXERCISE', ['ACTIVITY', 'EXERCISE'])).toBe('EXERCISE');
  });

  it('fällt bei einem abgeschalteten oder unbekannten Typ auf den ersten eingeschalteten zurück', () => {
    expect(pickReportType('EXERCISE', ['ACTIVITY'])).toBe('ACTIVITY');
    expect(pickReportType('FOO', ['EXERCISE', 'ACTIVITY'])).toBe('EXERCISE');
    expect(pickReportType(undefined, ['ACTIVITY'])).toBe('ACTIVITY');
    expect(pickReportType(null, ['ACTIVITY'])).toBe('ACTIVITY');
  });

  it('liefert null, wenn keine Art eingeschaltet ist', () => {
    expect(pickReportType('ACTIVITY', [])).toBeNull();
  });
});
```

Run: `npx vitest run src/lib/heimatfeuerwehr/report-type-settings.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Schema ändern**

In `prisma/schema.prisma`:

1. Modell `Organization`: direkt unter der Zeile `reportKioskToken   String?            @unique` einfügen:

```prisma
  // Anzeigename des gemeinsamen iPads im Kopf der Schnellerfassung (z. B. "Tablet Feuerwehr EG"), null = keiner.
  reportKioskDeviceName String?
```

   und in der Relationsliste des Modells (bei `reports           Report[]`) ergänzen:

```prisma
  reportTypeSettings ReportTypeSetting[]
```

2. Direkt hinter dem Modell `Report` (vor `model ReportVehicle`) neues Modell einfügen:

```prisma
// Einstellungen je Feuerwehr und Berichtsart: ob die Art in App und am iPad verfügbar ist und wer den Bericht per
// E-Mail erhält. Keine Zeile = eingeschaltet, keine Empfänger. Zeilen entstehen erst, wenn ein Admin etwas ändert.
model ReportTypeSetting {
  id             String       @id @default(cuid())
  organizationId String
  type           ReportType
  enabled        Boolean      @default(true)
  recipients     String[]     @default([])
  updatedAt      DateTime     @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, type])
}
```

Die Spalte `reportRecipients` bleibt in dieser Aufgabe noch bestehen (Aufgabe 4 entfernt sie).

- [ ] **Step 4: Migration A erzeugen und von Hand ergänzen**

Erst die exakte DDL von Prisma erzeugen lassen (die lokale Datenbank hat die neue Tabelle noch nicht):

```bash
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

(`$DATABASE_URL` aus `.env` laden, ohne den Wert auszugeben, z. B. `set -a; . ./.env; set +a` nur in diesem einen Aufruf und nie mit `bash -x`; alternativ `--from-schema-datasource prisma/schema.prisma`.) Die Ausgabe enthält `CREATE TABLE "ReportTypeSetting"`, den Unique-Index, den Fremdschlüssel und `ALTER TABLE "Organization" ADD COLUMN "reportKioskDeviceName" TEXT`. Diese Anweisungen **wörtlich** in `prisma/migrations/20261115090000_report_type_setting/migration.sql` übernehmen und danach diesen Abschnitt anhängen (Übernahme der alten Empfänger, wiederholbar):

```sql
-- Backfill: die bisherige Empfängerliste je Feuerwehr gilt für beide freigeschalteten Berichtsarten.
INSERT INTO "ReportTypeSetting" ("id", "organizationId", "type", "enabled", "recipients", "updatedAt")
SELECT 'rts_' || o."id" || '_' || t.type, o."id", t.type::"ReportType", true, o."reportRecipients", CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES ('ACTIVITY'), ('EXERCISE')) AS t(type)
WHERE cardinality(o."reportRecipients") > 0
  AND NOT EXISTS (
    SELECT 1 FROM "ReportTypeSetting" s
    WHERE s."organizationId" = o."id" AND s."type" = t.type::"ReportType"
  );
```

Dann lokal anwenden und Client erzeugen:

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: `20261115090000_report_type_setting` wird angewendet. Danach muss `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` eine leere Migration melden.

- [ ] **Step 5: Backfill von Hand prüfen (einmalig, lokale Datenbank)**

Temporäres Skript `.superpowers/backfill-check.ts` (liegt in `.superpowers/` und wird nie committet) anlegen und ausführen:

```ts
import { readFileSync } from 'node:fs';
import { prisma } from '../src/lib/db/prisma';

const SQL_FILE = 'prisma/migrations/20261115090000_report_type_setting/migration.sql';
(async () => {
  const sql = readFileSync(SQL_FILE, 'utf8');
  const start = sql.indexOf('INSERT INTO "ReportTypeSetting"');
  const insert = sql.slice(start).trim();
  const run = `backfill-check-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: run, nummer: run, type: 'FEUERWEHR', reportRecipients: ['a@example.local', 'b@example.local'] },
  });
  try {
    await prisma.$executeRawUnsafe(insert);
    const rows = await prisma.reportTypeSetting.findMany({ where: { organizationId: org.id }, orderBy: { type: 'asc' } });
    console.log(JSON.stringify(rows.map((r) => ({ type: r.type, enabled: r.enabled, recipients: r.recipients }))));
    // Wiederholung darf keine Doppelten erzeugen
    await prisma.$executeRawUnsafe(insert);
    console.log('rows after rerun', await prisma.reportTypeSetting.count({ where: { organizationId: org.id } }));
  } finally {
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.$disconnect();
  }
})();
```

Run: `npx tsx .superpowers/backfill-check.ts`
Expected: zwei Zeilen `ACTIVITY` und `EXERCISE`, je `enabled: true` und die beiden Adressen; `rows after rerun 2`. Das Skript danach löschen (`rm .superpowers/backfill-check.ts`).

- [ ] **Step 6: `report-type-settings.ts` schreiben**

```ts
import type { ReportType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ACTIVE_REPORT_TYPES } from './report-constants';

export interface ReportTypeSettingValue {
  enabled: boolean;
  recipients: string[];
}

/** Nur die in der App freigeschalteten Berichtsarten (heute Tätigkeits- und Übungsbericht) sind einstellbar. */
export function isActiveReportType(type: string): type is ReportType {
  return ACTIVE_REPORT_TYPES.includes(type);
}

/** Reine Logik: Einstellung je freigeschalteter Art; fehlende Zeile = eingeschaltet, keine Empfänger. */
export function resolveReportTypeSettings(
  rows: { type: string; enabled: boolean; recipients: string[] }[],
): Record<string, ReportTypeSettingValue> {
  return Object.fromEntries(
    ACTIVE_REPORT_TYPES.map((type) => {
      const row = rows.find((candidate) => candidate.type === type);
      return [type, row ? { enabled: row.enabled, recipients: [...row.recipients] } : { enabled: true, recipients: [] }];
    }),
  );
}

/** Reine Logik: gewünschte Art, wenn eingeschaltet, sonst die erste eingeschaltete, sonst null. */
export function pickReportType(
  typeParam: string | undefined | null,
  enabledTypes: readonly string[],
): ReportType | null {
  if (typeParam && enabledTypes.includes(typeParam)) return typeParam as ReportType;
  return (enabledTypes[0] as ReportType | undefined) ?? null;
}

export async function getReportTypeSettings(organizationId: string): Promise<Record<string, ReportTypeSettingValue>> {
  const rows = await prisma.reportTypeSetting.findMany({
    where: { organizationId },
    select: { type: true, enabled: true, recipients: true },
  });
  return resolveReportTypeSettings(rows);
}

/** Eingeschaltete Arten in der Reihenfolge von `ACTIVE_REPORT_TYPES`. */
export async function getEnabledReportTypes(organizationId: string): Promise<ReportType[]> {
  const settings = await getReportTypeSettings(organizationId);
  return ACTIVE_REPORT_TYPES.filter((type) => settings[type]?.enabled) as ReportType[];
}

/** Nicht freigeschaltete Art: false. Ohne Zeile: true (Voreinstellung). */
export async function isReportTypeEnabled(organizationId: string, type: string): Promise<boolean> {
  if (!isActiveReportType(type)) return false;
  const row = await prisma.reportTypeSetting.findUnique({
    where: { organizationId_type: { organizationId, type } },
    select: { enabled: true },
  });
  return row ? row.enabled : true;
}

/** E-Mail-Empfänger des Berichts dieser Art; ohne Zeile keine. */
export async function getReportRecipients(organizationId: string, type: string): Promise<string[]> {
  if (!isActiveReportType(type)) return [];
  const row = await prisma.reportTypeSetting.findUnique({
    where: { organizationId_type: { organizationId, type } },
    select: { recipients: true },
  });
  return row?.recipients ?? [];
}

async function assertConfigurable(organizationId: string, type: string): Promise<ReportType> {
  if (!isActiveReportType(type)) throw new Error('Diese Berichtsart ist nicht verfügbar.');
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, type: 'FEUERWEHR' },
    select: { id: true },
  });
  if (!organization) throw new Error('Berichtsarten gibt es nur für Feuerwehren.');
  return type;
}

export async function saveReportTypeEnabled(organizationId: string, type: string, enabled: boolean): Promise<void> {
  const validType = await assertConfigurable(organizationId, type);
  await prisma.reportTypeSetting.upsert({
    where: { organizationId_type: { organizationId, type: validType } },
    create: { organizationId, type: validType, enabled },
    update: { enabled },
  });
}

export async function saveReportTypeRecipients(organizationId: string, type: string, recipients: string[]): Promise<void> {
  const validType = await assertConfigurable(organizationId, type);
  const unique = [...new Set(recipients)];
  await prisma.reportTypeSetting.upsert({
    where: { organizationId_type: { organizationId, type: validType } },
    create: { organizationId, type: validType, recipients: unique },
    update: { recipients: unique },
  });
}
```

Run: `npx vitest run src/lib/heimatfeuerwehr/report-type-settings.test.ts`
Expected: PASS.

- [ ] **Step 7: DB-Test schreiben (`report-type-settings.db.test.ts`)**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import {
  getEnabledReportTypes,
  getReportRecipients,
  getReportTypeSettings,
  isReportTypeEnabled,
  saveReportTypeEnabled,
  saveReportTypeRecipients,
} from './report-type-settings';

const RUN = `rts-${Date.now()}`;
const orgIds: string[] = [];
let feuerwehrId = '';
let abschnittId = '';

async function makeOrg(key: string, type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO') {
  const org = await prisma.organization.create({ data: { name: `${RUN}-${key}`, nummer: `${RUN}-${key}`, type } });
  orgIds.push(org.id);
  return org.id;
}

beforeAll(async () => {
  feuerwehrId = await makeOrg('ff', 'FEUERWEHR');
  abschnittId = await makeOrg('afkdo', 'ABSCHNITTSKOMMANDO');
});

afterAll(async () => {
  if (orgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe('Berichtsarten-Einstellungen', () => {
  it('ohne Zeile: beide Arten eingeschaltet, keine Empfänger', async () => {
    expect(await getReportTypeSettings(feuerwehrId)).toEqual({
      ACTIVITY: { enabled: true, recipients: [] },
      EXERCISE: { enabled: true, recipients: [] },
    });
    expect(await getEnabledReportTypes(feuerwehrId)).toEqual(['ACTIVITY', 'EXERCISE']);
    expect(await isReportTypeEnabled(feuerwehrId, 'ACTIVITY')).toBe(true);
    expect(await getReportRecipients(feuerwehrId, 'ACTIVITY')).toEqual([]);
  });

  it('schaltet eine Art ab, die andere bleibt eingeschaltet', async () => {
    await saveReportTypeEnabled(feuerwehrId, 'EXERCISE', false);
    expect(await isReportTypeEnabled(feuerwehrId, 'EXERCISE')).toBe(false);
    expect(await isReportTypeEnabled(feuerwehrId, 'ACTIVITY')).toBe(true);
    expect(await getEnabledReportTypes(feuerwehrId)).toEqual(['ACTIVITY']);
    await saveReportTypeEnabled(feuerwehrId, 'EXERCISE', true);
    expect(await getEnabledReportTypes(feuerwehrId)).toEqual(['ACTIVITY', 'EXERCISE']);
  });

  it('speichert Empfänger je Art getrennt, ohne Doppelte, und lässt den Schalter unberührt', async () => {
    await saveReportTypeEnabled(feuerwehrId, 'ACTIVITY', false);
    await saveReportTypeRecipients(feuerwehrId, 'ACTIVITY', ['a@example.local', 'a@example.local', 'b@example.local']);
    await saveReportTypeRecipients(feuerwehrId, 'EXERCISE', ['c@example.local']);
    expect(await getReportRecipients(feuerwehrId, 'ACTIVITY')).toEqual(['a@example.local', 'b@example.local']);
    expect(await getReportRecipients(feuerwehrId, 'EXERCISE')).toEqual(['c@example.local']);
    expect(await isReportTypeEnabled(feuerwehrId, 'ACTIVITY')).toBe(false);
    await saveReportTypeEnabled(feuerwehrId, 'ACTIVITY', true);
    expect(await getReportRecipients(feuerwehrId, 'ACTIVITY')).toEqual(['a@example.local', 'b@example.local']);
  });

  it('lehnt nicht freigeschaltete Arten ab; der Einsatzbericht gilt nie als eingeschaltet', async () => {
    await expect(saveReportTypeEnabled(feuerwehrId, 'INCIDENT', true)).rejects.toThrow('nicht verfügbar');
    await expect(saveReportTypeRecipients(feuerwehrId, 'INCIDENT', ['x@example.local'])).rejects.toThrow('nicht verfügbar');
    expect(await isReportTypeEnabled(feuerwehrId, 'INCIDENT')).toBe(false);
    expect(await isReportTypeEnabled(feuerwehrId, 'FOO')).toBe(false);
    expect(await getReportRecipients(feuerwehrId, 'INCIDENT')).toEqual([]);
  });

  it('lehnt Organisationen ab, die keine Feuerwehr sind', async () => {
    await expect(saveReportTypeEnabled(abschnittId, 'ACTIVITY', false)).rejects.toThrow('nur für Feuerwehren');
    await expect(saveReportTypeRecipients(abschnittId, 'ACTIVITY', [])).rejects.toThrow('nur für Feuerwehren');
  });
});
```

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/report-type-settings.db.test.ts`
Expected: PASS (5 Tests).

- [ ] **Step 8: Typen, Tests, Commit**

```bash
npx tsc --noEmit
npm test
git add prisma/schema.prisma prisma/migrations/20261115090000_report_type_setting/migration.sql \
  src/lib/heimatfeuerwehr/report-type-settings.ts src/lib/heimatfeuerwehr/report-type-settings.test.ts \
  src/lib/heimatfeuerwehr/report-type-settings.db.test.ts \
  docs/superpowers/specs/2026-11-15-kiosk-startbildschirm-berichtsarten-design.md \
  docs/superpowers/plans/2026-11-15-kiosk-startbildschirm-berichtsarten.md
git commit -m "feat: Berichtsarten je Feuerwehr - Datenmodell und Einstellungs-Bibliothek (Spec, Plan)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Abgabe-Kern: Sperre je Berichtsart und Empfänger je Art

**Files:**
- Modify: `src/lib/heimatfeuerwehr/submit-report-core.ts`
- Modify: `src/lib/heimatfeuerwehr/report-kiosk-submit.ts`
- Modify: `src/lib/heimatfeuerwehr/submit-report-core.db.test.ts`

**Interfaces:**
- Consumes: `isReportTypeEnabled`, `getReportRecipients`, `saveReportTypeEnabled`, `saveReportTypeRecipients` (Aufgabe 1)
- Produces: `submitReportCore` lehnt eine nicht freigeschaltete oder von der Feuerwehr abgeschaltete Art als **erste** Prüfung mit `'Diese Berichtsart ist nicht verfügbar.'` ab; die E-Mail-Empfänger kommen aus `getReportRecipients(fireDepartmentId, input.type)`.

- [ ] **Step 1: Tests ergänzen (`submit-report-core.db.test.ts`)**

Im vorhandenen Test den Mock der E-Mail-Funktion importierbar machen und neue Fälle anhängen. Oben bei den Importen ergänzen:

```ts
import { sendReportSubmittedEmail } from './notify-report-submitted';
import { saveReportTypeEnabled, saveReportTypeRecipients } from './report-type-settings';
```

(`sendReportSubmittedEmail` ist durch das vorhandene `vi.mock('@/lib/heimatfeuerwehr/notify-report-submitted', ...)` bereits ein `vi.fn`.) Ans Ende der Datei, außerhalb der bestehenden `describe`-Blöcke, anhängen:

```ts
describe('submitReportCore: Berichtsarten je Feuerwehr', () => {
  it('lehnt die nicht freigeschaltete Art INCIDENT und eine erfundene Art ab, ohne Bericht und ohne Nummer', async () => {
    const before = await prisma.report.count({ where: { fireDepartmentId: orgA } });
    for (const type of ['INCIDENT', 'FOO'] as const) {
      const result = await submitReportCore({
        fireDepartmentId: orgA,
        createdById: ids.creator,
        input: input({ type: type as never }),
      });
      expect(result.error).toBe('Diese Berichtsart ist nicht verfügbar.');
      expect(result.reportId).toBeUndefined();
    }
    expect(await prisma.report.count({ where: { fireDepartmentId: orgA } })).toBe(before);
  });

  it('lehnt eine von der Feuerwehr abgeschaltete Art ab und lässt die andere zu', async () => {
    await saveReportTypeEnabled(orgA, 'EXERCISE', false);
    try {
      const blocked = await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ type: 'EXERCISE' }) });
      expect(blocked.error).toBe('Diese Berichtsart ist nicht verfügbar.');
      const allowed = await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ type: 'ACTIVITY' }) });
      expect(allowed.error).toBeUndefined();
      expect(allowed.reportId).toBeDefined();
    } finally {
      await saveReportTypeEnabled(orgA, 'EXERCISE', true);
    }
  });

  it('nimmt die E-Mail-Empfänger aus der Zeile der Berichtsart', async () => {
    await saveReportTypeRecipients(orgA, 'ACTIVITY', ['taetigkeit@example.local']);
    await saveReportTypeRecipients(orgA, 'EXERCISE', ['uebung@example.local']);
    const mail = vi.mocked(sendReportSubmittedEmail);

    await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ type: 'ACTIVITY' }) });
    expect(mail.mock.calls.at(-1)?.[0].fireDepartmentEmails).toEqual(['taetigkeit@example.local']);

    await submitReportCore({ fireDepartmentId: orgA, createdById: ids.creator, input: input({ type: 'EXERCISE' }) });
    expect(mail.mock.calls.at(-1)?.[0].fireDepartmentEmails).toEqual(['uebung@example.local']);
  });

  it('ohne Zeile: keine Empfänger', async () => {
    const mail = vi.mocked(sendReportSubmittedEmail);
    await submitReportCore({ fireDepartmentId: orgB, createdById: ids.creator, input: input({ filledById: ids.fillerB }) });
    expect(mail.mock.calls.at(-1)?.[0].fireDepartmentEmails).toEqual([]);
  });
});
```

Falls die Kopfzeile des Tests andere Namen als `orgA`/`orgB`/`ids`/`input` nutzt, die tatsächlichen Namen der Datei verwenden (siehe `beforeAll` dort); die Fixtures `creator`, `fillerA`, `fillerB` existieren.

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/submit-report-core.db.test.ts`
Expected: Die neuen Tests zu INCIDENT/FOO, abgeschalteter Art und Empfängern FAIL (heute prüft der Kern nichts davon und liest `reportRecipients`).

- [ ] **Step 2: Kern ändern (`submit-report-core.ts`)**

1. Import ergänzen:

```ts
import { getReportRecipients, isReportTypeEnabled } from './report-type-settings';
```

2. In `submitReportCore` direkt nach `const { fireDepartmentId, createdById, input } = params;` einfügen (vor allen anderen Prüfungen):

```ts
  // Verfügbarkeit der Berichtsart: nicht freigeschaltet (Einsatzbericht) oder von der Feuerwehr abgeschaltet.
  // Gilt für App und iPad gleich (geteilter Kern) - die Oberfläche blendet solche Arten zusätzlich aus.
  if (!(await isReportTypeEnabled(fireDepartmentId, input.type))) {
    return { error: 'Diese Berichtsart ist nicht verfügbar.' };
  }
```

3. Im `select` der Organisation (`prisma.organization.findUniqueOrThrow` nach der Transaktion) `reportRecipients: true,` entfernen (also `select: { name: true, wappenImageData: true, wappenImageMimeType: true }`) und direkt darunter ergänzen:

```ts
  const recipients = await getReportRecipients(fireDepartmentId, input.type);
```

4. Im Aufruf von `sendReportSubmittedEmail` `fireDepartmentEmails: fireDepartment.reportRecipients` ersetzen durch `fireDepartmentEmails: recipients`.

- [ ] **Step 3: Doppelte Einzelprüfung des Kiosk entfernen (`report-kiosk-submit.ts`)**

Den Import `import { ACTIVE_REPORT_TYPES } from './report-constants';` und die Zeile `if (!ACTIVE_REPORT_TYPES.includes(input.type)) return { error: 'Diese Berichtsart ist nicht verfügbar.' };` löschen. Den Satz im Doc-Kommentar "Die Berichtsart wird serverseitig auf die freigeschalteten Arten begrenzt (der Einsatzbericht ist noch nicht freigeschaltet), nicht nur in der Oberfläche." ersetzen durch: "Die Verfügbarkeit der Berichtsart (freigeschaltet und von der Feuerwehr eingeschaltet) prüft submitReportCore."

Die vorhandenen Kiosk-Tests (`report-kiosk-submit.db.test.ts`: INCIDENT, erfundene Art, EXERCISE weiter möglich) bleiben unverändert und müssen weiterhin bestehen; sie prüfen jetzt den Weg über den Kern.

- [ ] **Step 4: Tests, Typen, Commit**

```bash
npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/submit-report-core.db.test.ts src/lib/heimatfeuerwehr/report-kiosk-submit.db.test.ts
npx tsc --noEmit
npm test
git add src/lib/heimatfeuerwehr/submit-report-core.ts src/lib/heimatfeuerwehr/report-kiosk-submit.ts src/lib/heimatfeuerwehr/submit-report-core.db.test.ts
git commit -m "feat: Abgabe-Kern prüft Verfügbarkeit der Berichtsart und liest Empfänger je Art

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: alle Tests PASS.

---

### Task 3: App: abgeschaltete Berichtsarten ausblenden

**Files:**
- Modify: `src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.tsx`
- Modify: `src/app/(app)/meine-feuerwehr/action-row.tsx`
- Modify: `src/app/(app)/meine-feuerwehr/page.tsx`
- Modify: `src/app/(app)/meine-feuerwehr/berichte/neu/page.tsx`
- Create: `src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.test.ts`

**Interfaces:**
- Consumes: `getEnabledReportTypes`, `pickReportType` (Aufgabe 1)
- Produces: `ReportTypeSheet({ onClose, enabledTypes })`, `ActionRow({ showPhotoUpload, enabledReportTypes })`

- [ ] **Step 1: Render-Test schreiben (`report-type-sheet.test.ts`)**

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ReportTypeSheet } from './report-type-sheet';

function render(enabledTypes: string[]): string {
  return renderToStaticMarkup(createElement(ReportTypeSheet, { onClose: () => undefined, enabledTypes }));
}

describe('ReportTypeSheet', () => {
  it('zeigt eingeschaltete Arten antippbar und die übrigen gesperrt', () => {
    const html = render(['ACTIVITY']);
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Tätigkeitsbericht/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Tätigkeitsbericht/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Übungsbericht/);
  });

  it('beschriftet eine abgeschaltete freigeschaltete Art mit "Nicht aktiviert" und eine nicht freigeschaltete mit "Bald verfügbar"', () => {
    const html = render(['ACTIVITY']);
    expect(html).toContain('Nicht aktiviert');
    expect(html).toContain('Bald verfügbar');
  });

  it('sperrt alle Arten, wenn keine eingeschaltet ist', () => {
    const html = render([]);
    expect(html.match(/disabled=""/g)?.length).toBe(3);
  });
});
```

Run: `npx vitest run "src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.test.ts"`
Expected: FAIL (Prop `enabledTypes` fehlt, Beschriftung "Nicht aktiviert" gibt es nicht).

- [ ] **Step 2: `ReportTypeSheet` ändern**

`src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.tsx`:

1. Signatur: `export function ReportTypeSheet({ onClose, enabledTypes }: { onClose: () => void; enabledTypes: readonly string[] })`.
2. In `choose`: `if (!enabledTypes.includes(type)) return;` statt `ACTIVE_REPORT_TYPES.includes(type)`.
3. In der Schleife `const active = enabledTypes.includes(type);` und die Beschriftung rechts ersetzen durch:

```tsx
                {!active && (
                  <span className="text-xs font-normal">
                    {ACTIVE_REPORT_TYPES.includes(type) ? 'Nicht aktiviert' : 'Bald verfügbar'}
                  </span>
                )}
```

   (`ACTIVE_REPORT_TYPES` bleibt importiert und wird nur noch für diese Beschriftung gebraucht.)

Run den Test aus Step 1: Expected PASS.

- [ ] **Step 3: `ActionRow` und Seite verdrahten**

`src/app/(app)/meine-feuerwehr/action-row.tsx`: Signatur `export function ActionRow({ showPhotoUpload, enabledReportTypes }: { showPhotoUpload: boolean; enabledReportTypes: string[] })` und `<ReportTypeSheet onClose={() => setSheetOpen(false)} enabledTypes={enabledReportTypes} />`.

`src/app/(app)/meine-feuerwehr/page.tsx`: Import ergänzen `import { getEnabledReportTypes } from '@/lib/heimatfeuerwehr/report-type-settings';`, vor dem `return` der Seite `const enabledReportTypes = await getEnabledReportTypes(user.homeOrganizationId);` einfügen und den Aufruf ändern:

```tsx
        <ActionRow
          showPhotoUpload={canManagePhotoUploadsFor(user, user.homeOrganizationId)}
          enabledReportTypes={enabledReportTypes}
        />
```

Ist `user` an der Einfügestelle noch nicht verfügbar (Variablenreihenfolge der Seite prüfen), die Zeile direkt dort einfügen, wo `user` und `homeOrganizationId` schon benutzt werden (z. B. neben den übrigen `await`-Aufrufen der Seite).

- [ ] **Step 4: `neu/page.tsx` auf die Auswahlregel umstellen**

`src/app/(app)/meine-feuerwehr/berichte/neu/page.tsx`:

1. Imports: `import { notFound } from 'next/navigation';` und `import { getEnabledReportTypes, pickReportType } from '@/lib/heimatfeuerwehr/report-type-settings';` ergänzen; `import { ACTIVE_REPORT_TYPES } from '@/lib/heimatfeuerwehr/report-constants';` und den nicht mehr gebrauchten `import type { ReportType } from '@prisma/client';` entfernen, falls danach unbenutzt (`tsc` entscheidet).
2. Die Zeile `const type: ReportType = ACTIVE_REPORT_TYPES.includes(typeParam ?? '') ? (typeParam as ReportType) : 'ACTIVITY';` ersetzen durch:

```tsx
  // Nur eingeschaltete Arten: ein abgeschalteter oder unbekannter Wunsch fällt auf die erste eingeschaltete Art
  // zurück, ohne eingeschaltete Art gibt es das Formular nicht.
  const enabledTypes = await getEnabledReportTypes(user.homeOrganizationId);
  const type = pickReportType(typeParam, enabledTypes);
  if (!type) notFound();
```

- [ ] **Step 5: Tests, Typen, Commit**

```bash
npx vitest run "src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.test.ts" "src/app/(app)/meine-feuerwehr/berichte/neu/report-wizard.test.ts"
npx tsc --noEmit
npm test
git add "src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.tsx" "src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.test.ts" \
  "src/app/(app)/meine-feuerwehr/action-row.tsx" "src/app/(app)/meine-feuerwehr/page.tsx" \
  "src/app/(app)/meine-feuerwehr/berichte/neu/page.tsx"
git commit -m "feat: App blendet abgeschaltete Berichtsarten aus (Auswahlblatt, Neuer Bericht)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: alle Tests PASS (die Charakterisierungstests des Assistenten bleiben grün).

---

### Task 4: Verwaltung der Berichtsarten und Entfernen der alten Spalte (Migration B)

**Files:**
- Modify: `src/app/(app)/admin/heimatfeuerwehr/actions.ts`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/report-recipients-form.tsx`
- Create: `src/app/(app)/admin/heimatfeuerwehr/report-type-row.tsx`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/page.tsx`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261115100000_drop_organization_report_recipients/migration.sql`

**Interfaces:**
- Consumes: `getReportTypeSettings`, `saveReportTypeEnabled`, `saveReportTypeRecipients`, `isActiveReportType` (Aufgabe 1)
- Produces (Server Actions in `actions.ts`): `setReportTypeEnabled(organizationId, type, enabled): Promise<{ error?: string }>` und `setReportTypeRecipients(organizationId, type, prevState, formData): Promise<ReportRecipientsState>` (ersetzt `setReportRecipients`)

Diese Aufgabe ist Verdrahtung der Verwaltungsoberfläche; die Logik ist in Aufgabe 1 getestet. Geprüft wird mit `tsc`, Build und der Browser-Prüfung am Ende.

- [ ] **Step 1: Server Actions (`actions.ts`)**

1. Imports ergänzen (zu den vorhandenen):

```ts
import { isActiveReportType, saveReportTypeEnabled, saveReportTypeRecipients } from '@/lib/heimatfeuerwehr/report-type-settings';
```

2. Die bestehende Funktion `setReportRecipients` (samt ihrem Doc-Kommentar, direkt unter `export interface ReportRecipientsState`) **ersetzen** durch:

```ts
/** Empfänger des Berichts je Berichtsart (E-Mail mit PDF) - Chip-Liste wie bei den übrigen E-Mail-Listen. */
export async function setReportTypeRecipients(
  organizationId: string,
  type: string,
  _prevState: ReportRecipientsState,
  formData: FormData,
): Promise<ReportRecipientsState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));
  if (!isActiveReportType(type)) return { error: 'Diese Berichtsart ist nicht verfügbar.' };

  const parsed = emailListSchema.safeParse(formData.get('emails'));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };
  }

  try {
    await saveReportTypeRecipients(organizationId, type, parsed.data);
  } catch {
    return { error: 'Berichtsarten gibt es nur für Feuerwehren.' };
  }

  revalidatePath('/admin/heimatfeuerwehr');
  return { success: true };
}

/** Schaltet eine Berichtsart für die Feuerwehr ein/aus (gilt in der App und am iPad, bestehende Berichte bleiben). */
export async function setReportTypeEnabled(
  organizationId: string,
  type: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));
  if (!isActiveReportType(type)) return { error: 'Diese Berichtsart ist nicht verfügbar.' };

  try {
    await saveReportTypeEnabled(organizationId, type, enabled);
  } catch {
    return { error: 'Berichtsarten gibt es nur für Feuerwehren.' };
  }

  revalidatePath('/admin/heimatfeuerwehr');
  revalidatePath('/meine-feuerwehr');
  return {};
}
```

- [ ] **Step 2: `ReportRecipientsForm` je Berichtsart binden (`report-recipients-form.tsx`)**

1. Import ersetzen: `import { setReportTypeRecipients, type ReportRecipientsState } from './actions';`
2. Props um `type: string` erweitern (`{ organizationId, type, initialEmails, members }: { organizationId: string; type: string; initialEmails: string[]; members: ... }`) und `const boundAction = setReportTypeRecipients.bind(null, organizationId, type);`.
3. Die festen Element-Ids eindeutig machen, weil zwei Formulare auf der Seite stehen: `id="newReportRecipientEmail"` und das zugehörige `htmlFor` zu `` `newReportRecipientEmail-${type}` `` bzw. `id="reportRecipientPicker"` und `htmlFor` zu `` `reportRecipientPicker-${type}` `` ändern (alle vier Stellen: je `label htmlFor` und `input`/`select` `id`).

- [ ] **Step 3: Zeile je Berichtsart (`report-type-row.tsx`)**

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ReportRecipientsForm } from './report-recipients-form';
import { setReportTypeEnabled } from './actions';

/**
 * Eine Berichtsart in der Karte "Berichte": Schalter "Aktiviert" (gilt in der App und am iPad) und die
 * Empfänger des Berichts. Ein- schaltet sofort ohne Rückfrage, Aus fragt per Dialog nach (Muster wie
 * FeatureToggleRow); bei einem Serverfehler schaltet der Schalter zurück und zeigt einen Hinweis.
 */
export function ReportTypeRow({
  organizationId,
  type,
  title,
  enabled,
  recipients,
  members,
}: {
  organizationId: string;
  type: string;
  title: string;
  enabled: boolean;
  recipients: string[];
  members: { id: string; firstName: string; lastName: string; email: string }[];
}) {
  const [optimisticEnabled, setOptimisticEnabled] = useState(enabled);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setOptimisticEnabled(enabled);
  }, [organizationId, type, enabled]);

  function apply(next: boolean) {
    setOptimisticEnabled(next);
    startTransition(async () => {
      try {
        const result = await setReportTypeEnabled(organizationId, type, next);
        if (result.error) {
          setOptimisticEnabled(!next);
          toast.error(result.error);
        }
      } catch {
        setOptimisticEnabled(!next);
        toast.error('Änderung konnte nicht gespeichert werden.');
      }
    });
  }

  function handleCheckedChange(next: boolean) {
    if (!next) {
      setConfirmOpen(true);
      return;
    }
    apply(true);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <label className="flex items-center gap-2 text-sm text-ink">
          Aktiviert
          <Switch checked={optimisticEnabled} disabled={pending} onCheckedChange={handleCheckedChange} aria-label={`${title} aktiviert`} />
        </label>
      </div>
      <p className="text-xs text-ink-faint">Diese Adressen erhalten eine E-Mail mit PDF-Anhang, sobald ein {title} abgegeben wird.</p>
      <ReportRecipientsForm organizationId={organizationId} type={type} initialEmails={recipients} members={members} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title} ausschalten?</AlertDialogTitle>
            <AlertDialogDescription>
              Der {title} verschwindet danach in der App und am iPad dieser Feuerwehr. Bereits abgegebene Berichte und die
              Empfänger bleiben unverändert erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                apply(false);
              }}
            >
              Ausschalten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

Hinweis: Den Doc-Kommentar-Satz "Ein- schaltet sofort" beim Abtippen korrekt als "Einschalten geht sofort ohne Rückfrage" schreiben. Falls `Switch` die Props `aria-label`/`onCheckedChange` anders benennt, das Muster aus `feature-toggle-row.tsx` (gleicher Import `@/components/ui/switch`) exakt übernehmen.

- [ ] **Step 4: Karte "Berichte" in `page.tsx` umbauen**

1. Imports ergänzen/ändern: `ReportRecipientsForm`-Import durch `import { ReportTypeRow } from './report-type-row';` ersetzen (der Form wird nur noch von der Zeile benutzt), außerdem `import { ACTIVE_REPORT_TYPES } from '@/lib/heimatfeuerwehr/report-constants';` (falls `REPORT_TYPE_LABEL` schon aus dieser Datei importiert wird, nur ergänzen) und `import { getReportTypeSettings } from '@/lib/heimatfeuerwehr/report-type-settings';`.
2. Im `select` der Abfrage, die `selectedOrgFull` liefert, die Zeile `reportRecipients: true,` löschen.
3. Direkt nach dem `if (!selectedOrgFull) { notFound(); }`-Block einfügen: `const reportTypeSettings = await getReportTypeSettings(selectedOrgId);`
4. In der Karte mit der Überschrift "Berichte" die beiden Absätze (`Tätigkeitsbericht: Aktiv · Übungsbericht: Nicht aktiv · …` und `Diese Adressen erhalten eine E-Mail …`) sowie das `<ReportRecipientsForm … />` ersetzen durch:

```tsx
        <p className="mb-3 text-xs text-ink-faint">
          Je Berichtsart ein Schalter (gilt in der App und am iPad) und die Empfänger, die den Bericht per E-Mail mit PDF
          erhalten. Einsatzbericht, Getränkeautomat und Schadensmeldung sind noch nicht verfügbar.
        </p>
        {selectedOrgFull.type === 'FEUERWEHR' ? (
          <div className="flex flex-col gap-3">
            {ACTIVE_REPORT_TYPES.map((type) => (
              <ReportTypeRow
                key={`${selectedOrgId}-${type}`}
                organizationId={selectedOrgId}
                type={type}
                title={REPORT_TYPE_LABEL[type]}
                enabled={reportTypeSettings[type].enabled}
                recipients={reportTypeSettings[type].recipients}
                members={heimatfeuerwehrPickerMembers}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-faint">Nur für Feuerwehren verfügbar.</p>
        )}
```

   (`selectedOrgFull.type` ist seit der Korrektur zur Link-Karte bereits im `select`.) Die Tabelle der abgegebenen Berichte darunter bleibt unverändert.

- [ ] **Step 5: Spalte `reportRecipients` entfernen (Migration B)**

Prüfen, dass nichts mehr liest: `grep -rn "reportRecipients" src prisma/schema.prisma --include=*.ts --include=*.tsx --include=*.prisma` darf nur noch die Zeile im Schema und Kommentare/Tests der Migration liefern. Dann in `prisma/schema.prisma` im Modell `Organization` die Zeile `reportRecipients String[] @default([])` samt direkt davor stehendem Kommentar entfernen (nur wenn der Kommentar nur diese Spalte beschreibt; sonst nur die Zeile). Migration anlegen `prisma/migrations/20261115100000_drop_organization_report_recipients/migration.sql`:

```sql
-- Die Empfänger leben seit der Migration 20261115090000_report_type_setting je Berichtsart in "ReportTypeSetting".
-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "reportRecipients";
```

Dann:

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

(Letzter Befehl: Ausgabe muss leer sein; `$DATABASE_URL` wie in Aufgabe 1 laden, nie ausgeben.)

- [ ] **Step 6: Typen und Commit**

```bash
npx tsc --noEmit
npm test
git add prisma/schema.prisma prisma/migrations/20261115100000_drop_organization_report_recipients/migration.sql \
  "src/app/(app)/admin/heimatfeuerwehr/actions.ts" "src/app/(app)/admin/heimatfeuerwehr/report-recipients-form.tsx" \
  "src/app/(app)/admin/heimatfeuerwehr/report-type-row.tsx" "src/app/(app)/admin/heimatfeuerwehr/page.tsx"
git commit -m "feat: Verwaltung der Berichtsarten (Schalter, Empfänger je Art), alte Empfängerspalte entfernt

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Gerätename und Seitendaten des Kiosk

**Files:**
- Create: `src/lib/heimatfeuerwehr/report-kiosk-device-name.ts`, `report-kiosk-device-name.test.ts`, `report-kiosk-device-name.db.test.ts`
- Create: `src/app/(app)/admin/heimatfeuerwehr/report-kiosk-device-name-form.tsx`
- Modify: `src/app/(app)/admin/heimatfeuerwehr/report-kiosk-actions.ts`, `page.tsx`
- Modify: `src/lib/heimatfeuerwehr/report-kiosk-data.ts`, `report-kiosk-data.db.test.ts`

**Interfaces:**
- Produces (`report-kiosk-device-name.ts`): `DEVICE_NAME_MAX = 60`, `parseDeviceName(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string }` (rein), `saveReportKioskDeviceName(organizationId: string, name: string | null): Promise<void>`
- Produces (`report-kiosk-data.ts`): `KioskData` bekommt `deviceName: string | null` und `enabledTypes: string[]`; `recentKindsByType` enthält nur eingeschaltete Arten.
- Produces (`report-kiosk-actions.ts`): `setReportKioskDeviceName(organizationId, prevState, formData): Promise<DeviceNameState>` mit `export interface DeviceNameState { success?: boolean; error?: string }`

- [ ] **Step 1: Unit-Test für das Parsen (`report-kiosk-device-name.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { DEVICE_NAME_MAX, parseDeviceName } from './report-kiosk-device-name';

describe('parseDeviceName', () => {
  it('trimmt und fasst Leerzeichen zusammen', () => {
    expect(parseDeviceName('  Tablet   Feuerwehr  EG ')).toEqual({ ok: true, value: 'Tablet Feuerwehr EG' });
  });

  it('macht aus leerem oder nur aus Leerzeichen bestehendem Wert (und fehlendem Feld) null', () => {
    expect(parseDeviceName('')).toEqual({ ok: true, value: null });
    expect(parseDeviceName('   ')).toEqual({ ok: true, value: null });
    expect(parseDeviceName(null)).toEqual({ ok: true, value: null });
  });

  it('lehnt zu lange Namen ab', () => {
    expect(parseDeviceName('a'.repeat(DEVICE_NAME_MAX))).toEqual({ ok: true, value: 'a'.repeat(DEVICE_NAME_MAX) });
    expect(parseDeviceName('a'.repeat(DEVICE_NAME_MAX + 1))).toEqual({
      ok: false,
      error: `Höchstens ${DEVICE_NAME_MAX} Zeichen.`,
    });
  });

  it('lehnt Nicht-Text ab', () => {
    expect(parseDeviceName(42)).toEqual({ ok: false, error: 'Ungültige Eingabe.' });
  });
});
```

Run: `npx vitest run src/lib/heimatfeuerwehr/report-kiosk-device-name.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 2: `report-kiosk-device-name.ts` schreiben**

```ts
import { prisma } from '@/lib/db/prisma';

export const DEVICE_NAME_MAX = 60;

export type ParsedDeviceName = { ok: true; value: string | null } | { ok: false; error: string };

/** Reine Logik: Gerätename aus dem Formularwert. Leer = Name entfernen (null), höchstens 60 Zeichen. */
export function parseDeviceName(raw: unknown): ParsedDeviceName {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Ungültige Eingabe.' };
  const value = raw.replace(/\s+/g, ' ').trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > DEVICE_NAME_MAX) return { ok: false, error: `Höchstens ${DEVICE_NAME_MAX} Zeichen.` };
  return { ok: true, value };
}

/** Speichert den Gerätenamen; nur für aktive Feuerwehren (wie der Link selbst). */
export async function saveReportKioskDeviceName(organizationId: string, name: string | null): Promise<void> {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, type: 'FEUERWEHR', isActive: true },
    select: { id: true },
  });
  if (!organization) throw new Error('Die Schnellerfassung gibt es nur für aktive Feuerwehren.');
  await prisma.organization.update({ where: { id: organization.id }, data: { reportKioskDeviceName: name } });
}
```

Run den Test aus Step 1: Expected PASS.

- [ ] **Step 3: DB-Test für das Speichern (`report-kiosk-device-name.db.test.ts`)**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { saveReportKioskDeviceName } from './report-kiosk-device-name';

const RUN = `kiosk-dev-${Date.now()}`;
const orgIds: string[] = [];
let feuerwehrId = '';
let abschnittId = '';

async function makeOrg(key: string, type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO') {
  const org = await prisma.organization.create({ data: { name: `${RUN}-${key}`, nummer: `${RUN}-${key}`, type } });
  orgIds.push(org.id);
  return org.id;
}

beforeAll(async () => {
  feuerwehrId = await makeOrg('ff', 'FEUERWEHR');
  abschnittId = await makeOrg('afkdo', 'ABSCHNITTSKOMMANDO');
});

afterAll(async () => {
  if (orgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe('saveReportKioskDeviceName', () => {
  it('speichert und entfernt den Namen', async () => {
    await saveReportKioskDeviceName(feuerwehrId, 'Tablet Feuerwehr EG');
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: feuerwehrId } })).reportKioskDeviceName).toBe('Tablet Feuerwehr EG');
    await saveReportKioskDeviceName(feuerwehrId, null);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: feuerwehrId } })).reportKioskDeviceName).toBeNull();
  });

  it('lehnt ein Abschnittskommando ab', async () => {
    await expect(saveReportKioskDeviceName(abschnittId, 'x')).rejects.toThrow('nur für aktive Feuerwehren');
  });
});
```

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/report-kiosk-device-name.db.test.ts`
Expected: PASS.

- [ ] **Step 4: Server Action und Formular**

In `report-kiosk-actions.ts` Importe ergänzen und anhängen:

```ts
import { parseDeviceName, saveReportKioskDeviceName } from '@/lib/heimatfeuerwehr/report-kiosk-device-name';

export interface DeviceNameState {
  success?: boolean;
  error?: string;
}

/** Gerätename des iPads (Anzeige im Kopf der Schnellerfassung); leer entfernt den Namen. */
export async function setReportKioskDeviceName(
  organizationId: string,
  _prevState: DeviceNameState,
  formData: FormData,
): Promise<DeviceNameState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const parsed = parseDeviceName(formData.get('deviceName'));
  if (!parsed.ok) return { error: parsed.error };

  try {
    await saveReportKioskDeviceName(organizationId, parsed.value);
  } catch {
    return { error: 'Die Schnellerfassung gibt es nur für aktive Feuerwehren.' };
  }

  revalidatePath('/admin/heimatfeuerwehr');
  return { success: true };
}
```

Neue Datei `report-kiosk-device-name-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { DEVICE_NAME_MAX } from '@/lib/heimatfeuerwehr/report-kiosk-device-name';
import { setReportKioskDeviceName, type DeviceNameState } from './report-kiosk-actions';

const initialState: DeviceNameState = {};

/** Gerätename des iPads (erscheint im Kopf der Schnellerfassung). Leer = kein Name. */
export function ReportKioskDeviceNameForm({ organizationId, initialName }: { organizationId: string; initialName: string | null }) {
  const [state, formAction, pending] = useActionState(setReportKioskDeviceName.bind(null, organizationId), initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunken p-3">
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <label htmlFor="reportKioskDeviceName" className="text-[13px] font-medium text-ink">
          Gerätename
        </label>
        <input
          id="reportKioskDeviceName"
          name="deviceName"
          type="text"
          defaultValue={initialName ?? ''}
          maxLength={DEVICE_NAME_MAX}
          placeholder="z. B. Tablet Feuerwehr EG"
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
          state.success ? 'bg-success hover:opacity-90' : 'bg-brand hover:bg-brand-hover'
        }`}
      >
        {pending ? 'Speichern…' : state.success ? 'Gespeichert' : 'Speichern'}
      </button>
      {state.error && <p className="w-full text-xs text-danger">{state.error}</p>}
    </form>
  );
}
```

In `page.tsx`: Import `import { ReportKioskDeviceNameForm } from './report-kiosk-device-name-form';`, in das `select` der Abfrage von `selectedOrgFull` `reportKioskDeviceName: true,` ergänzen, und im Zweig der Link-Karte für aktive Feuerwehren (`selectedOrgFull.type === 'FEUERWEHR' && selectedOrgFull.isActive ? ( <ReportKioskCard … /> ) : …`) die Karte und das Formular in ein Fragment legen:

```tsx
          <>
            <ReportKioskCard
              key={selectedOrgId}
              link={selectedOrgFull.reportKioskToken ? buildReportKioskLink(selectedOrgFull.reportKioskToken) : null}
              createAction={createReportKioskLink.bind(null, selectedOrgId)}
              disableAction={disableReportKioskLink.bind(null, selectedOrgId)}
            />
            <div className="mt-3">
              <ReportKioskDeviceNameForm key={selectedOrgId} organizationId={selectedOrgId} initialName={selectedOrgFull.reportKioskDeviceName} />
            </div>
          </>
```

- [ ] **Step 5: Seitendaten ergänzen (`report-kiosk-data.ts` + Test zuerst)**

Test zuerst: in `report-kiosk-data.db.test.ts` (Fixtures dort: `orgA`, Token über `setReportKioskToken(orgA)`) diese Fälle ergänzen. Oben `import { saveReportTypeEnabled } from './report-type-settings';` hinzufügen und im `describe('loadKioskData', …)` anhängen:

```ts
  it('liefert Gerätename und eingeschaltete Arten', async () => {
    const token = await setReportKioskToken(orgA);
    const before = await loadKioskData(token);
    expect(before?.deviceName).toBeNull();
    expect(before?.enabledTypes).toEqual(['ACTIVITY', 'EXERCISE']);

    await prisma.organization.update({ where: { id: orgA }, data: { reportKioskDeviceName: 'Tablet EG' } });
    await saveReportTypeEnabled(orgA, 'EXERCISE', false);
    try {
      const after = await loadKioskData(token);
      expect(after?.deviceName).toBe('Tablet EG');
      expect(after?.enabledTypes).toEqual(['ACTIVITY']);
      expect(Object.keys(after?.recentKindsByType ?? {})).toEqual(['ACTIVITY']);
    } finally {
      await saveReportTypeEnabled(orgA, 'EXERCISE', true);
      await prisma.organization.update({ where: { id: orgA }, data: { reportKioskDeviceName: null } });
    }
  });
```

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/report-kiosk-data.db.test.ts`
Expected: der neue Test FAIL (Felder fehlen). Dann `report-kiosk-data.ts` ändern:

1. Import: `import { getEnabledReportTypes } from './report-type-settings';` und `ACTIVE_REPORT_TYPES`-Import entfernen, falls unbenutzt.
2. `KioskData` ergänzen um `deviceName: string | null;` und `enabledTypes: string[];`.
3. In `loadKioskData` die `Promise.all` um zwei Einträge erweitern und die Arten-Schleife auf `enabledTypes` umstellen:

```ts
  const enabledTypes = await getEnabledReportTypes(organization.id);
  const [members, vehicles, recent, device] = await Promise.all([
    /* members-Abfrage unverändert */,
    /* vehicles-Abfrage unverändert */,
    Promise.all(
      enabledTypes.map(async (type) => [type, await getRecentActivityKindsForOrg(organization.id, type)] as const),
    ),
    prisma.organization.findUniqueOrThrow({ where: { id: organization.id }, select: { reportKioskDeviceName: true } }),
  ]);

  return {
    organization,
    members,
    vehicles,
    recentKindsByType: Object.fromEntries(recent),
    deviceName: device.reportKioskDeviceName,
    enabledTypes,
  };
```

   (`members`- und `vehicles`-Abfrage unverändert aus der bestehenden Datei übernehmen; nur die Struktur der `Promise.all` ändert sich. Den Typ-Import `ReportType` löschen, falls danach unbenutzt.)

Run den Test erneut: Expected PASS (alle in der Datei).

- [ ] **Step 6: Typen, Tests, Commit**

```bash
npx tsc --noEmit
npm test
git add src/lib/heimatfeuerwehr/report-kiosk-device-name.ts src/lib/heimatfeuerwehr/report-kiosk-device-name.test.ts \
  src/lib/heimatfeuerwehr/report-kiosk-device-name.db.test.ts \
  "src/app/(app)/admin/heimatfeuerwehr/report-kiosk-device-name-form.tsx" "src/app/(app)/admin/heimatfeuerwehr/report-kiosk-actions.ts" \
  "src/app/(app)/admin/heimatfeuerwehr/page.tsx" src/lib/heimatfeuerwehr/report-kiosk-data.ts src/lib/heimatfeuerwehr/report-kiosk-data.db.test.ts
git commit -m "feat: Gerätename der Schnellerfassung und erweiterte Seitendaten (Gerätename, eingeschaltete Arten)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Hinweis: `tsc` meldet in `kiosk-flow.tsx`/`page.tsx` des Kiosk noch nichts, weil `KioskFlowProps` unverändert bleibt; die Seite übergibt die neuen Felder erst in Aufgabe 6.

---

### Task 6: Kiosk-Oberfläche: Startbildschirm, Kopf und neuer Ablauf

**Files:**
- Create: `src/lib/heimatfeuerwehr/kiosk-tiles.ts`, `kiosk-tiles.test.ts`, `kiosk-clock.ts`, `kiosk-clock.test.ts`
- Create: `src/app/berichte-schnell/[token]/kiosk-header.tsx`, `kiosk-form-screen.tsx`
- Modify: `src/app/berichte-schnell/[token]/kiosk-flow.tsx`, `kiosk-flow.test.ts`, `page.tsx`

**Interfaces:**
- Produces (`kiosk-tiles.ts`): `type KioskTileState = 'active' | 'off' | 'soon'`, `interface KioskTile { key: 'ACTIVITY' | 'EXERCISE' | 'INCIDENT' | 'DRINKS' | 'DAMAGE'; title: string; subtitle: string; state: KioskTileState; type: ReportType | null }`, `getKioskTiles(enabledTypes: readonly string[]): KioskTile[]`, `KIOSK_TILE_HINT: { off: 'Nicht aktiviert'; soon: 'Bald verfügbar' }`
- Produces (`kiosk-clock.ts`): `formatKioskDate(date: Date): string`, `formatKioskTime(date: Date): string` (Wiener Zeit)
- Produces: `KioskFlowProps` bekommt `deviceName: string | null` und `enabledTypes: string[]`

- [ ] **Step 1: Tests für Kacheln und Uhr schreiben**

`kiosk-tiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getKioskTiles, KIOSK_TILE_HINT } from './kiosk-tiles';

describe('getKioskTiles', () => {
  it('liefert die fünf Kacheln in fester Reihenfolge', () => {
    expect(getKioskTiles(['ACTIVITY', 'EXERCISE']).map((tile) => tile.title)).toEqual([
      'Tätigkeitsbericht',
      'Übungsbericht',
      'Einsatzbericht',
      'Getränkeautomat',
      'Schadensmeldung',
    ]);
  });

  it('Tätigkeits- und Übungsbericht sind aktiv, wenn eingeschaltet; die übrigen immer "Bald verfügbar"', () => {
    const states = Object.fromEntries(getKioskTiles(['ACTIVITY', 'EXERCISE']).map((tile) => [tile.key, tile.state]));
    expect(states).toEqual({ ACTIVITY: 'active', EXERCISE: 'active', INCIDENT: 'soon', DRINKS: 'soon', DAMAGE: 'soon' });
  });

  it('eine abgeschaltete freigeschaltete Art ist "off"', () => {
    const states = Object.fromEntries(getKioskTiles(['ACTIVITY']).map((tile) => [tile.key, tile.state]));
    expect(states.ACTIVITY).toBe('active');
    expect(states.EXERCISE).toBe('off');
  });

  it('ohne eingeschaltete Art ist keine Kachel aktiv', () => {
    expect(getKioskTiles([]).some((tile) => tile.state === 'active')).toBe(false);
  });

  it('trägt die Berichtsart der Berichts-Kacheln und null bei den übrigen', () => {
    const types = Object.fromEntries(getKioskTiles(['ACTIVITY']).map((tile) => [tile.key, tile.type]));
    expect(types).toEqual({ ACTIVITY: 'ACTIVITY', EXERCISE: 'EXERCISE', INCIDENT: 'INCIDENT', DRINKS: null, DAMAGE: null });
  });

  it('hat feste Hinweistexte', () => {
    expect(KIOSK_TILE_HINT).toEqual({ off: 'Nicht aktiviert', soon: 'Bald verfügbar' });
  });
});
```

`kiosk-clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatKioskDate, formatKioskTime } from './kiosk-clock';

// 2026-11-15 10:59 UTC = 11:59 in Wien (Winterzeit, UTC+1), ein Sonntag.
const SAMPLE = new Date('2026-11-15T10:59:00Z');

describe('Kiosk-Uhr (Wiener Zeit)', () => {
  it('formatiert die Uhrzeit als HH:MM in Wiener Zeit', () => {
    expect(formatKioskTime(SAMPLE)).toBe('11:59');
  });

  it('formatiert Wochentag, Tag, Monat und Jahr', () => {
    expect(formatKioskDate(SAMPLE)).toMatch(/^So\.?,? 15\. November 2026$/);
  });

  it('rechnet über Mitternacht in Wiener Zeit', () => {
    expect(formatKioskTime(new Date('2026-11-15T23:30:00Z'))).toBe('00:30');
    expect(formatKioskDate(new Date('2026-11-15T23:30:00Z'))).toContain('16. November 2026');
  });
});
```

Run: `npx vitest run src/lib/heimatfeuerwehr/kiosk-tiles.test.ts src/lib/heimatfeuerwehr/kiosk-clock.test.ts`
Expected: FAIL (Module fehlen).

- [ ] **Step 2: `kiosk-tiles.ts` und `kiosk-clock.ts` schreiben**

`kiosk-tiles.ts`:

```ts
import type { ReportType } from '@prisma/client';
import { ACTIVE_REPORT_TYPES } from './report-constants';

export type KioskTileState = 'active' | 'off' | 'soon';

export interface KioskTile {
  key: 'ACTIVITY' | 'EXERCISE' | 'INCIDENT' | 'DRINKS' | 'DAMAGE';
  title: string;
  subtitle: string;
  state: KioskTileState;
  /** Berichtsart der Kachel; null bei Formularen, die keine Berichte sind (Getränkeautomat, Schadensmeldung). */
  type: ReportType | null;
}

export const KIOSK_TILE_HINT = { off: 'Nicht aktiviert', soon: 'Bald verfügbar' } as const;

const TILE_DEFINITIONS: { key: KioskTile['key']; title: string; subtitle: string; type: ReportType | null }[] = [
  { key: 'ACTIVITY', title: 'Tätigkeitsbericht', subtitle: 'Dienste, Versammlungen, Wartung', type: 'ACTIVITY' },
  { key: 'EXERCISE', title: 'Übungsbericht', subtitle: 'Geplante Übungen, Schulungen', type: 'EXERCISE' },
  { key: 'INCIDENT', title: 'Einsatzbericht', subtitle: 'Alarmierungen, Einsätze', type: 'INCIDENT' },
  { key: 'DRINKS', title: 'Getränkeautomat', subtitle: 'Meldung an Getränkewart', type: null },
  { key: 'DAMAGE', title: 'Schadensmeldung', subtitle: 'Defekte Ausrüstung melden', type: null },
];

/**
 * Kacheln des Startbildschirms. Aktiv ist eine Berichts-Kachel nur, wenn die Art in der App freigeschaltet
 * (`ACTIVE_REPORT_TYPES`) UND für die Feuerwehr eingeschaltet ist; eine freigeschaltete, aber abgeschaltete Art
 * ist "off", alles Übrige "soon" (noch nicht verfügbar).
 */
export function getKioskTiles(enabledTypes: readonly string[]): KioskTile[] {
  return TILE_DEFINITIONS.map((definition) => {
    let state: KioskTileState = 'soon';
    if (definition.type && ACTIVE_REPORT_TYPES.includes(definition.type)) {
      state = enabledTypes.includes(definition.type) ? 'active' : 'off';
    }
    return { ...definition, state };
  });
}
```

`kiosk-clock.ts`:

```ts
const TIME_ZONE = 'Europe/Vienna';

const dateFormat = new Intl.DateTimeFormat('de-AT', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('de-AT', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "So., 15. November 2026" in Wiener Zeit. */
export function formatKioskDate(date: Date): string {
  return dateFormat.format(date);
}

/** "11:59" in Wiener Zeit. */
export function formatKioskTime(date: Date): string {
  return timeFormat.format(date);
}
```

Run: `npx vitest run src/lib/heimatfeuerwehr/kiosk-tiles.test.ts src/lib/heimatfeuerwehr/kiosk-clock.test.ts`
Expected: PASS. Weicht nur die Wochentag-Schreibweise der Node-ICU-Ausgabe ab (z. B. "So, 15. November 2026"), den regulären Ausdruck im Test auf die tatsächliche Ausgabe anpassen (`So` mit optionalem Punkt und Komma), die Produktionsfunktion nicht ändern.

- [ ] **Step 3: Test für den Startbildschirm im Ablauf schreiben (`kiosk-flow.test.ts` ersetzen)**

Den Inhalt der Datei ersetzen durch (die Mocks oben bleiben wie bisher):

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
  deviceName: 'Tablet Feuerwehr EG',
  enabledTypes: ['ACTIVITY', 'EXERCISE'],
  members: [
    { id: '1', firstName: 'Bernd', lastName: 'Bauer' },
    { id: '2', firstName: 'Anna', lastName: 'Huber' },
  ],
  vehicles: [],
  recentKindsByType: { ACTIVITY: [], EXERCISE: [] },
};

function render(over: Partial<typeof props> = {}): string {
  return renderToStaticMarkup(createElement(KioskFlow, { ...props, ...over }));
}

function buttonFor(html: string, title: string): string {
  const match = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${title}(?:(?!</button>).)*</button>`));
  return match ? match[0] : '';
}

describe('KioskFlow: Startbildschirm', () => {
  it('beginnt mit "Welches Formular ausfüllen?", Feuerwehrname und Gerätename, ohne Namensliste', () => {
    const html = render();
    expect(html).toContain('Welches Formular ausfüllen?');
    expect(html).toContain('FF Wolfsgraben');
    expect(html).toContain('Tablet Feuerwehr EG');
    expect(html).not.toContain('Bauer Bernd');
    expect(html).not.toContain('Wer schreibt den Bericht?');
    expect(html).not.toContain('data-layout="tablet"');
  });

  it('zeigt alle fünf Kacheln; Tätigkeits- und Übungsbericht sind antippbar, die übrigen gesperrt mit Hinweis', () => {
    const html = render();
    for (const title of ['Tätigkeitsbericht', 'Übungsbericht', 'Einsatzbericht', 'Getränkeautomat', 'Schadensmeldung']) {
      expect(buttonFor(html, title)).not.toBe('');
    }
    expect(buttonFor(html, 'Tätigkeitsbericht')).not.toContain('disabled=""');
    expect(buttonFor(html, 'Übungsbericht')).not.toContain('disabled=""');
    for (const title of ['Einsatzbericht', 'Getränkeautomat', 'Schadensmeldung']) {
      expect(buttonFor(html, title)).toContain('disabled=""');
      expect(buttonFor(html, title)).toContain('Bald verfügbar');
    }
  });

  it('zeigt eine abgeschaltete Art gesperrt mit "Nicht aktiviert"', () => {
    const html = render({ enabledTypes: ['ACTIVITY'] });
    expect(buttonFor(html, 'Übungsbericht')).toContain('disabled=""');
    expect(buttonFor(html, 'Übungsbericht')).toContain('Nicht aktiviert');
  });

  it('weist darauf hin, wenn kein Formular verfügbar ist', () => {
    const html = render({ enabledTypes: [] });
    expect(html).toContain('Aktuell ist kein Formular verfügbar.');
  });

  it('lässt die Gerätekarte ohne Gerätenamen aus', () => {
    const html = render({ deviceName: null });
    expect(html).not.toContain('Tablet Feuerwehr EG');
    expect(html).not.toContain('Gerät');
  });
});
```

Run: `npx vitest run "src/app/berichte-schnell/[token]/kiosk-flow.test.ts"`
Expected: FAIL (Props und Startbildschirm fehlen).

- [ ] **Step 4: Kopf und Formularbildschirm bauen**

`src/app/berichte-schnell/[token]/kiosk-header.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { formatKioskDate, formatKioskTime } from '@/lib/heimatfeuerwehr/kiosk-clock';

/**
 * Kopf der Schnellerfassung: Feuerwehrname (klein, Großbuchstaben), Titel, rechts eine Gerätekarte mit
 * Gerätename (nur wenn gesetzt), Datum und Uhrzeit in Wiener Zeit. Datum und Uhrzeit werden erst nach dem
 * Einhängen im Browser gesetzt (kein Unterschied zwischen Server- und Browser-Rendering) und alle 30 Sekunden
 * aktualisiert.
 */
export function KioskHeader({
  organizationName,
  title,
  deviceName,
}: {
  organizationName: string;
  title: string;
  deviceName: string | null;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="pt-safe border-b-4 border-brand bg-[#1c1c1e] px-6 py-4 text-white">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-white/70">{organizationName}</p>
          <h1 className="mt-1 text-[28px] font-bold leading-tight">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-4 rounded-xl border border-white/15 bg-white/10 px-4 py-3">
          {deviceName && (
            <div className="border-r border-white/15 pr-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Gerät</p>
              <p className="text-sm font-medium">{deviceName}</p>
            </div>
          )}
          <div className="min-w-[110px] text-right">
            <p className="min-h-[16px] text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">
              {now ? formatKioskDate(now) : ''}
            </p>
            <p className="min-h-[28px] text-[22px] font-bold leading-tight tabular-nums">{now ? formatKioskTime(now) : ''}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
```

`src/app/berichte-schnell/[token]/kiosk-form-screen.tsx`:

```tsx
'use client';

import type { LucideIcon } from 'lucide-react';
import { Beer, ClipboardList, Siren, Target, TriangleAlert } from 'lucide-react';
import { KIOSK_TILE_HINT, type KioskTile } from '@/lib/heimatfeuerwehr/kiosk-tiles';

const TILE_ICON: Record<KioskTile['key'], LucideIcon> = {
  ACTIVITY: ClipboardList,
  EXERCISE: Target,
  INCIDENT: Siren,
  DRINKS: Beer,
  DAMAGE: TriangleAlert,
};

/**
 * Startbildschirm: eine Kachel je Formular. Aktive Kacheln sind weiß mit Markenrot (App-Stil), gesperrte
 * grau mit Hinweis ("Bald verfügbar" = noch nicht vorhanden, "Nicht aktiviert" = von der Feuerwehr abgeschaltet).
 * Alle Kacheln mindestens 120 px hoch.
 */
export function KioskFormScreen({ tiles, onChoose }: { tiles: KioskTile[]; onChoose: (tile: KioskTile) => void }) {
  const anyActive = tiles.some((tile) => tile.state === 'active');
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((tile) => {
          const Icon = TILE_ICON[tile.key];
          const active = tile.state === 'active';
          return (
            <button
              key={tile.key}
              type="button"
              disabled={!active}
              onClick={() => onChoose(tile)}
              className={`flex min-h-[160px] flex-col items-start justify-between rounded-xl border p-5 text-left shadow-sm ${
                active ? 'border-neutral-200 bg-white text-[#1c1c1e]' : 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400'
              }`}
            >
              <Icon className={`h-10 w-10 ${active ? 'text-brand' : 'text-neutral-300'}`} aria-hidden="true" />
              <span>
                <span className="block text-[22px] font-bold leading-tight">{tile.title}</span>
                <span className={`mt-1 block text-sm ${active ? 'text-[#6c6c70]' : 'text-neutral-400'}`}>{tile.subtitle}</span>
                {!active && (
                  <span className="mt-2 inline-block rounded-full bg-neutral-200 px-2.5 py-0.5 text-xs font-semibold text-neutral-500">
                    {KIOSK_TILE_HINT[tile.state === 'off' ? 'off' : 'soon']}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {!anyActive && <p className="mt-6 text-center text-base text-neutral-500">Aktuell ist kein Formular verfügbar.</p>}
    </>
  );
}
```

Hinweis: Existiert einer der lucide-Namen (`Beer`, `Siren`, `TriangleAlert`, `Target`, `ClipboardList`) in der installierten Version nicht, `npx tsc --noEmit` meldet das; dann den nächstliegenden vorhandenen Namen aus `lucide-react` wählen (z. B. `GlassWater` statt `Beer`, `AlertTriangle` statt `TriangleAlert`) und das hier dokumentieren.

- [ ] **Step 5: Ablauf umbauen (`kiosk-flow.tsx`)**

Den Ablauf auf Formular → Name → Assistent → Bestätigung ändern. Konkrete Änderungen:

1. Imports: `ACTIVE_REPORT_TYPES` entfernen, ergänzen: `import { getKioskTiles, type KioskTile } from '@/lib/heimatfeuerwehr/kiosk-tiles';`, `import { KioskHeader } from './kiosk-header';`, `import { KioskFormScreen } from './kiosk-form-screen';`.
2. `KioskFlowProps` ergänzen um `deviceName: string | null;` und `enabledTypes: string[];`; Funktionsparameter entsprechend.
3. Phase-Typ ersetzen:

```ts
type Phase =
  | { phase: 'form' }
  | { phase: 'name'; type: ReportType }
  | { phase: 'wizard'; filledById: string; type: ReportType; run: number }
  | { phase: 'done'; number?: number; year?: number };
```

   Startzustand `{ phase: 'form' }`; `reset` setzt `{ phase: 'form' }` (und leert die Suche). Die Konstante `REPORT_TYPES` entfällt.
4. Direkt vor dem `return` des Nicht-Assistenten-Zweigs: `const tiles = getKioskTiles(enabledTypes);`.
5. Der Nicht-Assistenten-Zweig wird (Seitenhintergrund, `touch-manipulation` und `pt-safe` bleiben am äußeren Container; `pt-safe` wandert aber in den Kopf, daher vom äußeren Container entfernen):

```tsx
  const headerTitle =
    state.phase === 'form' ? 'Welches Formular ausfüllen?' : state.phase === 'name' ? 'Wer schreibt den Bericht?' : 'Bericht abgegeben';

  return (
    <div className="flex min-h-[100dvh] touch-manipulation flex-col bg-[#f6f6f7] text-[#1c1c1e]">
      <KioskHeader organizationName={organizationName} title={headerTitle} deviceName={deviceName} />

      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        {state.phase === 'form' && (
          <KioskFormScreen
            tiles={tiles}
            onChoose={(tile: KioskTile) => {
              if (tile.state !== 'active' || !tile.type) return;
              setSearch('');
              setState({ phase: 'name', type: tile.type });
            }}
          />
        )}

        {state.phase === 'name' && (
          <>
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
                    onClick={() => {
                      // Jeder Lauf bekommt einen neuen key, damit der Assistent mit leerem Zustand startet.
                      const nextRun = run + 1;
                      setRun(nextRun);
                      setState({ phase: 'wizard', filledById: member.id, type: state.type, run: nextRun });
                    }}
                    className="min-h-[64px] rounded-xl border border-neutral-300 bg-white px-4 py-3 text-left text-[16px] font-semibold shadow-sm"
                  >
                    {member.lastName} {member.firstName}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={reset} className="mt-6 min-h-[52px] rounded-lg border border-neutral-300 bg-white px-6 text-[15px] font-semibold">
              ← Anderes Formular
            </button>
          </>
        )}

        {state.phase === 'done' && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            {state.number !== undefined && state.year !== undefined && (
              <p className="text-lg text-neutral-600">
                Nr. {state.number} / {state.year}
              </p>
            )}
            <button type="button" onClick={reset} className="mt-4 min-h-[56px] rounded-lg bg-brand px-10 text-[16px] font-semibold text-white">
              Neues Formular
            </button>
            <p className="text-sm text-neutral-400">Der Bildschirm wechselt nach 30 Sekunden von selbst zurück.</p>
          </div>
        )}
      </main>
    </div>
  );
```

   Das bisherige `<h1>Wer schreibt den Bericht?</h1>` im Namensblock und das `<h1>Bericht abgegeben</h1>` im Bestätigungsblock entfallen (Kopf trägt den Titel), der Block `{state.phase === 'type' && …}` (Berichtsart-Kacheln) entfällt komplett. Der Text "Der Bildschirm wechselt nach 30 Sekunden von selbst zurück." bleibt. Das Wizard-`tabletHeader.title` bleibt `` `${REPORT_TYPE_LABEL[state.type]} · ${organizationName}` ``. `WizardFrame`-Rückgabe des Assistenten-Zweigs bleibt unverändert.

6. Der Auto-Reset-Effekt der Bestätigung bleibt, `reset` führt jetzt zum Formularbildschirm.

`page.tsx`: die zwei neuen Props durchreichen: `deviceName={data.deviceName}` und `enabledTypes={data.enabledTypes}`.

Run: `npx vitest run "src/app/berichte-schnell/[token]/kiosk-flow.test.ts" "src/app/berichte-schnell/[token]/wizard-frame.test.ts"`
Expected: PASS.

- [ ] **Step 6: Typen, Gesamttests, Commit**

```bash
npx tsc --noEmit
npm test
git add src/lib/heimatfeuerwehr/kiosk-tiles.ts src/lib/heimatfeuerwehr/kiosk-tiles.test.ts \
  src/lib/heimatfeuerwehr/kiosk-clock.ts src/lib/heimatfeuerwehr/kiosk-clock.test.ts \
  "src/app/berichte-schnell/[token]/kiosk-header.tsx" "src/app/berichte-schnell/[token]/kiosk-form-screen.tsx" \
  "src/app/berichte-schnell/[token]/kiosk-flow.tsx" "src/app/berichte-schnell/[token]/kiosk-flow.test.ts" \
  "src/app/berichte-schnell/[token]/page.tsx"
git commit -m "feat: Kiosk-Startbildschirm mit Formular-Kacheln, Kopf mit Gerätename und Uhr, neuer Ablauf

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dokumentation und Gesamtprüfung

**Files:**
- Modify: `src/app/(app)/meine-feuerwehr/CLAUDE.md`

- [ ] **Step 1: Dokumentation anpassen**

In `src/app/(app)/meine-feuerwehr/CLAUDE.md` den Abschnitt "Berichte-Schnellerfassung am iPad" überarbeiten (die Datei zuerst lesen und die tatsächlichen Formulierungen anpassen, nichts Unzutreffendes stehen lassen):

- Bullet "Berichtsarten": ersetzen durch eine Beschreibung von `ReportTypeSetting` (je Feuerwehr und Berichtsart `enabled` und `recipients`; fehlende Zeile = eingeschaltet ohne Empfänger; nur Arten aus `ACTIVE_REPORT_TYPES` einstellbar; `src/lib/heimatfeuerwehr/report-type-settings.ts`), dass `submitReportCore` als erste Prüfung die Verfügbarkeit der Art prüft (App und iPad gleich, die Kiosk-Abgabe hat keine eigene Prüfung mehr) und dass die E-Mail-Empfänger aus der Zeile der Art kommen.
- Den Satz über die bekannte Asymmetrie ("`submitReport` hat keine serverseitige Sperre") streichen, weil sie geschlossen ist.
- Bullet "Ablauf": Formular → Name → Assistent → Bestätigung (nach 30 s oder "Neues Formular" zurück zum Formularbildschirm); Startbildschirm mit fünf Kacheln (`kiosk-tiles.ts`: aktiv/"Nicht aktiviert"/"Bald verfügbar"), Kopf mit Gerätename, Datum und Uhrzeit (`kiosk-header.tsx`, Wiener Zeit, nach dem Einhängen gesetzt).
- Bullet zur Verwaltung: Karte "Berichte" mit Schalter und Empfängerliste je Art (`report-type-row.tsx`, Aktionen `setReportTypeEnabled`/`setReportTypeRecipients` in `admin/heimatfeuerwehr/actions.ts`), Gerätename in der Link-Karte (`report-kiosk-device-name-form.tsx`).
- Hinweis zu den zwei Migrationen (`20261115090000_report_type_setting` legt an und kopiert die alten Empfänger, `20261115100000_drop_organization_report_recipients` löscht `Organization.reportRecipients`; Backup vor PROD).
- Die App-Seite: `ReportTypeSheet` bekommt `enabledTypes`, `neu/page.tsx` nutzt `pickReportType` (Rückfall auf die erste eingeschaltete Art, ohne eingeschaltete Art `notFound()`).
- Falls im Abschnitt "Tätigkeitsbericht / Übungsbericht" Text zu `Organization.reportRecipients` steht (z. B. Bericht-E-Mail an `Organization.reportRecipients`), auf "Empfänger je Berichtsart (`ReportTypeSetting`)" korrigieren.

- [ ] **Step 2: Gesamtprüfung**

```bash
npx tsc --noEmit
npm test
npm run test:db
npm run build
```

Expected: alle grün (Anzahlen im Bericht festhalten). Schlägt `tsc` nur wegen veralteter `.next/types` nach dem Branchwechsel fehl, `npm run build` einmal laufen lassen und `tsc` danach bewerten. Keinen Dev-Server starten; die Browser-Prüfung (Startbildschirm bei 1180×820, 404 bei ungültigem Link) macht der Controller anschließend selbst.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/CLAUDE.md"
git commit -m "docs: Kiosk-Startbildschirm und Berichtsarten je Feuerwehr dokumentiert

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Spec-Abdeckung

| Spec-Abschnitt | Aufgabe |
|---|---|
| 1 Datenmodell (`ReportTypeSetting`, `reportKioskDeviceName`, Backfill, Spalte löschen, Bibliothek) | 1, 4 (Migration B), 5 (Gerätename) |
| 2 Wirkung im Kern (Sperre als erste Prüfung, Empfänger je Art, Wegfall der Kiosk-Einzelprüfung) | 2 |
| 3 App blendet abgeschaltete Arten aus (Sheet, `neu`-Seite, "Meine Berichte" unverändert) | 3 |
| 4 iPad: Startbildschirm, neuer Ablauf, Kopf, Kacheln, Seitendaten, Farben | 5 (Seitendaten), 6 |
| 5 Verwaltung (Gerätename, Karte "Berichte" mit Schalter und Empfängern, Dialog beim Ausschalten, Rechteprüfung) | 4, 5 |
| 6 Tests und Prüfung | je Aufgabe, 7 |
| 7 Rollout (Migration läuft im Entrypoint, Backup, Voreinstellung eingeschaltet) | Hinweise in Aufgabe 4 und 7; Rollout selbst gibt der Betreiber-Dialog |
