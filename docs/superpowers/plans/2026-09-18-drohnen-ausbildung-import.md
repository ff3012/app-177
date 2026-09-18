# Drohnengruppe Ausbildungsstufen Bulk-Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bezirksweiter Excel-Import im Drohnengruppe-Modul, der einen FDISK-Export mit den
Ausbildungsdaten A1/A3, A2, BOS1, BOS2 einliest und die entsprechenden `DrohnengruppeMembership`-Felder
bestehender Mitglieder auffüllt, ohne je einen bereits gesetzten Wert zu überschreiben.

**Architecture:** Ein neuer, eigenständiger Import unter `/admin/drohnen/ausbildung-import` (Server
Action + Formular + Seite), der `FW-Nr`+`StbNr` gegen `User` matcht und pro Zeile nur bestehende
`DrohnengruppeMembership`-Zeilen aktualisiert. Die Präfix-Logik (welche Stufe darf geschrieben werden)
ist als reine, DB-lose Funktion ausgelagert, damit sie isoliert getestet werden kann, bevor sie in die
Server Action verdrahtet wird.

**Tech Stack:** Next.js Server Actions, `exceljs` (bereits Projektabhängigkeit), Prisma — keine neue
Abhängigkeit, keine Schema-Migration.

## Global Constraints

- Design-Referenz: `docs/superpowers/specs/2026-09-17-drohnen-ausbildung-import-design.md` — bei jedem
  Widerspruch zwischen diesem Plan und der Spec hat die Spec Vorrang, im Zweifel den Menschen fragen.
- Keine Schema-Migration, keine neuen Prisma-Felder. Nur die vier bestehenden Spalten
  `a1a3LizenzAm`/`a2LizenzAm`/`bos1AusbildungAm`/`bos2AusbildungAm` auf `DrohnengruppeMembership` werden
  geschrieben; `stuetzpunktausbildungAm` wird nie gelesen oder geschrieben.
- Kein Anlegen neuer `User`- oder `DrohnengruppeMembership`-Zeilen. Ein `User` ohne
  `droneMembership`-Relation wird übersprungen, nie angelegt.
- Jedes der 4 Datumsfelder wird nur geschrieben, wenn es aktuell `null` ist — niemals ein bereits
  gesetzter Wert überschrieben, auch nicht bei einem erneuten Import derselben Datei (Idempotenz: ein
  zweiter Lauf mit identischer Datei aktualisiert 0 Felder, verursacht aber keinen Fehler).
- Die Vorstufen-Kette für diesen Import ist bewusst NUR 4-stufig (A1/A3 → A2 → BOS1 → BOS2), OHNE
  Stützpunktausbildung — das bestehende 5-stufige `userSchema`/`findAusbildungsGapError`/
  `qualification-filter.ts` bleiben in diesem Plan komplett unangetastet.
- Berechtigung: Bezirksadmin ODER Bezirks-Drohnenadmin — NICHT der bestehende `canManageDroneGroupFor`
  (Einzelgruppen-Admin-Gate von `/admin/drohnen`), da eine Import-Datei mehrere Gruppen/Feuerwehren
  gleichzeitig betreffen kann.
- Kein automatisierter Testlauf in diesem Repo (Projekt-Konvention) — Verifikation über
  `npx tsc --noEmit`, `npm run build`, und temporäre Verifikations-Skripte per `npx tsx`
  (nach Gebrauch löschen, nie committen).

---

### Task 1: Spalten-Definition, Vorstufen-Logik, Berechtigung

**Files:**
- Create: `src/lib/drone/ausbildung-import-columns.ts`
- Create: `src/lib/drone/ausbildung-import-helpers.ts`
- Modify: `src/lib/auth/permissions.ts`

**Interfaces:**
- Consumes: nichts (unterste Schicht).
- Produces (für Task 2):
  - `AusbildungImportRow` (Interface), `AUSBILDUNG_IMPORT_COLUMNS: { header: string; key: keyof
    AusbildungImportRow }[]` aus `ausbildung-import-columns.ts`.
  - `AusbildungStufe` (Type: `'a1a3LizenzAm' | 'a2LizenzAm' | 'bos1AusbildungAm' | 'bos2AusbildungAm'`),
    `AUSBILDUNG_IMPORT_CHAIN: readonly AusbildungStufe[]`, `AusbildungResolution` (Interface),
    `resolveAusbildungUpdates(current, fileValues): AusbildungResolution` aus
    `ausbildung-import-helpers.ts`.
  - `canImportDroneAusbildung(user: SessionUser): boolean` aus `permissions.ts`.

- [ ] **Step 1: Spalten-Definition anlegen**

Erstelle `src/lib/drone/ausbildung-import-columns.ts`:

```typescript
export interface AusbildungImportRow {
  fwNr: string;
  stbNr: string;
  email: string;
  a1a3Datum: string;
  a2Datum: string;
  bos1Datum: string;
  bos2Datum: string;
}

/** Erwartete Spalten-Header des FDISK-Ausbildungs-Exports (Sheet "ExportResults") - siehe
 * docs/superpowers/specs/2026-09-17-drohnen-ausbildung-import-design.md. Vorname/Zuname/Dienstgrad/
 * Feuerwehr aus der echten Datei werden bewusst NICHT hier gelistet - sie werden nie geschrieben und
 * sind für die fehlende-Spalten-Prüfung nicht nötig. */
export const AUSBILDUNG_IMPORT_COLUMNS: { header: string; key: keyof AusbildungImportRow }[] = [
  { header: 'FW-Nr', key: 'fwNr' },
  { header: 'StbNr', key: 'stbNr' },
  { header: 'email', key: 'email' },
  { header: 'A1/A3 Datum', key: 'a1a3Datum' },
  { header: 'A2 Datum', key: 'a2Datum' },
  { header: 'BOS1 Datum', key: 'bos1Datum' },
  { header: 'BOS2 Datum', key: 'bos2Datum' },
];
```

- [ ] **Step 2: Vorstufen-Logik als reine Funktion schreiben**

Erstelle `src/lib/drone/ausbildung-import-helpers.ts`:

```typescript
export type AusbildungStufe = 'a1a3LizenzAm' | 'a2LizenzAm' | 'bos1AusbildungAm' | 'bos2AusbildungAm';

/** Reihenfolge der Kette für DIESEN Import - bewusst nur 4 Stufen, OHNE stuetzpunktausbildungAm
 * (siehe Design-Spec Abschnitt 2.3: Stützpunktausbildung ist eine eigene, pro Drohnengruppe
 * unterschiedliche Schulung, keine Voraussetzung für BOS1/BOS2 - anders als in userSchema's
 * app-weiter 5-stufiger Kette, die davon unberührt bleibt). */
export const AUSBILDUNG_IMPORT_CHAIN: readonly AusbildungStufe[] = [
  'a1a3LizenzAm',
  'a2LizenzAm',
  'bos1AusbildungAm',
  'bos2AusbildungAm',
];

export interface AusbildungResolution {
  /** Stufen, die tatsächlich geschrieben werden sollen (Date-Wert aus der Datei). */
  updates: Partial<Record<AusbildungStufe, Date>>;
  /** Stufen, die übersprungen wurden, weil in der DB bereits ein Wert steht. */
  skippedAlreadySet: AusbildungStufe[];
  /** Stufen, die übersprungen wurden, weil eine Vorstufe (innerhalb der 4er-Kette) fehlt - je Eintrag
   * die betroffene Stufe und die fehlende Vorstufe, für die Zeilen-Meldung. */
  skippedMissingPrereq: { stufe: AusbildungStufe; fehlendeVorstufe: AusbildungStufe }[];
}

/**
 * Reine Funktion, keine DB-Zugriffe: berechnet für eine Zeile, welche der 4 Stufen tatsächlich
 * geschrieben werden dürfen. `current` sind die JETZT in der DB stehenden Werte (null = leer),
 * `fileValues` die aus der Import-Datei gelesenen Werte für dieselben 4 Stufen (null = Zelle leer
 * oder Spalte nicht vorhanden). Verarbeitet die Kette in AUSBILDUNG_IMPORT_CHAIN-Reihenfolge, damit
 * eine Vorstufe, die durch dieselbe Zeile neu gesetzt wird, bereits als "erfüllt" zählt, wenn die
 * nächste Stufe geprüft wird.
 */
export function resolveAusbildungUpdates(
  current: Record<AusbildungStufe, Date | null>,
  fileValues: Record<AusbildungStufe, Date | null>,
): AusbildungResolution {
  const updates: Partial<Record<AusbildungStufe, Date>> = {};
  const skippedAlreadySet: AusbildungStufe[] = [];
  const skippedMissingPrereq: { stufe: AusbildungStufe; fehlendeVorstufe: AusbildungStufe }[] = [];
  const resolved = new Map<AusbildungStufe, boolean>();

  for (let i = 0; i < AUSBILDUNG_IMPORT_CHAIN.length; i++) {
    const stufe = AUSBILDUNG_IMPORT_CHAIN[i];
    const currentValue = current[stufe];
    const fileValue = fileValues[stufe];

    if (currentValue !== null) {
      resolved.set(stufe, true);
      if (fileValue !== null) skippedAlreadySet.push(stufe);
      continue;
    }

    if (fileValue === null) {
      resolved.set(stufe, false);
      continue;
    }

    const vorstufe = i > 0 ? AUSBILDUNG_IMPORT_CHAIN[i - 1] : null;
    if (vorstufe && !resolved.get(vorstufe)) {
      skippedMissingPrereq.push({ stufe, fehlendeVorstufe: vorstufe });
      resolved.set(stufe, false);
      continue;
    }

    updates[stufe] = fileValue;
    resolved.set(stufe, true);
  }

  return { updates, skippedAlreadySet, skippedMissingPrereq };
}
```

- [ ] **Step 3: Berechtigungsfunktion ergänzen**

In `src/lib/auth/permissions.ts`, füge direkt nach `canManageBezirksWideDroneEvent` (ca. Zeile 143-145)
folgende Funktion ein — identische Regel wie `canManageBezirksWideDroneEvent`, aber ein eigener,
call-site-lesbarer Name, exakt demselben Muster wie `canManageUsersFor`/`canManageHeimatfeuerwehrFor`
folgend (siehe deren Kommentar: "given its own name for readability at ... call sites, since the rule
could diverge later"):

```typescript
/** Bulk-Import der Drohnengruppen-Ausbildungsstufen (/admin/drohnen/ausbildung-import) - Bezirksadmin
 * ODER Bezirks-Drohnenadmin, NICHT der Einzelgruppen-Admin (canManageDroneGroupFor): eine Import-Datei
 * kann Mitglieder mehrerer Feuerwehren/Gruppen gleichzeitig enthalten, ein einzelner Gruppen-Admin darf
 * darüber nicht auf fremde Gruppen zugreifen. Identische Regel wie canManageBezirksWideDroneEvent,
 * eigener Name für Lesbarkeit an den Aufrufstellen. */
export function canImportDroneAusbildung(user: SessionUser): boolean {
  return isBezirksAdmin(user) || user.isBezirksDrohnenAdmin;
}
```

- [ ] **Step 4: Verifikationsskript für die Vorstufen-Logik schreiben und ausführen**

Erstelle im Repo-Root eine temporäre Datei `verify-ausbildung-import.ts`:

```typescript
import assert from 'node:assert';
import { resolveAusbildungUpdates, type AusbildungStufe } from './src/lib/drone/ausbildung-import-helpers';

function empty(): Record<AusbildungStufe, Date | null> {
  return { a1a3LizenzAm: null, a2LizenzAm: null, bos1AusbildungAm: null, bos2AusbildungAm: null };
}

const d1 = new Date('2026-01-01');
const d2 = new Date('2026-02-01');

// 1. Leeres Feld ohne Vorstufen-Problem wird befüllt.
{
  const current = { ...empty(), a1a3LizenzAm: d1, a2LizenzAm: d1 };
  const fileValues = { ...empty(), bos1AusbildungAm: d2 };
  const result = resolveAusbildungUpdates(current, fileValues);
  assert.deepStrictEqual(result.updates, { bos1AusbildungAm: d2 });
  assert.deepStrictEqual(result.skippedAlreadySet, []);
  assert.deepStrictEqual(result.skippedMissingPrereq, []);
  console.log('Test 1 OK: leeres Feld wird befüllt');
}

// 2. Bereits gesetztes Feld wird NICHT überschrieben.
{
  const current = { ...empty(), a1a3LizenzAm: d1 };
  const fileValues = { ...empty(), a1a3LizenzAm: d2 };
  const result = resolveAusbildungUpdates(current, fileValues);
  assert.deepStrictEqual(result.updates, {});
  assert.deepStrictEqual(result.skippedAlreadySet, ['a1a3LizenzAm']);
  console.log('Test 2 OK: bereits gesetztes Feld bleibt unangetastet');
}

// 3. BOS1 übersprungen, weil A2 weder in der DB noch in der Datei steht.
{
  const current = { ...empty(), a1a3LizenzAm: d1 };
  const fileValues = { ...empty(), bos1AusbildungAm: d2 };
  const result = resolveAusbildungUpdates(current, fileValues);
  assert.deepStrictEqual(result.updates, {});
  assert.deepStrictEqual(result.skippedMissingPrereq, [
    { stufe: 'bos1AusbildungAm', fehlendeVorstufe: 'a2LizenzAm' },
  ]);
  console.log('Test 3 OK: BOS1 übersprungen, A2 fehlt');
}

// 4. Vorstufe UND Zielstufe werden in DERSELBEN Zeile geliefert -> beide werden gesetzt.
{
  const current = { ...empty(), a1a3LizenzAm: d1 };
  const fileValues = { ...empty(), a2LizenzAm: d1, bos1AusbildungAm: d2 };
  const result = resolveAusbildungUpdates(current, fileValues);
  assert.deepStrictEqual(result.updates, { a2LizenzAm: d1, bos1AusbildungAm: d2 });
  assert.deepStrictEqual(result.skippedMissingPrereq, []);
  console.log('Test 4 OK: Vorstufe + Zielstufe in derselben Zeile werden beide gesetzt');
}

// 5. BOS1 wird gesetzt, OBWOHL Stützpunktausbildung nirgends in current/fileValues vorkommt - die
//    Funktion kennt dieses Feld strukturell gar nicht, das bestätigt die bewusste Ausnahme.
{
  const current = { ...empty(), a1a3LizenzAm: d1, a2LizenzAm: d1 };
  const fileValues = { ...empty(), bos1AusbildungAm: d2 };
  const result = resolveAusbildungUpdates(current, fileValues);
  assert.deepStrictEqual(result.updates, { bos1AusbildungAm: d2 });
  console.log('Test 5 OK: BOS1 gesetzt ohne Stützpunktausbildung');
}

console.log('Alle Tests bestanden.');
```

Ausführen: `npx tsx verify-ausbildung-import.ts`
Erwartet: alle 5 "OK"-Zeilen plus "Alle Tests bestanden.", kein Fehler/Stacktrace.

- [ ] **Step 5: Temporäres Skript löschen, typprüfen, committen**

```bash
rm verify-ausbildung-import.ts
npx tsc --noEmit
git add src/lib/drone/ausbildung-import-columns.ts src/lib/drone/ausbildung-import-helpers.ts src/lib/auth/permissions.ts
git commit -m "feat: add columns/prefix-chain helper and permission for Drohnen-Ausbildung import"
```

---

### Task 2: Server Action (Datei parsen, matchen, schreiben)

**Files:**
- Create: `src/app/(app)/admin/drohnen/ausbildung-import/actions.ts`

**Interfaces:**
- Consumes: `AUSBILDUNG_IMPORT_COLUMNS`, `AusbildungImportRow` (Task 1), `AUSBILDUNG_IMPORT_CHAIN`,
  `AusbildungStufe`, `resolveAusbildungUpdates` (Task 1), `canImportDroneAusbildung` (Task 1).
- Produces (für Task 3): `ImportAusbildungState` (Interface), `importAusbildung(prevState, formData):
  Promise<ImportAusbildungState>` — Signatur passend für `useActionState(importAusbildung, initialState)`
  (kein gebundener Parameter wie beim Atemschutz-Import, da dieser Import nicht org-gebunden ist).

- [ ] **Step 1: Server Action schreiben**

Erstelle `src/app/(app)/admin/drohnen/ausbildung-import/actions.ts`:

```typescript
'use server';

import ExcelJS from 'exceljs';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canImportDroneAusbildung } from '@/lib/auth/permissions';
import { AUSBILDUNG_IMPORT_COLUMNS, type AusbildungImportRow } from '@/lib/drone/ausbildung-import-columns';
import {
  AUSBILDUNG_IMPORT_CHAIN,
  resolveAusbildungUpdates,
  type AusbildungStufe,
} from '@/lib/drone/ausbildung-import-helpers';

export interface ImportAusbildungState {
  error?: string;
  result?: {
    updatedFields: number;
    skippedAlreadySet: number;
    skippedMissingPrereq: string[];
    skippedNotMember: number;
    emailMismatches: string[];
    errors: string[];
  };
}

/** exceljs kann für Rich-Text/Formel/Hyperlink/Fehler-Zellen ein Objekt statt eines primitiven Werts
 * liefern - ein bloßes String(...) würde das dann als "[object Object]" schreiben/vergleichen. Löst die
 * gängigen Fälle gezielt auf, bevor auf String(...) als letzten Fallback zurückgefallen wird. Identisch
 * zu atemschutz-import/actions.ts's eigener Kopie - bewusst dupliziert, nicht extrahiert (siehe
 * CLAUDE.md-Konvention: Duplikation statt verfrühter Abstraktion für zwei Aufrufstellen). */
function cellText(value: unknown): string {
  if (value && typeof value === 'object') {
    if ('richText' in value && Array.isArray((value as any).richText)) {
      return (value as any).richText.map((part: any) => part.text ?? '').join('');
    }
    if ('error' in value) return '';
    if ('result' in value) return String((value as any).result ?? '');
    if ('text' in value) return String((value as any).text ?? '');
  }
  return String(value ?? '');
}

/** Parst ein Datum aus einer Excel-Zelle - entweder ein von exceljs bereits als Date erkannter Zellwert
 * oder ein "dd.mm.yyyy"-Text. Liefert "YYYY-MM-DD" oder null. Identisch zu atemschutz-import/actions.ts's
 * eigener Kopie, siehe Kommentar dort. */
function parseExcelDateToIso(value: unknown): string | null {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = cellText(value).trim();
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

const STUFE_LABEL: Record<AusbildungStufe, string> = {
  a1a3LizenzAm: 'A1/A3',
  a2LizenzAm: 'A2',
  bos1AusbildungAm: 'BOS1',
  bos2AusbildungAm: 'BOS2',
};

const DATE_COLUMN_BY_STUFE: Record<AusbildungStufe, keyof AusbildungImportRow> = {
  a1a3LizenzAm: 'a1a3Datum',
  a2LizenzAm: 'a2Datum',
  bos1AusbildungAm: 'bos1Datum',
  bos2AusbildungAm: 'bos2Datum',
};

/**
 * Bezirksweit (nicht org-gebunden wie der Atemschutz-Import): FW-Nr löst die Feuerwehr auf, StbNr
 * matcht INNERHALB dieser Feuerwehr gegen User.stbNr (nicht global eindeutig) - mehrfach vorhandene
 * StbNr wird als nicht eindeutig zuordenbar abgelehnt statt eine willkürliche Zeile zu treffen. Nur
 * bereits bestehende DrohnengruppeMembership-Zeilen werden aktualisiert - der Import legt nie eine neue
 * an (siehe Design-Spec Abschnitt 2 Punkt 1). Pro der 4 Stufen wird nur ein aktuell leeres Feld befüllt,
 * nie ein bereits gesetztes überschrieben (resolveAusbildungUpdates, siehe Design-Spec Abschnitt 2 Punkt 2
 * und 3) - macht einen erneuten Import derselben Datei ungefährlich (0 Updates beim zweiten Lauf).
 */
export async function importAusbildung(
  _prevState: ImportAusbildungState,
  formData: FormData,
): Promise<ImportAusbildungState> {
  const user = await requireUser();
  assertPermission(canImportDroneAusbildung(user));

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Bitte eine Excel-Datei auswählen.' };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // Siehe atemschutz-import/actions.ts für die Begründung des any-Casts (exceljs bringt eine eigene,
    // alte @types/node-Kopie mit, strukturell inkompatibel mit unserer @types/node@22).
    await workbook.xlsx.load(buffer as any);
  } catch (error) {
    console.error('Ausbildungs-Import: Datei konnte nicht gelesen werden:', error);
    return { error: 'Datei konnte nicht gelesen werden. Bitte eine gültige .xlsx-Datei hochladen.' };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { error: 'Die Datei enthält kein Tabellenblatt.' };
  }

  const columnIndexByKey = new Map<keyof AusbildungImportRow, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const headerText = String(cell.value ?? '').trim();
    const match = AUSBILDUNG_IMPORT_COLUMNS.find((column) => column.header === headerText);
    if (match) columnIndexByKey.set(match.key, colNumber);
  });

  const missingColumns = AUSBILDUNG_IMPORT_COLUMNS.filter((column) => !columnIndexByKey.has(column.key));
  if (missingColumns.length > 0) {
    return { error: `Fehlende Spalten in der Kopfzeile: ${missingColumns.map((c) => c.header).join(', ')}.` };
  }

  const organizations = await prisma.organization.findMany({ select: { id: true, nummer: true } });
  const organizationIdByNummer = new Map(organizations.map((org) => [org.nummer, org.id]));

  const members = await prisma.user.findMany({
    select: {
      id: true,
      stbNr: true,
      email: true,
      homeOrganizationId: true,
      droneMembership: {
        select: { a1a3LizenzAm: true, a2LizenzAm: true, bos1AusbildungAm: true, bos2AusbildungAm: true },
      },
    },
  });
  const membersByOrgAndStbNr = new Map<string, typeof members>();
  for (const member of members) {
    if (!member.stbNr) continue;
    const key = `${member.homeOrganizationId}|${member.stbNr}`;
    const existing = membersByOrgAndStbNr.get(key) ?? [];
    existing.push(member);
    membersByOrgAndStbNr.set(key, existing);
  }

  const errors: string[] = [];
  const emailMismatches: string[] = [];
  const skippedMissingPrereq: string[] = [];
  let updatedFields = 0;
  let skippedAlreadySet = 0;
  let skippedNotMember = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const getValue = (key: keyof AusbildungImportRow): string => {
      const colIndex = columnIndexByKey.get(key);
      if (!colIndex) return '';
      return cellText(row.getCell(colIndex).value).trim();
    };

    const fwNr = getValue('fwNr');
    const stbNr = getValue('stbNr');
    const email = getValue('email');

    if (!fwNr && !stbNr) continue; // leere Zeile überspringen

    const organizationId = organizationIdByNummer.get(fwNr);
    if (!organizationId) {
      errors.push(`Zeile ${rowNumber}: Feuerwehr mit FW-Nr "${fwNr}" wurde nicht gefunden.`);
      continue;
    }

    const matched = membersByOrgAndStbNr.get(`${organizationId}|${stbNr}`);
    if (!matched || matched.length === 0) {
      errors.push(`Zeile ${rowNumber}: Standesbuchnummer "${stbNr}" wurde in dieser Feuerwehr nicht gefunden.`);
      continue;
    }
    if (matched.length > 1) {
      errors.push(`Zeile ${rowNumber}: Standesbuchnummer "${stbNr}" mehrfach vorhanden, Zeile übersprungen.`);
      continue;
    }
    const member = matched[0];

    if (email && member.email && email.toLowerCase() !== member.email.toLowerCase()) {
      emailMismatches.push(
        `Zeile ${rowNumber}: E-Mail in Datei ("${email}") weicht von gespeicherter Adresse ("${member.email}") ab.`,
      );
    }

    if (!member.droneMembership) {
      skippedNotMember++;
      continue;
    }

    const fileValues: Record<AusbildungStufe, Date | null> = {
      a1a3LizenzAm: null,
      a2LizenzAm: null,
      bos1AusbildungAm: null,
      bos2AusbildungAm: null,
    };
    let hasDateError = false;
    for (const stufe of AUSBILDUNG_IMPORT_CHAIN) {
      const colIndex = columnIndexByKey.get(DATE_COLUMN_BY_STUFE[stufe])!;
      const rawValue = row.getCell(colIndex).value;
      const text = cellText(rawValue).trim();
      if (!text) continue;
      const iso = parseExcelDateToIso(rawValue);
      if (!iso) {
        errors.push(`Zeile ${rowNumber}: Ungültiges Datum in ${STUFE_LABEL[stufe]} Datum.`);
        hasDateError = true;
        break;
      }
      fileValues[stufe] = new Date(iso);
    }
    if (hasDateError) continue;

    const current: Record<AusbildungStufe, Date | null> = {
      a1a3LizenzAm: member.droneMembership.a1a3LizenzAm,
      a2LizenzAm: member.droneMembership.a2LizenzAm,
      bos1AusbildungAm: member.droneMembership.bos1AusbildungAm,
      bos2AusbildungAm: member.droneMembership.bos2AusbildungAm,
    };

    const resolution = resolveAusbildungUpdates(current, fileValues);
    skippedAlreadySet += resolution.skippedAlreadySet.length;
    for (const { stufe, fehlendeVorstufe } of resolution.skippedMissingPrereq) {
      skippedMissingPrereq.push(
        `Zeile ${rowNumber}: ${STUFE_LABEL[stufe]} übersprungen, da ${STUFE_LABEL[fehlendeVorstufe]} fehlt.`,
      );
    }

    const updateKeys = Object.keys(resolution.updates) as AusbildungStufe[];
    if (updateKeys.length === 0) continue;

    try {
      await prisma.drohnengruppeMembership.update({
        where: { userId: member.id },
        data: resolution.updates,
      });
      updatedFields += updateKeys.length;
    } catch (error) {
      console.error(`Ausbildungs-Import Zeile ${rowNumber} fehlgeschlagen:`, error);
      errors.push(`Zeile ${rowNumber}: Unerwarteter Fehler beim Speichern.`);
    }
  }

  revalidatePath('/admin/drohnen');
  return {
    result: { updatedFields, skippedAlreadySet, skippedMissingPrereq, skippedNotMember, emailMismatches, errors },
  };
}
```

- [ ] **Step 2: Typprüfen**

```bash
npx tsc --noEmit
```
Erwartet: keine Fehler. Falls `droneMembership` als Feldname nicht gefunden wird, in
`prisma/schema.prisma` beim `User`-Model nachsehen, wie die Rückrelation zu `DrohnengruppeMembership`
tatsächlich heißt (Stand dieses Plans: `droneMembership`), und den Namen hier entsprechend anpassen -
nicht raten.

- [ ] **Step 3: Committen**

```bash
git add src/app/\(app\)/admin/drohnen/ausbildung-import/actions.ts
git commit -m "feat: add importAusbildung Server Action for Drohnen-Ausbildung bulk import"
```

---

### Task 3: Formular, Seite, Verlinkung + End-to-End-Verifikation

**Files:**
- Create: `src/app/(app)/admin/drohnen/ausbildung-import/import-form.tsx`
- Create: `src/app/(app)/admin/drohnen/ausbildung-import/page.tsx`
- Modify: `src/app/(app)/admin/drohnen/page.tsx`

**Interfaces:**
- Consumes: `importAusbildung`, `ImportAusbildungState` (Task 2); `canImportDroneAusbildung` (Task 1).
- Produces: nichts weiter (letzter Task).

- [ ] **Step 1: Formular schreiben**

Erstelle `src/app/(app)/admin/drohnen/ausbildung-import/import-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { importAusbildung, type ImportAusbildungState } from './actions';

const initialState: ImportAusbildungState = {};

export function ImportAusbildungForm() {
  const [state, formAction, pending] = useActionState(importAusbildung, initialState);

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700">Excel-Datei (.xlsx)</label>
          <input
            type="file"
            name="file"
            accept=".xlsx"
            required
            className="rounded border border-neutral-300 px-3 py-2"
          />
          <p className="text-xs text-neutral-500">
            Erwartet den FDISK-Ausbildungs-Export mit den Spalten FW-Nr, StbNr, email, A1/A3 Datum, A2
            Datum, BOS1 Datum, BOS2 Datum. Aktualisiert nur Mitglieder, die bereits einer Drohnengruppe
            angehören, und überschreibt nie bereits gesetzte Ausbildungsdaten.
          </p>
        </div>

        {state.error && <p className="text-sm text-red-700">{state.error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {pending ? 'Wird importiert…' : 'Importieren'}
          </button>
          <Link href="/admin/drohnen" className="text-sm text-neutral-600 hover:underline">
            Zur Drohnengruppen-Verwaltung
          </Link>
        </div>
      </form>

      {state.result && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-4 text-sm">
          <p className="font-medium text-neutral-900">
            {state.result.updatedFields} Felder aktualisiert, {state.result.skippedAlreadySet} übersprungen
            (bereits vorhanden), {state.result.skippedNotMember} Zeilen übersprungen (kein
            Drohnengruppen-Mitglied)
            {state.result.skippedMissingPrereq.length > 0
              ? `, ${state.result.skippedMissingPrereq.length} Felder übersprungen (Vorstufe fehlt)`
              : ''}
            {state.result.errors.length > 0 ? `, ${state.result.errors.length} mit Fehler` : ''}.
          </p>
          {state.result.skippedMissingPrereq.length > 0 && (
            <>
              <p className="mt-2 font-medium text-amber-700">Übersprungen (Vorstufe fehlt):</p>
              <ul className="list-disc pl-5 text-amber-700">
                {state.result.skippedMissingPrereq.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </>
          )}
          {state.result.emailMismatches.length > 0 && (
            <>
              <p className="mt-2 font-medium text-neutral-700">Hinweise (abweichende E-Mail):</p>
              <ul className="list-disc pl-5 text-neutral-700">
                {state.result.emailMismatches.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </>
          )}
          {state.result.errors.length > 0 && (
            <>
              <p className="mt-2 font-medium text-red-700">Fehler:</p>
              <ul className="list-disc pl-5 text-red-700">
                {state.result.errors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Seite anlegen**

Erstelle `src/app/(app)/admin/drohnen/ausbildung-import/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { canImportDroneAusbildung } from '@/lib/auth/permissions';
import { ImportAusbildungForm } from './import-form';

export default async function AusbildungImportPage() {
  const user = await requireUser();
  if (!canImportDroneAusbildung(user)) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900">Ausbildungsstufen importieren</h1>
      <ImportAusbildungForm />
    </div>
  );
}
```

- [ ] **Step 3: Link auf /admin/drohnen ergänzen**

In `src/app/(app)/admin/drohnen/page.tsx`:
1. Import ergänzen: `import { canImportDroneAusbildung } from '@/lib/auth/permissions';` (neben den
   bestehenden Imports ganz oben).
2. Direkt nach dem schließenden `</div>` des bestehenden "Einsatzbereitschaft"-Karten-Blocks (der Block,
   der bei `<h2 ...>Einsatzbereitschaft</h2>` beginnt und mit dem "Mitglieder exportieren"-Link endet,
   aktuell um Zeile 95-117) folgenden neuen Block einfügen:

```tsx
{canImportDroneAusbildung(user) && (
  <div className="rounded-lg bg-surface p-4 shadow-card">
    <h2 className="mb-1 text-[15px] font-semibold text-ink">Ausbildungsstufen importieren</h2>
    <p className="mb-3 text-sm text-ink-muted">
      FDISK-Export mit A1/A3-, A2-, BOS1- und BOS2-Ausbildungsdaten für bestehende
      Drohnengruppen-Mitglieder importieren, bezirksweit über alle Gruppen.
    </p>
    <Link
      href="/admin/drohnen/ausbildung-import"
      className="inline-block rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
    >
      Import öffnen
    </Link>
  </div>
)}
```

`user` ist auf dieser Seite bereits als `const user = await requireUser();` vorhanden (Zeile 40) - kein
zusätzlicher Fetch nötig. `Link` ist bereits importiert (`import Link from 'next/link';`, Zeile 1).

- [ ] **Step 4: Berechtigungsmatrix mit synthetischen SessionUser-Objekten verifizieren**

Erstelle im Repo-Root eine temporäre Datei `verify-ausbildung-permission.ts`:

```typescript
import assert from 'node:assert';
import { canImportDroneAusbildung } from './src/lib/auth/permissions';
import type { SessionUser } from './src/types/next-auth';

function baseUser(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: 'u1',
    email: 'u1@example.com',
    name: 'Test User',
    homeOrganizationId: 'org1',
    homeOrganizationType: 'FEUERWEHR',
    secondaryOrganizationId: null,
    homeAbschnittOrganizationId: 'abschnitt1',
    feuerwehrAdminOrgIds: [],
    abschnittAdminOrgIds: [],
    isBezirksAdmin: false,
    isBezirksDrohnenAdmin: false,
    isAbschnittskommandoMitglied: false,
    isDrohnengruppeMember: false,
    droneGroupId: null,
    droneGroupRole: null,
    ...overrides,
  };
}

assert.strictEqual(canImportDroneAusbildung(baseUser({ isBezirksAdmin: true })), true, 'Bezirksadmin');
assert.strictEqual(
  canImportDroneAusbildung(baseUser({ isBezirksDrohnenAdmin: true })),
  true,
  'Bezirks-Drohnenadmin',
);
assert.strictEqual(
  canImportDroneAusbildung(baseUser({ droneGroupRole: 'ADMIN', droneGroupId: 'group1' })),
  false,
  'einzelner Gruppen-Admin ohne Bezirksrecht',
);
assert.strictEqual(canImportDroneAusbildung(baseUser({})), false, 'einfaches Mitglied');

console.log('Alle Berechtigungs-Tests bestanden.');
```

Ausführen: `npx tsx verify-ausbildung-permission.ts`. Erwartet: "Alle Berechtigungs-Tests bestanden.",
kein Fehler.

Danach löschen: `rm verify-ausbildung-permission.ts`.

- [ ] **Step 5: End-to-End gegen die lokale Dev-Datenbank verifizieren**

Voraussetzung: lokale Dev-Datenbank läuft und enthält mindestens eine Feuerwehr mit bekannter `nummer`
und mindestens einen `User` mit `stbNr` und bestehender `DrohnengruppeMembership`-Zeile (bei Bedarf mit
`npx prisma studio` oder einem kurzen Skript anlegen/prüfen).

Erstelle eine kleine Test-Excel-Datei mit `exceljs` (Repo-Root, temporär) oder nutze ein vorhandenes
Skript-Muster wie in früheren Import-Features dieses Projekts, mit Spalten exakt wie in
`AUSBILDUNG_IMPORT_COLUMNS` (`FW-Nr`, `StbNr`, `email`, `A1/A3 Datum`, `A2 Datum`, `BOS1 Datum`,
`BOS2 Datum`) und mindestens folgenden Zeilen gegen einen bekannten Test-User:
1. Eine Zeile, die ein aktuell leeres Feld befüllt (z. B. BOS1, wenn A1/A3+A2 bereits gesetzt sind).
2. Dieselbe Datei ein zweites Mal importiert - erwartet `updatedFields: 0` beim zweiten Lauf
   (Idempotenz-Nachweis).
3. Eine Zeile mit abweichender E-Mail - erwartet einen Eintrag in `emailMismatches`, aber die
   gespeicherte `User.email` bleibt unverändert (direkt per `psql`/Prisma Studio nachsehen).
4. Eine Zeile mit unbekannter FW-Nr oder StbNr - erwartet einen Eintrag in `errors`.

Am einfachsten über die echte Server Action, nicht nur simuliert: `npm run dev` starten, als
Bezirksadmin/Bezirks-Drohnenadmin einloggen, `/admin/drohnen/ausbildung-import` aufrufen, Testdatei
hochladen, Ergebnis-Zusammenfassung mit den obigen Erwartungen abgleichen. Danach die Testdaten
(Datei, ggf. angelegte Test-User) wieder entfernen/zurücksetzen.

- [ ] **Step 6: Vollständige Verifikation und Commit**

```bash
npx tsc --noEmit
npm run build
git add src/app/\(app\)/admin/drohnen/ausbildung-import/import-form.tsx src/app/\(app\)/admin/drohnen/ausbildung-import/page.tsx src/app/\(app\)/admin/drohnen/page.tsx
git commit -m "feat: add UI and admin/drohnen link for Ausbildung bulk import"
```
