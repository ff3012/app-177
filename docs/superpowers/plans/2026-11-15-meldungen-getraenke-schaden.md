# Meldungen "Getränkeautomat" und "Schadensmeldung" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zwei einfache Meldeformulare (Getränkeautomat, Schadensmeldung), die am iPad-Kiosk und in der App ausgefüllt werden und als E-Mail an eine je Feuerwehr einstellbare Empfängerliste gehen. Nichts wird gespeichert.

**Architecture:** Neue Tabelle `NotificationFormSetting` (je Feuerwehr und Formular `enabled`, `recipients`, beim Getränkeautomat `products`). Ein gemeinsamer Kern `submitNotificationCore` (reine Validierung in `notification-input.ts`, Versand in `notify-notification-form.ts`) wird von einer Kiosk-Abgabe (Link, Limit) und einer App-Aktion (Sitzung) aufgerufen. Eine gemeinsame Komponente `NotificationFormView` rendert beide Formulare in Tablet- und Handy-Layout. Startbildschirm, Berichtsblatt der App und Verwaltung bekommen die neuen Zustände.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 6 (PostgreSQL), Tailwind 3, vitest 5, lucide-react, Mailjet (`sendEmail`).

**Spec:** `docs/superpowers/specs/2026-11-15-meldungen-getraenke-schaden-design.md` (vom App-Betreiber freigegeben).

## Global Constraints

- Alle sichtbaren Texte deutsch. Code-Bezeichner: deutsch/englisch gemischt, in jeder Datei der dortigen Konvention folgen.
- **Git:** Arbeit auf Branch `feature/meldungen` (von `main`; der Controller legt ihn vor Aufgabe 1 an). Pro Aufgabe ein Commit mit **ausdrücklich genannten Dateien** (`git add <pfad> ...`), **nie** `git add -A`/`git add .`. `android/`, jede `AGENTS.md`, `docs/agents/` und `.superpowers/` nie committen. **Nie pushen.** Commit-Nachricht deutsch, Endzeile: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Zeilenenden:** Arbeitsbaum CRLF, Index LF (`core.autocrlf=true`). Bestehende Dateien nur per Edit-Werkzeug ändern (nur dort, wo ausdrücklich "vollständig ersetzen" steht, das Write-Werkzeug nutzen und danach `git diff --cached --stat` prüfen), neue Dateien mit LF anlegen. `git diff --cached --stat` darf kein Ganzdatei-Rauschen zeigen.
- **Datenbank-Tests** (`*.db.test.ts`, `npm run test:db`) laufen **nur gegen die lokale Dev-Datenbank** (Docker-Container `app-177-postgres-1`, `DATABASE_URL` in `.env` zeigt auf localhost; nie Werte aus `.env` ausgeben, nie `bash -x`). Fixtures mit eindeutigem Präfix (`const RUN = \`...-${Date.now()}\``), Aufräumen **geschützt** (nie ein `deleteMany`-Filter, der `undefined` sein kann; Id-Listen vorher auf Leere prüfen). Die Zeilen von `NotificationFormSetting` verschwinden per `onDelete: Cascade` mit der Fixture-Organisation.
- **Migration:** nie `prisma migrate dev` (bekannter Reihenfolge-Fehler der Historie), nie `prisma migrate reset`. Ordner von Hand, DDL aus `prisma migrate diff`, lokal `npx prisma migrate deploy`, dann `npx prisma generate`. `DATABASE_URL` nur für den jeweiligen Prisma-Aufruf in die Prozessumgebung laden (z. B. `set -a; . ./.env; set +a; npx prisma ...` in einem Aufruf), nie ausgeben. Bestehende Migrationen nie ändern.
- **E-Mails in Tests mocken:** `vi.mock('@/lib/email/mailjet', () => ({ sendEmail: vi.fn(async () => undefined) }))`, damit die lokale `.env` nie echte Mails sendet.
- **Keine neue Umgebungsvariable, keine neue Abhängigkeit.** `docker/docker-compose.yml` bleibt unverändert.
- Nach jeder Aufgabe `npx tsc --noEmit` sauber. Letzte Aufgabe zusätzlich `npm test`, `npm run test:db`, `npm run build`.
- Berichte (`Report`, `ReportTypeSetting`, Berichts-Abgabe) bleiben unverändert.
- Die Kernregel der Spec: Ein Formular ist nur **verfügbar**, wenn es eingeschaltet ist **und** mindestens einen Empfänger hat.

## Datei-Übersicht

Neu:
- `prisma/migrations/20261115110000_notification_form_setting/migration.sql` (Aufgabe 1)
- `src/lib/heimatfeuerwehr/notification-form-constants.ts` (+ `.test.ts`), `notification-form-settings.ts` (+ `.test.ts`, `.db.test.ts`) (Aufgabe 1)
- `src/lib/heimatfeuerwehr/notification-input.ts` (+ `.test.ts`), `notify-notification-form.ts` (+ `.test.ts`), `submit-notification-core.ts` (+ `.db.test.ts`) (Aufgabe 2)
- `src/lib/heimatfeuerwehr/report-kiosk-notification-submit.ts` (+ `.db.test.ts`), `src/app/(app)/meine-feuerwehr/meldungen/actions.ts` (+ `actions.db.test.ts`) (Aufgabe 3)
- `src/lib/heimatfeuerwehr/notification-form-fields.ts` (+ `.test.ts`), `src/components/heimatfeuerwehr/notification-form-view.tsx` (+ `.test.ts`) (Aufgabe 4)
- `src/app/(app)/admin/heimatfeuerwehr/notification-form-row.tsx`, `drink-products-form.tsx` (Aufgabe 5)
- `src/app/(app)/meine-feuerwehr/meldungen/[formular]/page.tsx`, `meldung-client.tsx` (Aufgabe 6)

Geändert:
- `prisma/schema.prisma` (Aufgabe 1)
- `src/app/(app)/admin/heimatfeuerwehr/actions.ts`, `report-recipients-form.tsx`, `report-type-row.tsx`, `page.tsx` (Aufgabe 5)
- `src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.tsx` (+ Test), `meine-feuerwehr/action-row.tsx`, `meine-feuerwehr/page.tsx` (Aufgabe 6)
- `src/lib/heimatfeuerwehr/kiosk-tiles.ts` (+ Test), `report-kiosk-data.ts` (+ Test), `src/app/berichte-schnell/[token]/{actions.ts,kiosk-form-screen.tsx,kiosk-flow.tsx,kiosk-flow.test.ts,page.tsx}` (Aufgabe 7)
- `src/app/(app)/meine-feuerwehr/CLAUDE.md` (Aufgabe 8)

---

### Task 1: Datenmodell und Einstellungs-Bibliothek

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261115110000_notification_form_setting/migration.sql`
- Create: `src/lib/heimatfeuerwehr/notification-form-constants.ts`, `notification-form-constants.test.ts`
- Create: `src/lib/heimatfeuerwehr/notification-form-settings.ts`, `notification-form-settings.test.ts`, `notification-form-settings.db.test.ts`

**Interfaces:**
- Produces (`notification-form-constants.ts`, **rein, ohne Datenbank, auch für Client-Komponenten importierbar**):
  - `NOTIFICATION_FORMS: readonly NotificationForm[]` (`['DRINKS', 'DAMAGE']`), `NOTIFICATION_FORM_LABEL`, `NOTIFICATION_FORM_SLUG` (`DRINKS` → `getraenkeautomat`, `DAMAGE` → `schadensmeldung`), `DEFAULT_DRINK_PRODUCTS`, `DRINK_PRODUCTS_MAX = 12`, `DRINK_PRODUCT_MAX_LENGTH = 30`
  - `type NotificationFormState = 'available' | 'norecipient' | 'off'`
  - `isNotificationForm(value: unknown): value is NotificationForm`, `formFromSlug(slug: string): NotificationForm | null`
  - `parseDrinkProducts(raw: unknown): { ok: true; value: string[] } | { ok: false; error: string }` (trimmt und fasst Leerzeichen zusammen, verwirft leere Einträge und Doppelte (Groß-/Kleinschreibung ignoriert), höchstens 12, je höchstens 30 Zeichen; leere Liste ist erlaubt = Standardliste)
  - `resolveProducts(stored: readonly string[]): string[]` (leer = Standardprodukte), `notificationFormState(setting: { enabled: boolean; recipients: readonly string[] }): NotificationFormState`
- Produces (`notification-form-settings.ts`, mit Datenbank):
  - `interface NotificationFormSettingValue { enabled: boolean; recipients: string[]; products: string[] }` (`products` bei `DAMAGE` immer `[]`, bei `DRINKS` bereits aufgelöst)
  - `resolveNotificationFormSettings(rows)` (rein), `getNotificationFormSettings(organizationId): Promise<Record<NotificationForm, NotificationFormSettingValue>>`, `getNotificationFormSetting(organizationId, form)`, `getNotificationFormStates(organizationId): Promise<Record<NotificationForm, NotificationFormState>>`
  - `saveNotificationFormEnabled(organizationId, form: string, enabled)`, `saveNotificationFormRecipients(organizationId, form: string, recipients: string[])`, `saveDrinkProducts(organizationId, products: unknown)` (je `upsert`; werfen `Error('Dieses Formular ist nicht verfügbar.')` für unbekannte Formulare, `Error('Meldungen gibt es nur für Feuerwehren.')` für Organisationen, die keine `FEUERWEHR` sind, und bei ungültiger Produktliste die Fehlermeldung von `parseDrinkProducts`)

- [ ] **Step 1: Branch prüfen**

Der Controller hat `feature/meldungen` angelegt und ausgecheckt (`git branch --show-current`). Die Dateien `docs/superpowers/specs/2026-11-15-meldungen-getraenke-schaden-design.md` und `docs/superpowers/plans/2026-11-15-meldungen-getraenke-schaden.md` sind ungetrackt und kommen in den Commit dieser Aufgabe.

- [ ] **Step 2: Reine Tests schreiben (`notification-form-constants.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRINK_PRODUCTS,
  DRINK_PRODUCTS_MAX,
  DRINK_PRODUCT_MAX_LENGTH,
  formFromSlug,
  isNotificationForm,
  notificationFormState,
  parseDrinkProducts,
  resolveProducts,
} from './notification-form-constants';

describe('formFromSlug / isNotificationForm', () => {
  it('ordnet die URL-Kennungen den Formularen zu', () => {
    expect(formFromSlug('getraenkeautomat')).toBe('DRINKS');
    expect(formFromSlug('schadensmeldung')).toBe('DAMAGE');
    expect(formFromSlug('einsatzbericht')).toBeNull();
    expect(formFromSlug('')).toBeNull();
  });

  it('erkennt nur die beiden Formulare', () => {
    expect(isNotificationForm('DRINKS')).toBe(true);
    expect(isNotificationForm('DAMAGE')).toBe(true);
    expect(isNotificationForm('INCIDENT')).toBe(false);
    expect(isNotificationForm(undefined)).toBe(false);
    expect(isNotificationForm(42)).toBe(false);
  });
});

describe('parseDrinkProducts', () => {
  it('trimmt, fasst Leerzeichen zusammen und verwirft leere und doppelte Einträge', () => {
    expect(parseDrinkProducts(['  Bier ', 'Spritzer', '', '   ', 'bier', 'Eistee  kalt'])).toEqual({
      ok: true,
      value: ['Bier', 'Spritzer', 'Eistee kalt'],
    });
  });

  it('erlaubt eine leere Liste (= Standardprodukte)', () => {
    expect(parseDrinkProducts([])).toEqual({ ok: true, value: [] });
  });

  it('lehnt zu lange Namen und zu viele Produkte ab', () => {
    expect(parseDrinkProducts(['a'.repeat(DRINK_PRODUCT_MAX_LENGTH + 1)])).toEqual({
      ok: false,
      error: `Ein Produktname darf höchstens ${DRINK_PRODUCT_MAX_LENGTH} Zeichen haben.`,
    });
    const many = Array.from({ length: DRINK_PRODUCTS_MAX + 1 }, (_, i) => `Produkt ${i}`);
    expect(parseDrinkProducts(many)).toEqual({ ok: false, error: `Höchstens ${DRINK_PRODUCTS_MAX} Produkte.` });
    expect(parseDrinkProducts(many.slice(0, DRINK_PRODUCTS_MAX)).ok).toBe(true);
  });

  it('lehnt Nicht-Listen und Nicht-Text ab', () => {
    expect(parseDrinkProducts('Bier')).toEqual({ ok: false, error: 'Ungültige Eingabe.' });
    expect(parseDrinkProducts(['Bier', 42])).toEqual({ ok: false, error: 'Ungültige Eingabe.' });
    expect(parseDrinkProducts(null)).toEqual({ ok: false, error: 'Ungültige Eingabe.' });
  });
});

describe('resolveProducts / notificationFormState', () => {
  it('nimmt bei leerer Liste die Standardprodukte', () => {
    expect(resolveProducts([])).toEqual([...DEFAULT_DRINK_PRODUCTS]);
    expect(resolveProducts(['Cola'])).toEqual(['Cola']);
  });

  it('verfügbar nur bei eingeschaltet UND mindestens einem Empfänger', () => {
    expect(notificationFormState({ enabled: true, recipients: ['a@x.at'] })).toBe('available');
    expect(notificationFormState({ enabled: true, recipients: [] })).toBe('norecipient');
    expect(notificationFormState({ enabled: false, recipients: ['a@x.at'] })).toBe('off');
    expect(notificationFormState({ enabled: false, recipients: [] })).toBe('off');
  });
});
```

Run: `npx vitest run src/lib/heimatfeuerwehr/notification-form-constants.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: `notification-form-constants.ts` schreiben**

```ts
import type { NotificationForm } from '@prisma/client';

/** Reine Konstanten und Logik (keine Datenbank): darf auch von Client-Komponenten importiert werden. */

export const NOTIFICATION_FORMS: readonly NotificationForm[] = ['DRINKS', 'DAMAGE'];

export const NOTIFICATION_FORM_LABEL: Record<NotificationForm, string> = {
  DRINKS: 'Getränkeautomat',
  DAMAGE: 'Schadensmeldung',
};

/** Kennung in der URL der App-Seiten (/meine-feuerwehr/meldungen/<kennung>). */
export const NOTIFICATION_FORM_SLUG: Record<NotificationForm, string> = {
  DRINKS: 'getraenkeautomat',
  DAMAGE: 'schadensmeldung',
};

export const DEFAULT_DRINK_PRODUCTS: readonly string[] = ['Bier', 'Spritzer', 'Eistee', 'Spezi'];
export const DRINK_PRODUCTS_MAX = 12;
export const DRINK_PRODUCT_MAX_LENGTH = 30;

/** verfügbar = eingeschaltet und mindestens ein Empfänger; norecipient = eingeschaltet ohne Empfänger; off = abgeschaltet. */
export type NotificationFormState = 'available' | 'norecipient' | 'off';

export function isNotificationForm(value: unknown): value is NotificationForm {
  return typeof value === 'string' && (NOTIFICATION_FORMS as readonly string[]).includes(value);
}

export function formFromSlug(slug: string): NotificationForm | null {
  return NOTIFICATION_FORMS.find((form) => NOTIFICATION_FORM_SLUG[form] === slug) ?? null;
}

export type ParsedProducts = { ok: true; value: string[] } | { ok: false; error: string };

/** Produktliste aus Formular/Client: getrimmt, ohne leere und doppelte Einträge, höchstens 12 je höchstens 30 Zeichen. */
export function parseDrinkProducts(raw: unknown): ParsedProducts {
  if (!Array.isArray(raw)) return { ok: false, error: 'Ungültige Eingabe.' };
  const seen = new Set<string>();
  const value: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return { ok: false, error: 'Ungültige Eingabe.' };
    const name = item.replace(/\s+/g, ' ').trim();
    if (name.length === 0) continue;
    if (name.length > DRINK_PRODUCT_MAX_LENGTH) {
      return { ok: false, error: `Ein Produktname darf höchstens ${DRINK_PRODUCT_MAX_LENGTH} Zeichen haben.` };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    value.push(name);
  }
  if (value.length > DRINK_PRODUCTS_MAX) return { ok: false, error: `Höchstens ${DRINK_PRODUCTS_MAX} Produkte.` };
  return { ok: true, value };
}

/** Eine gespeicherte leere Liste bedeutet die Standardprodukte. */
export function resolveProducts(stored: readonly string[]): string[] {
  return stored.length > 0 ? [...stored] : [...DEFAULT_DRINK_PRODUCTS];
}

export function notificationFormState(setting: { enabled: boolean; recipients: readonly string[] }): NotificationFormState {
  if (!setting.enabled) return 'off';
  return setting.recipients.length > 0 ? 'available' : 'norecipient';
}
```

(Der Import `NotificationForm` aus `@prisma/client` wird erst nach Schritt 5 typgültig; Schritt 3 deshalb erst nach `prisma generate` ausführen, oder die Datei schreiben und die Typprüfung/Tests nach Schritt 5 starten.)

- [ ] **Step 4: Schema ändern**

In `prisma/schema.prisma`:

1. Direkt hinter `model ReportTypeSetting { ... }` einfügen:

```prisma
enum NotificationForm {
  DRINKS
  DAMAGE
}

// Einstellungen je Feuerwehr und Meldeformular (Getränkeautomat, Schadensmeldung): ob das Formular in App und am
// iPad angeboten wird, wer die Meldung per E-Mail erhält und (nur DRINKS) die Produktliste. Keine Zeile =
// eingeschaltet, keine Empfänger, Standardprodukte. Verfügbar ist ein Formular nur mit mindestens einem Empfänger.
// Die Meldungen selbst werden nicht gespeichert.
model NotificationFormSetting {
  id             String           @id @default(cuid())
  organizationId String
  form           NotificationForm
  enabled        Boolean          @default(true)
  recipients     String[]         @default([])
  products       String[]         @default([])
  updatedAt      DateTime         @updatedAt
  organization   Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, form])
}
```

2. Im Modell `Organization` direkt unter der Zeile `reportTypeSettings ReportTypeSetting[]` ergänzen:

```prisma
  notificationFormSettings NotificationFormSetting[]
```

- [ ] **Step 5: Migration erzeugen und anwenden**

Exakte DDL von Prisma erzeugen lassen (die lokale Datenbank kennt die neue Tabelle noch nicht):

```bash
set -a; . ./.env; set +a; npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

Die Ausgabe (`CREATE TYPE "NotificationForm" ...`, `CREATE TABLE "NotificationFormSetting" ...`, Unique-Index, Fremdschlüssel) **wörtlich** in `prisma/migrations/20261115110000_notification_form_setting/migration.sql` übernehmen (kein Backfill nötig). Dann:

```bash
set -a; . ./.env; set +a; npx prisma migrate deploy
npx prisma generate
set -a; . ./.env; set +a; npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

Expected: `20261115110000_notification_form_setting` wird angewendet; der letzte Befehl meldet "-- This is an empty migration." (Eine Meldung wie `line 28: ...: command not found` beim Einlesen der `.env` ist bekannt und harmlos, solange `DATABASE_URL` geladen wird.)

Run: `npx vitest run src/lib/heimatfeuerwehr/notification-form-constants.test.ts` — Expected PASS.

- [ ] **Step 6: Reine Test für die Auflösung schreiben (`notification-form-settings.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRINK_PRODUCTS } from './notification-form-constants';
import { resolveNotificationFormSettings } from './notification-form-settings';

describe('resolveNotificationFormSettings', () => {
  it('ohne Zeilen: eingeschaltet, keine Empfänger, Standardprodukte beim Getränkeautomat', () => {
    expect(resolveNotificationFormSettings([])).toEqual({
      DRINKS: { enabled: true, recipients: [], products: [...DEFAULT_DRINK_PRODUCTS] },
      DAMAGE: { enabled: true, recipients: [], products: [] },
    });
  });

  it('übernimmt gespeicherte Zeilen; leere Produktliste = Standardprodukte; Schadensmeldung hat nie Produkte', () => {
    const result = resolveNotificationFormSettings([
      { form: 'DRINKS', enabled: false, recipients: ['a@x.at'], products: ['Cola', 'Wasser'] },
      { form: 'DAMAGE', enabled: true, recipients: ['b@x.at'], products: ['Unsinn'] },
    ]);
    expect(result.DRINKS).toEqual({ enabled: false, recipients: ['a@x.at'], products: ['Cola', 'Wasser'] });
    expect(result.DAMAGE).toEqual({ enabled: true, recipients: ['b@x.at'], products: [] });
    expect(
      resolveNotificationFormSettings([{ form: 'DRINKS', enabled: true, recipients: [], products: [] }]).DRINKS.products,
    ).toEqual([...DEFAULT_DRINK_PRODUCTS]);
  });
});
```

Run: Expected FAIL (Modul fehlt).

- [ ] **Step 7: `notification-form-settings.ts` schreiben**

```ts
import type { NotificationForm } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  NOTIFICATION_FORMS,
  isNotificationForm,
  notificationFormState,
  parseDrinkProducts,
  resolveProducts,
  type NotificationFormState,
} from './notification-form-constants';

export interface NotificationFormSettingValue {
  enabled: boolean;
  recipients: string[];
  /** Nur DRINKS (bereits aufgelöst: leer gespeichert = Standardprodukte); bei DAMAGE immer leer. */
  products: string[];
}

/** Reine Logik: Einstellung je Formular; fehlende Zeile = eingeschaltet, keine Empfänger, Standardprodukte. */
export function resolveNotificationFormSettings(
  rows: { form: string; enabled: boolean; recipients: string[]; products: string[] }[],
): Record<NotificationForm, NotificationFormSettingValue> {
  const entries = NOTIFICATION_FORMS.map((form) => {
    const row = rows.find((candidate) => candidate.form === form);
    const products = form === 'DRINKS' ? resolveProducts(row?.products ?? []) : [];
    return [form, { enabled: row ? row.enabled : true, recipients: row ? [...row.recipients] : [], products }] as const;
  });
  return Object.fromEntries(entries) as Record<NotificationForm, NotificationFormSettingValue>;
}

export async function getNotificationFormSettings(organizationId: string): Promise<Record<NotificationForm, NotificationFormSettingValue>> {
  const rows = await prisma.notificationFormSetting.findMany({
    where: { organizationId },
    select: { form: true, enabled: true, recipients: true, products: true },
  });
  return resolveNotificationFormSettings(rows);
}

export async function getNotificationFormSetting(organizationId: string, form: NotificationForm): Promise<NotificationFormSettingValue> {
  return (await getNotificationFormSettings(organizationId))[form];
}

export async function getNotificationFormStates(organizationId: string): Promise<Record<NotificationForm, NotificationFormState>> {
  const settings = await getNotificationFormSettings(organizationId);
  return Object.fromEntries(NOTIFICATION_FORMS.map((form) => [form, notificationFormState(settings[form])])) as Record<
    NotificationForm,
    NotificationFormState
  >;
}

async function assertConfigurable(organizationId: string, form: string): Promise<NotificationForm> {
  if (!isNotificationForm(form)) throw new Error('Dieses Formular ist nicht verfügbar.');
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, type: 'FEUERWEHR' },
    select: { id: true },
  });
  if (!organization) throw new Error('Meldungen gibt es nur für Feuerwehren.');
  return form;
}

export async function saveNotificationFormEnabled(organizationId: string, form: string, enabled: boolean): Promise<void> {
  const validForm = await assertConfigurable(organizationId, form);
  await prisma.notificationFormSetting.upsert({
    where: { organizationId_form: { organizationId, form: validForm } },
    create: { organizationId, form: validForm, enabled },
    update: { enabled },
  });
}

export async function saveNotificationFormRecipients(organizationId: string, form: string, recipients: string[]): Promise<void> {
  const validForm = await assertConfigurable(organizationId, form);
  const unique = [...new Set(recipients)];
  await prisma.notificationFormSetting.upsert({
    where: { organizationId_form: { organizationId, form: validForm } },
    create: { organizationId, form: validForm, recipients: unique },
    update: { recipients: unique },
  });
}

/** Produktliste des Getränkeautomaten (leer gespeichert = Standardprodukte). Ungültige Listen werden abgelehnt. */
export async function saveDrinkProducts(organizationId: string, products: unknown): Promise<void> {
  await assertConfigurable(organizationId, 'DRINKS');
  const parsed = parseDrinkProducts(products);
  if (!parsed.ok) throw new Error(parsed.error);
  await prisma.notificationFormSetting.upsert({
    where: { organizationId_form: { organizationId, form: 'DRINKS' } },
    create: { organizationId, form: 'DRINKS', products: parsed.value },
    update: { products: parsed.value },
  });
}
```

Run den Test aus Step 6: Expected PASS.

- [ ] **Step 8: DB-Test schreiben (`notification-form-settings.db.test.ts`)**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { DEFAULT_DRINK_PRODUCTS } from './notification-form-constants';
import {
  getNotificationFormSetting,
  getNotificationFormSettings,
  getNotificationFormStates,
  saveDrinkProducts,
  saveNotificationFormEnabled,
  saveNotificationFormRecipients,
} from './notification-form-settings';

const RUN = `nfs-${Date.now()}`;
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

describe('Einstellungen der Meldeformulare', () => {
  it('ohne Zeile: eingeschaltet, keine Empfänger (norecipient), Standardprodukte', async () => {
    expect(await getNotificationFormSettings(feuerwehrId)).toEqual({
      DRINKS: { enabled: true, recipients: [], products: [...DEFAULT_DRINK_PRODUCTS] },
      DAMAGE: { enabled: true, recipients: [], products: [] },
    });
    expect(await getNotificationFormStates(feuerwehrId)).toEqual({ DRINKS: 'norecipient', DAMAGE: 'norecipient' });
  });

  it('Empfänger machen ein Formular verfügbar; abgeschaltet ist es "off", die Empfänger bleiben', async () => {
    await saveNotificationFormRecipients(feuerwehrId, 'DAMAGE', ['a@example.local', 'a@example.local', 'b@example.local']);
    expect((await getNotificationFormSetting(feuerwehrId, 'DAMAGE')).recipients).toEqual(['a@example.local', 'b@example.local']);
    expect((await getNotificationFormStates(feuerwehrId)).DAMAGE).toBe('available');

    await saveNotificationFormEnabled(feuerwehrId, 'DAMAGE', false);
    expect((await getNotificationFormStates(feuerwehrId)).DAMAGE).toBe('off');
    expect((await getNotificationFormSetting(feuerwehrId, 'DAMAGE')).recipients).toEqual(['a@example.local', 'b@example.local']);
    await saveNotificationFormEnabled(feuerwehrId, 'DAMAGE', true);
    expect((await getNotificationFormStates(feuerwehrId)).DAMAGE).toBe('available');
  });

  it('hält die Formulare getrennt: der Getränkeautomat bleibt unberührt', async () => {
    expect((await getNotificationFormSetting(feuerwehrId, 'DRINKS')).recipients).toEqual([]);
    await saveNotificationFormRecipients(feuerwehrId, 'DRINKS', ['c@example.local']);
    expect((await getNotificationFormSetting(feuerwehrId, 'DAMAGE')).recipients).toEqual(['a@example.local', 'b@example.local']);
  });

  it('speichert die Produktliste, leer = Standardprodukte, und lehnt ungültige Listen ab', async () => {
    await saveDrinkProducts(feuerwehrId, ['  Cola ', 'Wasser', 'cola']);
    expect((await getNotificationFormSetting(feuerwehrId, 'DRINKS')).products).toEqual(['Cola', 'Wasser']);
    expect((await getNotificationFormSetting(feuerwehrId, 'DRINKS')).recipients).toEqual(['c@example.local']);

    await saveDrinkProducts(feuerwehrId, []);
    expect((await getNotificationFormSetting(feuerwehrId, 'DRINKS')).products).toEqual([...DEFAULT_DRINK_PRODUCTS]);

    await expect(saveDrinkProducts(feuerwehrId, ['a'.repeat(31)])).rejects.toThrow('höchstens 30 Zeichen');
    await expect(saveDrinkProducts(feuerwehrId, 'Bier')).rejects.toThrow('Ungültige Eingabe.');
  });

  it('lehnt unbekannte Formulare und Organisationen ab, die keine Feuerwehr sind', async () => {
    await expect(saveNotificationFormEnabled(feuerwehrId, 'INCIDENT', true)).rejects.toThrow('nicht verfügbar');
    await expect(saveNotificationFormRecipients(feuerwehrId, 'FOO', [])).rejects.toThrow('nicht verfügbar');
    await expect(saveNotificationFormEnabled(abschnittId, 'DRINKS', false)).rejects.toThrow('nur für Feuerwehren');
    await expect(saveDrinkProducts(abschnittId, ['Bier'])).rejects.toThrow('nur für Feuerwehren');
  });
});
```

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/notification-form-settings.db.test.ts`
Expected: PASS (5 Tests).

- [ ] **Step 9: Typen, Tests, Commit**

```bash
npx tsc --noEmit
npm test
git add prisma/schema.prisma prisma/migrations/20261115110000_notification_form_setting/migration.sql \
  src/lib/heimatfeuerwehr/notification-form-constants.ts src/lib/heimatfeuerwehr/notification-form-constants.test.ts \
  src/lib/heimatfeuerwehr/notification-form-settings.ts src/lib/heimatfeuerwehr/notification-form-settings.test.ts \
  src/lib/heimatfeuerwehr/notification-form-settings.db.test.ts \
  docs/superpowers/specs/2026-11-15-meldungen-getraenke-schaden-design.md \
  docs/superpowers/plans/2026-11-15-meldungen-getraenke-schaden.md
git commit -m "feat: Meldeformulare - Datenmodell und Einstellungs-Bibliothek (Spec, Plan)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Validierung, E-Mail und gemeinsamer Kern

**Files:**
- Create: `src/lib/heimatfeuerwehr/notification-input.ts`, `notification-input.test.ts`
- Create: `src/lib/heimatfeuerwehr/notify-notification-form.ts`, `notify-notification-form.test.ts`
- Create: `src/lib/heimatfeuerwehr/submit-notification-core.ts`, `submit-notification-core.db.test.ts`

**Interfaces:**
- Produces (`notification-input.ts`, **rein, ohne Datenbank, auch für Client-Komponenten importierbar**):
  - `type NotificationInput = { form: 'DRINKS'; products: string[]; note: string | null } | { form: 'DAMAGE'; occurredOn: string; equipment: string; acute: boolean | null; description: string }`
  - `NOTE_MAX = 1000`, `EQUIPMENT_MAX = 120`, `DESCRIPTION_MAX = 2000`, `MAX_DAYS_BACK = 365`
  - `viennaToday(now?: Date): string` (`YYYY-MM-DD` in Wiener Zeit)
  - `validateNotificationInput(raw: unknown, ctx: { products: readonly string[]; today: string }): { ok: true; value: NotificationInput } | { ok: false; error: string }`
- Produces (`notify-notification-form.ts`): `interface NotificationMailContext { organizationName: string; senderName: string; senderEmail: string | null; sentAt: Date; input: NotificationInput }`, `buildNotificationMail(ctx): { subject: string; textPart: string; htmlPart: string }` (rein), `sendNotificationMails(ctx, recipients: string[]): Promise<{ attempted: number; failed: number }>`
- Produces (`submit-notification-core.ts`): `interface SubmitNotificationResult { ok?: true; error?: string }`, `submitNotificationCore(params: { organizationId: string; senderId: string; input: unknown; now?: Date }): Promise<SubmitNotificationResult>`

- [ ] **Step 1: Tests für die Validierung schreiben (`notification-input.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { validateNotificationInput, viennaToday } from './notification-input';

const ctx = { products: ['Bier', 'Spritzer', 'Eistee', 'Spezi'], today: '2026-11-15' };

describe('viennaToday', () => {
  it('liefert das Datum in Wiener Zeit', () => {
    expect(viennaToday(new Date('2026-11-15T10:59:00Z'))).toBe('2026-11-15');
    expect(viennaToday(new Date('2026-11-15T23:30:00Z'))).toBe('2026-11-16');
  });
});

describe('validateNotificationInput: Getränkeautomat', () => {
  it('akzeptiert Produkte aus der Liste, normalisiert die Schreibweise und die Anmerkung', () => {
    expect(validateNotificationInput({ form: 'DRINKS', products: ['bier', 'Spezi', 'BIER'], note: '  leer  ' }, ctx)).toEqual({
      ok: true,
      value: { form: 'DRINKS', products: ['Bier', 'Spezi'], note: 'leer' },
    });
    expect(validateNotificationInput({ form: 'DRINKS', products: ['Bier'], note: '   ' }, ctx)).toEqual({
      ok: true,
      value: { form: 'DRINKS', products: ['Bier'], note: null },
    });
  });

  it('verlangt mindestens ein Produkt und lehnt unbekannte Produkte ab', () => {
    expect(validateNotificationInput({ form: 'DRINKS', products: [], note: null }, ctx)).toEqual({
      ok: false,
      error: 'Bitte mindestens ein Produkt wählen.',
    });
    expect(validateNotificationInput({ form: 'DRINKS', products: ['Wein'], note: null }, ctx)).toEqual({
      ok: false,
      error: 'Unbekanntes Produkt.',
    });
    expect(validateNotificationInput({ form: 'DRINKS', products: 'Bier', note: null }, ctx).ok).toBe(false);
  });

  it('begrenzt die Anmerkung auf 1000 Zeichen', () => {
    expect(validateNotificationInput({ form: 'DRINKS', products: ['Bier'], note: 'a'.repeat(1000) }, ctx).ok).toBe(true);
    expect(validateNotificationInput({ form: 'DRINKS', products: ['Bier'], note: 'a'.repeat(1001) }, ctx)).toEqual({
      ok: false,
      error: 'Die Anmerkung ist zu lang.',
    });
  });
});

describe('validateNotificationInput: Schadensmeldung', () => {
  const valid = { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Atemschutzgerät 3', acute: true, description: 'Maske undicht' };

  it('akzeptiert eine gültige Meldung, fasst Leerzeichen in einzeiligen Feldern zusammen', () => {
    expect(validateNotificationInput({ ...valid, equipment: '  Atemschutz \n gerät  3 ' }, ctx)).toEqual({
      ok: true,
      value: { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Atemschutz gerät 3', acute: true, description: 'Maske undicht' },
    });
  });

  it('erlaubt acute als true, false oder null; alles andere ist ungültig', () => {
    expect(validateNotificationInput({ ...valid, acute: null }, ctx).ok).toBe(true);
    expect(validateNotificationInput({ ...valid, acute: false }, ctx).ok).toBe(true);
    expect(validateNotificationInput({ ...valid, acute: 'ja' }, ctx)).toEqual({ ok: false, error: 'Ungültige Angabe zu "akut".' });
  });

  it('prüft das Datum: gültig, nicht in der Zukunft, höchstens 365 Tage zurück', () => {
    expect(validateNotificationInput({ ...valid, occurredOn: '2026-13-40' }, ctx)).toEqual({ ok: false, error: 'Das Datum ist ungültig.' });
    expect(validateNotificationInput({ ...valid, occurredOn: 'gestern' }, ctx)).toEqual({ ok: false, error: 'Das Datum ist ungültig.' });
    expect(validateNotificationInput({ ...valid, occurredOn: '2026-11-16' }, ctx)).toEqual({
      ok: false,
      error: 'Das Datum darf nicht in der Zukunft liegen.',
    });
    expect(validateNotificationInput({ ...valid, occurredOn: '2025-11-15' }, ctx).ok).toBe(true);
    expect(validateNotificationInput({ ...valid, occurredOn: '2025-11-14' }, ctx)).toEqual({
      ok: false,
      error: 'Das Datum liegt zu weit zurück.',
    });
  });

  it('verlangt Gerät und Beschreibung und begrenzt die Längen (120 / 2000)', () => {
    expect(validateNotificationInput({ ...valid, equipment: '   ' }, ctx)).toEqual({
      ok: false,
      error: 'Bitte das betroffene Gerät / die Ausrüstung angeben.',
    });
    expect(validateNotificationInput({ ...valid, equipment: 'a'.repeat(121) }, ctx)).toEqual({
      ok: false,
      error: 'Gerät / Ausrüstung ist zu lang.',
    });
    expect(validateNotificationInput({ ...valid, description: '  ' }, ctx)).toEqual({ ok: false, error: 'Bitte den Schaden beschreiben.' });
    expect(validateNotificationInput({ ...valid, description: 'a'.repeat(2000) }, ctx).ok).toBe(true);
    expect(validateNotificationInput({ ...valid, description: 'a'.repeat(2001) }, ctx)).toEqual({
      ok: false,
      error: 'Die Beschreibung ist zu lang.',
    });
  });
});

describe('validateNotificationInput: allgemein', () => {
  it('lehnt Nicht-Objekte und unbekannte Formulare ab', () => {
    for (const raw of [null, undefined, 'x', 42, [], { form: 'INCIDENT' }, {}]) {
      expect(validateNotificationInput(raw, ctx)).toEqual({ ok: false, error: 'Dieses Formular ist nicht verfügbar.' });
    }
  });
});
```

Run: `npx vitest run src/lib/heimatfeuerwehr/notification-input.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 2: `notification-input.ts` schreiben**

```ts
import { isNotificationForm } from './notification-form-constants';

/** Reine Validierung und Typen der Meldeformulare (keine Datenbank): auch für Client-Komponenten importierbar. */

export type NotificationInput =
  | { form: 'DRINKS'; products: string[]; note: string | null }
  | { form: 'DAMAGE'; occurredOn: string; equipment: string; acute: boolean | null; description: string };

export const NOTE_MAX = 1000;
export const EQUIPMENT_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const MAX_DAYS_BACK = 365;

const viennaDateFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Heutiges Datum in Wiener Zeit als YYYY-MM-DD. */
export function viennaToday(now: Date = new Date()): string {
  return viennaDateFormat.format(now);
}

type Validation = { ok: true; value: NotificationInput } | { ok: false; error: string };

function fail(error: string): Validation {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mehrzeiliger Text: nur getrimmt (Zeilenumbrüche bleiben). */
function multiline(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

/** Einzeiliger Text: Leerraum (auch Zeilenumbrüche) zu einem Leerzeichen zusammengefasst. */
function singleLine(value: unknown): string | null {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : null;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Prüft und normalisiert die (nicht vertrauenswürdige) Eingabe eines Meldeformulars. `ctx.products` ist die
 * Produktliste der Feuerwehr, `ctx.today` das heutige Wiener Datum. Fehlertexte sind statisch (nie Eingabewerte).
 */
export function validateNotificationInput(raw: unknown, ctx: { products: readonly string[]; today: string }): Validation {
  if (!isRecord(raw) || !isNotificationForm(raw.form)) return fail('Dieses Formular ist nicht verfügbar.');

  if (raw.form === 'DRINKS') {
    if (!Array.isArray(raw.products) || raw.products.some((item) => typeof item !== 'string')) return fail('Ungültige Eingabe.');
    const wanted = new Set((raw.products as string[]).map((item) => item.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean));
    if (wanted.size === 0) return fail('Bitte mindestens ein Produkt wählen.');
    const canonical = ctx.products.filter((product) => wanted.has(product.toLowerCase()));
    if (canonical.length !== wanted.size) return fail('Unbekanntes Produkt.');
    const note = raw.note === null || raw.note === undefined ? '' : multiline(raw.note);
    if (note === null) return fail('Ungültige Eingabe.');
    if (note.length > NOTE_MAX) return fail('Die Anmerkung ist zu lang.');
    return { ok: true, value: { form: 'DRINKS', products: canonical, note: note.length > 0 ? note : null } };
  }

  const occurredOn = typeof raw.occurredOn === 'string' ? raw.occurredOn.trim() : '';
  if (!isValidDate(occurredOn)) return fail('Das Datum ist ungültig.');
  if (occurredOn > ctx.today) return fail('Das Datum darf nicht in der Zukunft liegen.');
  if (daysBetween(occurredOn, ctx.today) > MAX_DAYS_BACK) return fail('Das Datum liegt zu weit zurück.');

  const equipment = singleLine(raw.equipment);
  if (equipment === null) return fail('Ungültige Eingabe.');
  if (equipment.length === 0) return fail('Bitte das betroffene Gerät / die Ausrüstung angeben.');
  if (equipment.length > EQUIPMENT_MAX) return fail('Gerät / Ausrüstung ist zu lang.');

  if (raw.acute !== null && raw.acute !== undefined && typeof raw.acute !== 'boolean') return fail('Ungültige Angabe zu "akut".');

  const description = multiline(raw.description);
  if (description === null) return fail('Ungültige Eingabe.');
  if (description.length === 0) return fail('Bitte den Schaden beschreiben.');
  if (description.length > DESCRIPTION_MAX) return fail('Die Beschreibung ist zu lang.');

  return {
    ok: true,
    value: { form: 'DAMAGE', occurredOn, equipment, acute: typeof raw.acute === 'boolean' ? raw.acute : null, description },
  };
}
```

Run den Test aus Step 1: Expected PASS. (Der Test `'Atemschutz \n gerät  3'` erwartet `'Atemschutz gerät 3'` — die Normalisierung ersetzt jeden Leerraum durch ein Leerzeichen.)

- [ ] **Step 3: Test für die Mail schreiben (`notify-notification-form.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { buildNotificationMail } from './notify-notification-form';

const SENT_AT = new Date('2026-11-15T11:13:00Z'); // 12:13 in Wien

describe('buildNotificationMail', () => {
  it('Getränkeautomat: Betreff, Produkte, Anmerkung, Absender und Zeitpunkt', () => {
    const mail = buildNotificationMail({
      organizationName: 'FF Wolfsgraben',
      senderName: 'Franz Bichler',
      senderEmail: 'franz@example.local',
      sentAt: SENT_AT,
      input: { form: 'DRINKS', products: ['Bier', 'Eistee'], note: 'Automat blinkt' },
    });
    expect(mail.subject).toBe('Getränkeautomat: Produkte fehlen – FF Wolfsgraben');
    expect(mail.textPart).toContain('FF Wolfsgraben');
    expect(mail.textPart).toContain('Gemeldet von: Franz Bichler');
    expect(mail.textPart).toContain('12:13');
    expect(mail.textPart).toContain('Fehlende Produkte: Bier, Eistee');
    expect(mail.textPart).toContain('Anmerkung: Automat blinkt');
    expect(mail.htmlPart).toContain('Bier, Eistee');
  });

  it('Getränkeautomat ohne Anmerkung nennt keine Anmerkung', () => {
    const mail = buildNotificationMail({
      organizationName: 'FF X',
      senderName: 'A B',
      senderEmail: null,
      sentAt: SENT_AT,
      input: { form: 'DRINKS', products: ['Spezi'], note: null },
    });
    expect(mail.textPart).not.toContain('Anmerkung');
  });

  it('Schadensmeldung: AKUT-Vorsatz nur bei akut, "nicht angegeben" bei null, Datum im österreichischen Format', () => {
    const base = {
      organizationName: 'FF Wolfsgraben',
      senderName: 'Florian Krebs',
      senderEmail: 'f@example.local',
      sentAt: SENT_AT,
    };
    const acute = buildNotificationMail({
      ...base,
      input: { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Atemschutzgerät 3', acute: true, description: 'Maske undicht' },
    });
    expect(acute.subject).toBe('AKUT: Schadensmeldung: Atemschutzgerät 3 – FF Wolfsgraben');
    expect(acute.textPart).toContain('Akut: Ja');
    expect(acute.textPart).toContain('15.11.2026');
    expect(acute.textPart).toContain('Gerät / Ausrüstung: Atemschutzgerät 3');
    expect(acute.textPart).toContain('Maske undicht');

    const notAcute = buildNotificationMail({ ...base, input: { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Schlauch', acute: false, description: 'Riss' } });
    expect(notAcute.subject).toBe('Schadensmeldung: Schlauch – FF Wolfsgraben');
    expect(notAcute.textPart).toContain('Akut: Nein');

    const unknown = buildNotificationMail({ ...base, input: { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Schlauch', acute: null, description: 'Riss' } });
    expect(unknown.textPart).toContain('Akut: nicht angegeben');
  });

  it('maskiert Benutzereingaben im HTML und erhält Zeilenumbrüche der Beschreibung', () => {
    const mail = buildNotificationMail({
      organizationName: 'FF <b>X</b>',
      senderName: 'A <script>',
      senderEmail: null,
      sentAt: SENT_AT,
      input: { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Rohr <i>', acute: null, description: 'Zeile 1\nZeile <2>' },
    });
    expect(mail.htmlPart).not.toContain('<script>');
    expect(mail.htmlPart).not.toContain('<b>X</b>');
    expect(mail.htmlPart).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(mail.htmlPart).toContain('Zeile 1<br>Zeile &lt;2&gt;');
  });
});
```

Run: Expected FAIL (Modul fehlt).

- [ ] **Step 4: `notify-notification-form.ts` schreiben**

```ts
import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';
import type { NotificationInput } from './notification-input';

export interface NotificationMailContext {
  organizationName: string;
  senderName: string;
  /** Nur als Reply-To (wie bei den Berichten); null = kein Reply-To. */
  senderEmail: string | null;
  sentAt: Date;
  input: NotificationInput;
}

const sentAtFormat = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'Europe/Vienna',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function germanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

type Line = { label: string; value: string };

/** Betreff, Text und HTML der Meldung (rein, ohne Versand). Alle Werte werden im HTML maskiert. */
export function buildNotificationMail(ctx: NotificationMailContext): { subject: string; textPart: string; htmlPart: string } {
  const { organizationName, senderName, sentAt, input } = ctx;

  let subject: string;
  let intro: string;
  let lines: Line[];
  if (input.form === 'DRINKS') {
    subject = `Getränkeautomat: Produkte fehlen – ${organizationName}`;
    intro = `Meldung zum Getränkeautomat in ${organizationName}.`;
    lines = [{ label: 'Fehlende Produkte', value: input.products.join(', ') }];
    if (input.note) lines.push({ label: 'Anmerkung', value: input.note });
  } else {
    subject = `${input.acute === true ? 'AKUT: ' : ''}Schadensmeldung: ${input.equipment} – ${organizationName}`;
    intro = `Schadensmeldung in ${organizationName}.`;
    lines = [
      { label: 'Datum', value: germanDate(input.occurredOn) },
      { label: 'Gerät / Ausrüstung', value: input.equipment },
      { label: 'Akut', value: input.acute === true ? 'Ja' : input.acute === false ? 'Nein' : 'nicht angegeben' },
      { label: 'Beschreibung', value: input.description },
    ];
  }
  const meta: Line[] = [
    { label: 'Gemeldet von', value: senderName },
    { label: 'Zeitpunkt', value: sentAtFormat.format(sentAt) },
  ];
  const all = [...meta, ...lines];

  const textPart = [intro, '', ...all.map((line) => `${line.label}: ${line.value}`)].join('\n');
  const htmlPart = `<p>${escapeHtml(intro)}</p><ul>${all
    .map((line) => `<li><b>${escapeHtml(line.label)}:</b> ${escapeHtml(line.value).replace(/\n/g, '<br>')}</li>`)
    .join('')}</ul>`;
  return { subject, textPart, htmlPart };
}

/**
 * Sendet die Meldung als eine E-Mail je Empfänger (kein gemeinsames An/Cc, damit kein Empfänger die Adressen der
 * anderen sieht). Einzelne Fehler werden pro Empfänger abgefangen und ohne Adresse/Inhalt protokolliert.
 */
export async function sendNotificationMails(
  ctx: NotificationMailContext,
  recipients: string[],
): Promise<{ attempted: number; failed: number }> {
  const { subject, textPart, htmlPart } = buildNotificationMail(ctx);
  let failed = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, textPart, htmlPart, replyTo: ctx.senderEmail ?? undefined });
    } catch {
      failed += 1;
      console.error('Meldung: Versand an einen Empfänger fehlgeschlagen.');
    }
  }
  return { attempted: recipients.length, failed };
}
```

Run den Test aus Step 3: Expected PASS. (Zeitpunkt `2026-11-15T11:13:00Z` ist in Wien 12:13, die `de-AT`-Ausgabe enthält `12:13` und `15.11.2026`; weicht die Ausgabe des Node-ICU leicht ab, die **Test**-Erwartung an die tatsächliche Ausgabe anpassen, nicht die Funktion verändern.)

- [ ] **Step 5: DB-Test für den Kern schreiben (`submit-notification-core.db.test.ts`)**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email/mailjet';
import { saveNotificationFormEnabled, saveNotificationFormRecipients, saveDrinkProducts } from './notification-form-settings';
import { submitNotificationCore } from './submit-notification-core';

vi.mock('@/lib/email/mailjet', () => ({ sendEmail: vi.fn(async () => undefined) }));

const RUN = `notif-core-${Date.now()}`;
const NOW = new Date('2026-11-15T11:13:00Z');
const ids: Record<string, string> = {};
let orgA = '';
let orgB = '';

async function makeUser(key: string, organizationId: string, extra: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${key}@example.local`, passwordHash: 'x', firstName: key, lastName: RUN, homeOrganizationId: organizationId, ...extra },
  });
  ids[key] = user.id;
}

const drinks = (over: Record<string, unknown> = {}) => ({ form: 'DRINKS', products: ['Bier'], note: null, ...over });
const damage = (over: Record<string, unknown> = {}) => ({
  form: 'DAMAGE',
  occurredOn: '2026-11-15',
  equipment: 'Atemschutzgerät 3',
  acute: true,
  description: 'Maske undicht',
  ...over,
});

beforeAll(async () => {
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  orgB = (await prisma.organization.create({ data: { name: `${RUN}-b`, nummer: `${RUN}-b`, type: 'FEUERWEHR' } })).id;
  await makeUser('senderA', orgA);
  await makeUser('senderB', orgB);
  await makeUser('gone', orgA, { isActive: false, passwordChangedAt: new Date() });
});

afterAll(async () => {
  const userIds = Object.values(ids);
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  const orgIds = [orgA, orgB].filter((id) => id !== '');
  if (orgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue(undefined);
});

describe('submitNotificationCore: Verfügbarkeit', () => {
  it('lehnt ein Formular ohne Empfänger ab (norecipient)', async () => {
    const result = await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: drinks(), now: NOW });
    expect(result.error).toBe('Dieses Formular ist nicht verfügbar.');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('lehnt ein abgeschaltetes Formular ab und lässt das andere zu', async () => {
    await saveNotificationFormRecipients(orgA, 'DRINKS', ['a@example.local']);
    await saveNotificationFormRecipients(orgA, 'DAMAGE', ['b@example.local']);
    await saveNotificationFormEnabled(orgA, 'DRINKS', false);
    try {
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: drinks(), now: NOW })).error).toBe(
        'Dieses Formular ist nicht verfügbar.',
      );
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: damage(), now: NOW })).ok).toBe(true);
    } finally {
      await saveNotificationFormEnabled(orgA, 'DRINKS', true);
    }
  });

  it('lehnt unbekannte Formulare ab', async () => {
    for (const input of [{ form: 'INCIDENT' }, { form: 'FOO' }, null, 'x']) {
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input, now: NOW })).error).toBe(
        'Dieses Formular ist nicht verfügbar.',
      );
    }
  });
});

describe('submitNotificationCore: Absender und Felder', () => {
  it('lehnt einen Absender einer anderen Feuerwehr und einen deaktivierten Absender ab', async () => {
    const foreign = await submitNotificationCore({ organizationId: orgA, senderId: ids.senderB, input: damage(), now: NOW });
    expect(foreign.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
    const gone = await submitNotificationCore({ organizationId: orgA, senderId: ids.gone, input: damage(), now: NOW });
    expect(gone.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('lehnt ein Produkt außerhalb der Produktliste der Feuerwehr ab und erlaubt eigene Produkte', async () => {
    expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: drinks({ products: ['Wein'] }), now: NOW })).error).toBe(
      'Unbekanntes Produkt.',
    );
    await saveDrinkProducts(orgA, ['Cola', 'Wasser']);
    try {
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: drinks({ products: ['Bier'] }), now: NOW })).error).toBe(
        'Unbekanntes Produkt.',
      );
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: drinks({ products: ['cola'] }), now: NOW })).ok).toBe(true);
    } finally {
      await saveDrinkProducts(orgA, []);
    }
  });

  it('lehnt ein Datum in der Zukunft, ein zu altes Datum und ungültige Längen ab', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ occurredOn: '2026-11-16' }, 'Das Datum darf nicht in der Zukunft liegen.'],
      [{ occurredOn: '2025-01-01' }, 'Das Datum liegt zu weit zurück.'],
      [{ equipment: 'a'.repeat(121) }, 'Gerät / Ausrüstung ist zu lang.'],
      [{ description: ' ' }, 'Bitte den Schaden beschreiben.'],
    ];
    for (const [over, error] of cases) {
      expect((await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: damage(over), now: NOW })).error).toBe(error);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('submitNotificationCore: Versand', () => {
  it('sendet genau eine Mail je Empfänger mit Betreff, AKUT-Vorsatz und Reply-To', async () => {
    await saveNotificationFormRecipients(orgA, 'DAMAGE', ['r1@example.local', 'r2@example.local']);
    const result = await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: damage(), now: NOW });
    expect(result).toEqual({ ok: true });
    const calls = vi.mocked(sendEmail).mock.calls.map((call) => call[0]);
    expect(calls.map((call) => call.to)).toEqual(['r1@example.local', 'r2@example.local']);
    expect(calls[0].subject).toBe(`AKUT: Schadensmeldung: Atemschutzgerät 3 – ${RUN}-a`);
    expect(calls[0].replyTo).toBe(`${RUN}-senderA@example.local`);
    expect(calls[0].textPart).toContain('Gemeldet von: senderA');
  });

  it('meldet einen Fehler, wenn der Versand an ALLE Empfänger scheitert, aber nicht bei einem Teilausfall', async () => {
    await saveNotificationFormRecipients(orgA, 'DAMAGE', ['r1@example.local', 'r2@example.local']);
    vi.mocked(sendEmail).mockRejectedValue(new Error('mailjet down'));
    const total = await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: damage(), now: NOW });
    expect(total).toEqual({ error: 'Die Meldung konnte nicht gesendet werden. Bitte erneut versuchen.' });

    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('einer')).mockResolvedValue(undefined);
    const partial = await submitNotificationCore({ organizationId: orgA, senderId: ids.senderA, input: damage(), now: NOW });
    expect(partial).toEqual({ ok: true });
  });
});
```

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/submit-notification-core.db.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 6: `submit-notification-core.ts` schreiben**

```ts
import { prisma } from '@/lib/db/prisma';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { isNotificationForm, notificationFormState } from './notification-form-constants';
import { getNotificationFormSettings } from './notification-form-settings';
import { validateNotificationInput, viennaToday } from './notification-input';
import { sendNotificationMails } from './notify-notification-form';

export interface SubmitNotificationResult {
  ok?: true;
  error?: string;
}

const UNAVAILABLE = 'Dieses Formular ist nicht verfügbar.';
const SEND_FAILED = 'Die Meldung konnte nicht gesendet werden. Bitte erneut versuchen.';

function formOf(input: unknown): unknown {
  return typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as { form?: unknown }).form : undefined;
}

/**
 * Geteilter Kern der Meldeformulare (App, Sitzung, und Kiosk, Link). Der Aufrufer prüft die Berechtigung und liefert
 * organizationId und senderId - alles Übrige prüft diese Funktion serverseitig: Formular verfügbar (eingeschaltet UND
 * mindestens ein Empfänger), Absender aktives Mitglied genau dieser Feuerwehr, Felder. Es wird NICHTS gespeichert;
 * gesendet wird eine Mail je Empfänger. Scheitert der Versand an allen Empfängern, ist das ein Fehler (der Nutzer kann
 * es erneut versuchen), ein Teilausfall gilt als gesendet. Wirft nie nach außen.
 */
export async function submitNotificationCore(params: {
  organizationId: string;
  senderId: string;
  input: unknown;
  now?: Date;
}): Promise<SubmitNotificationResult> {
  const { organizationId, senderId, input } = params;
  const now = params.now ?? new Date();

  try {
    const form = formOf(input);
    if (!isNotificationForm(form)) return { error: UNAVAILABLE };

    const setting = (await getNotificationFormSettings(organizationId))[form];
    if (notificationFormState(setting) !== 'available') return { error: UNAVAILABLE };

    const sender = await prisma.user.findFirst({
      where: { id: senderId, homeOrganizationId: organizationId, ...NOT_DEACTIVATED_WHERE },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!sender) return { error: 'Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.' };

    const validated = validateNotificationInput(input, { products: setting.products, today: viennaToday(now) });
    if (!validated.ok) return { error: validated.error };

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
    const result = await sendNotificationMails(
      {
        organizationName: organization.name,
        senderName: `${sender.firstName} ${sender.lastName}`,
        senderEmail: sender.email,
        sentAt: now,
        input: validated.value,
      },
      setting.recipients,
    );
    if (result.attempted > 0 && result.failed === result.attempted) return { error: SEND_FAILED };
    return { ok: true };
  } catch (error) {
    console.error('Meldung konnte nicht verarbeitet werden:', error instanceof Error ? error.message : 'unbekannter Fehler');
    return { error: SEND_FAILED };
  }
}
```

Run den DB-Test aus Step 5: Expected PASS.

- [ ] **Step 7: Typen, Tests, Commit**

```bash
npx tsc --noEmit
npm test
git add src/lib/heimatfeuerwehr/notification-input.ts src/lib/heimatfeuerwehr/notification-input.test.ts \
  src/lib/heimatfeuerwehr/notify-notification-form.ts src/lib/heimatfeuerwehr/notify-notification-form.test.ts \
  src/lib/heimatfeuerwehr/submit-notification-core.ts src/lib/heimatfeuerwehr/submit-notification-core.db.test.ts
git commit -m "feat: Meldeformulare - Validierung, E-Mail-Versand und gemeinsamer Kern

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Einstiege: Kiosk-Abgabe und App-Aktion

**Files:**
- Create: `src/lib/heimatfeuerwehr/report-kiosk-notification-submit.ts`, `report-kiosk-notification-submit.db.test.ts`
- Modify: `src/app/berichte-schnell/[token]/actions.ts`
- Create: `src/app/(app)/meine-feuerwehr/meldungen/actions.ts`, `actions.db.test.ts`

**Interfaces:**
- Consumes: `submitNotificationCore`, `findOrganizationByKioskToken`, `checkRateLimit`, `KIOSK_SUBMIT_MAX`, `KIOSK_SUBMIT_WINDOW_MS`, `kioskRateKey` (aus `report-kiosk-submit.ts`)
- Produces: `submitNotificationForKiosk(token: string, senderId: string, input: unknown): Promise<SubmitNotificationResult>`, Server Action `submitNotificationViaKiosk(token, senderId, input)`, Server Action `submitNotification(input: unknown): Promise<SubmitNotificationResult>`

- [ ] **Step 1: Kiosk-Test schreiben (`report-kiosk-notification-submit.db.test.ts`)**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email/mailjet';
import { checkRateLimit } from '@/lib/mcp/rate-limit';
import { saveNotificationFormRecipients } from './notification-form-settings';
import { clearReportKioskToken, setReportKioskToken } from './report-kiosk-token';
import { KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS, kioskRateKey } from './report-kiosk-submit';
import { submitNotificationForKiosk } from './report-kiosk-notification-submit';

vi.mock('@/lib/email/mailjet', () => ({ sendEmail: vi.fn(async () => undefined) }));

const RUN = `kiosk-notif-${Date.now()}`;
const ids: Record<string, string> = {};
let orgA = '';
let orgB = '';

const input = () => ({ form: 'DRINKS', products: ['Bier'], note: null });

beforeAll(async () => {
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  orgB = (await prisma.organization.create({ data: { name: `${RUN}-b`, nummer: `${RUN}-b`, type: 'FEUERWEHR' } })).id;
  for (const [key, org] of [['senderA', orgA], ['senderB', orgB]] as const) {
    ids[key] = (
      await prisma.user.create({ data: { email: `${RUN}-${key}@example.local`, passwordHash: 'x', firstName: key, lastName: RUN, homeOrganizationId: org } })
    ).id;
  }
  await saveNotificationFormRecipients(orgA, 'DRINKS', ['r@example.local']);
  await saveNotificationFormRecipients(orgB, 'DRINKS', ['r@example.local']);
});

afterAll(async () => {
  const userIds = Object.values(ids);
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  const orgIds = [orgA, orgB].filter((id) => id !== '');
  if (orgIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue(undefined);
});

describe('submitNotificationForKiosk', () => {
  it('sendet mit gültigem Link und Mitglied der Feuerwehr des Links', async () => {
    const token = await setReportKioskToken(orgA);
    const result = await submitNotificationForKiosk(token, ids.senderA, input());
    expect(result).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('lehnt unbekannte, abgeschaltete und neu erzeugte Links ab', async () => {
    expect(await submitNotificationForKiosk('x'.repeat(32), ids.senderA, input())).toEqual({ error: 'Die Schnellerfassung ist nicht mehr aktiv.' });

    const token = await setReportKioskToken(orgA);
    await clearReportKioskToken(orgA);
    expect(await submitNotificationForKiosk(token, ids.senderA, input())).toEqual({ error: 'Die Schnellerfassung ist nicht mehr aktiv.' });

    const old = await setReportKioskToken(orgA);
    await setReportKioskToken(orgA);
    expect(await submitNotificationForKiosk(old, ids.senderA, input())).toEqual({ error: 'Die Schnellerfassung ist nicht mehr aktiv.' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('bindet die Abgabe an die Feuerwehr des Links: Mitglied einer anderen Feuerwehr wird abgelehnt', async () => {
    const token = await setReportKioskToken(orgA);
    const result = await submitNotificationForKiosk(token, ids.senderB, input());
    expect(result.error).toBe('Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('teilt das Limit mit den Berichten (derselbe Zähler je Link)', async () => {
    const token = await setReportKioskToken(orgB);
    for (let i = 0; i < KIOSK_SUBMIT_MAX; i += 1) {
      expect(checkRateLimit(kioskRateKey(token), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS).allowed).toBe(true);
    }
    const result = await submitNotificationForKiosk(token, ids.senderB, input());
    expect(result).toEqual({ error: 'Zu viele Abgaben. Bitte später erneut versuchen.' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('zählt unbekannte Links nicht gegen das Limit', async () => {
    const unknown = 'y'.repeat(32);
    await submitNotificationForKiosk(unknown, ids.senderA, input());
    for (let i = 0; i < KIOSK_SUBMIT_MAX; i += 1) {
      expect(checkRateLimit(kioskRateKey(unknown), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS).allowed).toBe(true);
    }
  });
});
```

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/report-kiosk-notification-submit.db.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 2: `report-kiosk-notification-submit.ts` schreiben**

```ts
import { checkRateLimit } from '@/lib/mcp/rate-limit';
import { KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS, kioskRateKey } from './report-kiosk-submit';
import { findOrganizationByKioskToken } from './report-kiosk-token';
import { submitNotificationCore, type SubmitNotificationResult } from './submit-notification-core';

/**
 * Meldung (Getränkeautomat/Schadensmeldung) über den geheimen Link, ohne Sitzung. Wie die Berichts-Abgabe: der Link wird
 * bei JEDER Abgabe neu aufgelöst, die Feuerwehr kommt ausschließlich aus dem Link, und das Limit (derselbe Zähler wie
 * bei den Berichten) wird erst NACH der Linkprüfung gezählt. Alles Übrige (Formular verfügbar, Absender, Felder) prüft
 * der Kern.
 */
export async function submitNotificationForKiosk(token: string, senderId: string, input: unknown): Promise<SubmitNotificationResult> {
  const organization = await findOrganizationByKioskToken(token);
  if (!organization) return { error: 'Die Schnellerfassung ist nicht mehr aktiv.' };

  const limit = checkRateLimit(kioskRateKey(token), KIOSK_SUBMIT_MAX, KIOSK_SUBMIT_WINDOW_MS);
  if (!limit.allowed) return { error: 'Zu viele Abgaben. Bitte später erneut versuchen.' };

  return submitNotificationCore({ organizationId: organization.id, senderId: typeof senderId === 'string' ? senderId : '', input });
}
```

Run den Test aus Step 1: Expected PASS.

- [ ] **Step 3: Server Actions anlegen**

In `src/app/berichte-schnell/[token]/actions.ts` den Import und die Funktion ergänzen (Datei hat `'use server'`, es dürfen nur asynchrone Funktionen exportiert werden):

```ts
import { submitNotificationForKiosk } from '@/lib/heimatfeuerwehr/report-kiosk-notification-submit';
import type { SubmitNotificationResult } from '@/lib/heimatfeuerwehr/submit-notification-core';

/** Öffentliche Meldung (Getränkeautomat/Schadensmeldung) der iPad-Schnellerfassung, bewusst OHNE requireUser(). */
export async function submitNotificationViaKiosk(token: string, senderId: string, input: unknown): Promise<SubmitNotificationResult> {
  return submitNotificationForKiosk(token, senderId, input);
}
```

Neue Datei `src/app/(app)/meine-feuerwehr/meldungen/actions.ts`:

```ts
'use server';

import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import { submitNotificationCore, type SubmitNotificationResult } from '@/lib/heimatfeuerwehr/submit-notification-core';

/**
 * Meldung (Getränkeautomat/Schadensmeldung) aus der App: angemeldetes Mitglied der Heimatfeuerwehr, Absender ist der
 * Benutzer selbst. Prüfung und Versand liegen im gemeinsamen Kern (submitNotificationCore).
 */
export async function submitNotification(input: unknown): Promise<SubmitNotificationResult> {
  const user = await requireUser();
  assertPermission(canCreateReportFor(user, user.homeOrganizationId));
  return submitNotificationCore({ organizationId: user.homeOrganizationId, senderId: user.id, input });
}
```

- [ ] **Step 4: Test der App-Aktion (`actions.db.test.ts` neben der Aktion)**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email/mailjet';
import { saveNotificationFormRecipients } from '@/lib/heimatfeuerwehr/notification-form-settings';
import { sessionUserFixture } from '@/lib/mcp/tools/test-support';

vi.mock('@/lib/email/mailjet', () => ({ sendEmail: vi.fn(async () => undefined) }));
const sessionState = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('@/lib/auth/session', () => ({ requireUser: vi.fn(async () => sessionState.user) }));

import { submitNotification } from './actions';

const RUN = `app-notif-${Date.now()}`;
let orgA = '';
let senderId = '';

beforeAll(async () => {
  orgA = (await prisma.organization.create({ data: { name: `${RUN}-a`, nummer: `${RUN}-a`, type: 'FEUERWEHR' } })).id;
  senderId = (
    await prisma.user.create({ data: { email: `${RUN}-s@example.local`, passwordHash: 'x', firstName: 'App', lastName: RUN, homeOrganizationId: orgA } })
  ).id;
  sessionState.user = sessionUserFixture({ id: senderId, homeOrganizationId: orgA });
});

afterAll(async () => {
  if (senderId) await prisma.user.deleteMany({ where: { id: senderId } });
  if (orgA) await prisma.organization.deleteMany({ where: { id: orgA } });
});

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue(undefined);
});

describe('submitNotification (App)', () => {
  it('lehnt ab, solange die Feuerwehr keine Empfänger hinterlegt hat', async () => {
    const result = await submitNotification({ form: 'DRINKS', products: ['Bier'], note: null });
    expect(result.error).toBe('Dieses Formular ist nicht verfügbar.');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sendet mit dem angemeldeten Benutzer als Absender der Heimatfeuerwehr', async () => {
    await saveNotificationFormRecipients(orgA, 'DAMAGE', ['r@example.local']);
    const result = await submitNotification({
      form: 'DAMAGE',
      occurredOn: new Date().toISOString().slice(0, 10),
      equipment: 'Schlauch',
      acute: null,
      description: 'Riss',
    });
    expect(result).toEqual({ ok: true });
    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.to).toBe('r@example.local');
    expect(mail.replyTo).toBe(`${RUN}-s@example.local`);
  });
});
```

Hinweis: Das Datum im zweiten Test ist `new Date().toISOString().slice(0, 10)` (UTC). Liegt das UTC-Datum kurz nach Mitternacht vor dem Wiener Datum (1 bis 2 Stunden Differenz), ist es höchstens einen Tag zurück und bleibt gültig; liegt es **nach** dem Wiener Datum (nie, Wien ist UTC+1/+2) wäre es "Zukunft". Falls dieser Test flackert, stattdessen `viennaToday()` aus `@/lib/heimatfeuerwehr/notification-input` verwenden.

Run: `npx vitest run --config vitest.db.config.ts "src/app/(app)/meine-feuerwehr/meldungen/actions.db.test.ts" src/lib/heimatfeuerwehr/report-kiosk-notification-submit.db.test.ts`
Expected: PASS.

- [ ] **Step 5: Typen, Tests, Commit**

```bash
npx tsc --noEmit
npm test
git add src/lib/heimatfeuerwehr/report-kiosk-notification-submit.ts src/lib/heimatfeuerwehr/report-kiosk-notification-submit.db.test.ts \
  "src/app/berichte-schnell/[token]/actions.ts" "src/app/(app)/meine-feuerwehr/meldungen/actions.ts" \
  "src/app/(app)/meine-feuerwehr/meldungen/actions.db.test.ts"
git commit -m "feat: Meldeformulare - Kiosk-Abgabe und App-Aktion

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Formular-Oberfläche

**Files:**
- Create: `src/lib/heimatfeuerwehr/notification-form-fields.ts`, `notification-form-fields.test.ts`
- Create: `src/components/heimatfeuerwehr/notification-form-view.tsx`, `notification-form-view.test.ts`

**Interfaces:**
- Produces (`notification-form-fields.ts`, **rein**): `type NotificationValues = { form: 'DRINKS'; products: string[]; note: string } | { form: 'DAMAGE'; occurredOn: string; equipment: string; acute: boolean | null; description: string }`, `emptyValues(form: NotificationForm, today: string): NotificationValues`, `countRequired(values): { filled: number; total: number; complete: boolean }`, `toInput(values): NotificationInput`
- Produces (`notification-form-view.tsx`): `NotificationFormView({ form, products, layout, onSubmit, onDone, onCancel })` mit `layout: 'mobile' | 'tablet'`, `onSubmit: (input: NotificationInput) => Promise<{ ok?: true; error?: string }>`, `onDone: () => void`, `onCancel: () => void`, `products: string[]` (nur für DRINKS gebraucht)

- [ ] **Step 1: Reine Tests schreiben (`notification-form-fields.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { countRequired, emptyValues, toInput } from './notification-form-fields';

describe('emptyValues', () => {
  it('Getränkeautomat startet leer, Schadensmeldung mit dem heutigen Datum', () => {
    expect(emptyValues('DRINKS', '2026-11-15')).toEqual({ form: 'DRINKS', products: [], note: '' });
    expect(emptyValues('DAMAGE', '2026-11-15')).toEqual({
      form: 'DAMAGE',
      occurredOn: '2026-11-15',
      equipment: '',
      acute: null,
      description: '',
    });
  });
});

describe('countRequired', () => {
  it('Getränkeautomat: ein Pflichtfeld (Produkte)', () => {
    expect(countRequired(emptyValues('DRINKS', 'x'))).toEqual({ filled: 0, total: 1, complete: false });
    expect(countRequired({ form: 'DRINKS', products: ['Bier'], note: '' })).toEqual({ filled: 1, total: 1, complete: true });
  });

  it('Schadensmeldung: drei Pflichtfelder (Datum, Gerät, Beschreibung); akut ist optional', () => {
    expect(countRequired(emptyValues('DAMAGE', '2026-11-15'))).toEqual({ filled: 1, total: 3, complete: false });
    expect(countRequired({ form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Pumpe', acute: null, description: '' })).toEqual({
      filled: 2,
      total: 3,
      complete: false,
    });
    expect(countRequired({ form: 'DAMAGE', occurredOn: '2026-11-15', equipment: ' ', acute: true, description: '  ' })).toEqual({
      filled: 1,
      total: 3,
      complete: false,
    });
    expect(countRequired({ form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Pumpe', acute: null, description: 'Leckt' })).toEqual({
      filled: 3,
      total: 3,
      complete: true,
    });
    expect(countRequired({ form: 'DAMAGE', occurredOn: '', equipment: 'Pumpe', acute: false, description: 'Leckt' }).complete).toBe(false);
  });
});

describe('toInput', () => {
  it('bildet die Werte auf die Eingabe des Kerns ab (leere Anmerkung = null)', () => {
    expect(toInput({ form: 'DRINKS', products: ['Bier', 'Spezi'], note: '  ' })).toEqual({ form: 'DRINKS', products: ['Bier', 'Spezi'], note: null });
    expect(toInput({ form: 'DRINKS', products: ['Bier'], note: 'leer' })).toEqual({ form: 'DRINKS', products: ['Bier'], note: 'leer' });
    expect(toInput({ form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Pumpe', acute: true, description: 'Leckt' })).toEqual({
      form: 'DAMAGE',
      occurredOn: '2026-11-15',
      equipment: 'Pumpe',
      acute: true,
      description: 'Leckt',
    });
  });
});
```

Run: `npx vitest run src/lib/heimatfeuerwehr/notification-form-fields.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 2: `notification-form-fields.ts` schreiben**

```ts
import type { NotificationForm } from '@prisma/client';
import type { NotificationInput } from './notification-input';

/** Reine Zustandslogik der Meldeformulare (keine Datenbank): auch für Client-Komponenten importierbar. */

export type NotificationValues =
  | { form: 'DRINKS'; products: string[]; note: string }
  | { form: 'DAMAGE'; occurredOn: string; equipment: string; acute: boolean | null; description: string };

/** Leerer Startzustand; die Schadensmeldung beginnt mit dem heutigen (Wiener) Datum. */
export function emptyValues(form: NotificationForm, today: string): NotificationValues {
  return form === 'DRINKS'
    ? { form: 'DRINKS', products: [], note: '' }
    : { form: 'DAMAGE', occurredOn: today, equipment: '', acute: null, description: '' };
}

/** Pflichtfelder: Getränkeautomat 1 (Produkte), Schadensmeldung 3 (Datum, Gerät/Ausrüstung, Beschreibung). */
export function countRequired(values: NotificationValues): { filled: number; total: number; complete: boolean } {
  const flags =
    values.form === 'DRINKS'
      ? [values.products.length > 0]
      : [values.occurredOn.trim().length > 0, values.equipment.trim().length > 0, values.description.trim().length > 0];
  const filled = flags.filter(Boolean).length;
  return { filled, total: flags.length, complete: filled === flags.length };
}

export function toInput(values: NotificationValues): NotificationInput {
  if (values.form === 'DRINKS') {
    const note = values.note.trim();
    return { form: 'DRINKS', products: values.products, note: note.length > 0 ? note : null };
  }
  return {
    form: 'DAMAGE',
    occurredOn: values.occurredOn,
    equipment: values.equipment,
    acute: values.acute,
    description: values.description,
  };
}
```

Run den Test aus Step 1: Expected PASS.

- [ ] **Step 3: Render-Test für die Komponente schreiben (`notification-form-view.test.ts`)**

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NotificationFormView } from './notification-form-view';

const noop = async () => ({ ok: true as const });

function render(props: Partial<Parameters<typeof NotificationFormView>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(NotificationFormView, {
      form: 'DRINKS',
      products: ['Bier', 'Spritzer', 'Eistee', 'Spezi'],
      layout: 'mobile',
      onSubmit: noop,
      onDone: () => undefined,
      onCancel: () => undefined,
      ...props,
    }),
  );
}

describe('NotificationFormView: Getränkeautomat', () => {
  it('zeigt die Produkte als Auswahl, den Zähler "0 / 1" und ein gesperrtes Absenden', () => {
    const html = render();
    for (const product of ['Bier', 'Spritzer', 'Eistee', 'Spezi']) expect(html).toContain(product);
    expect(html).toContain('Welche Produkte fehlen?');
    expect(html).toContain('Anmerkung');
    expect(html).toContain('0 / 1 Pflichtfelder ausgefüllt');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Meldung absenden<\/button>/);
    expect(html).toContain('Abbrechen');
  });
});

describe('NotificationFormView: Schadensmeldung', () => {
  it('zeigt Datum, Gerät, akut/nicht akut und Beschreibung, mit dem Zähler "1 / 3" (Datum ist vorbelegt)', () => {
    const html = render({ form: 'DAMAGE', products: [] });
    expect(html).toContain('Betroffenes Gerät / Ausrüstung');
    expect(html).toContain('Ist der Schaden akut?');
    expect(html).toContain('Akut');
    expect(html).toContain('Nicht akut');
    expect(html).toContain('Beschreibung des Schadens');
    expect(html).toContain('type="date"');
    expect(html).toContain('1 / 3 Pflichtfelder ausgefüllt');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Meldung absenden<\/button>/);
  });
});

describe('NotificationFormView: Layouts', () => {
  it('kennzeichnet das Layout und unterscheidet die Fußleisten', () => {
    const mobile = render({ layout: 'mobile' });
    const tablet = render({ layout: 'tablet' });
    expect(mobile).toContain('data-layout="mobile"');
    expect(tablet).toContain('data-layout="tablet"');
    expect(mobile).toContain('pb-safe-tabbar');
    expect(tablet).not.toContain('pb-safe-tabbar');
    expect(tablet).toContain('sticky');
  });
});
```

Run: Expected FAIL (Komponente fehlt).

- [ ] **Step 4: `notification-form-view.tsx` schreiben**

```tsx
'use client';

import { useState } from 'react';
import type { NotificationForm } from '@prisma/client';
import { NOTIFICATION_FORM_LABEL } from '@/lib/heimatfeuerwehr/notification-form-constants';
import { countRequired, emptyValues, toInput, type NotificationValues } from '@/lib/heimatfeuerwehr/notification-form-fields';
import { DESCRIPTION_MAX, EQUIPMENT_MAX, NOTE_MAX, viennaToday, type NotificationInput } from '@/lib/heimatfeuerwehr/notification-input';

type SubmitResult = { ok?: true; error?: string };

function SectionCard({ number, title, tablet, children }: { number: string; title: string; tablet: boolean; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl bg-white shadow-sm ${tablet ? 'p-6' : 'p-4'}`}>
      <div className="mb-4 flex items-center gap-3 border-b border-neutral-100 pb-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">{number}</span>
        <h2 className="text-[17px] font-semibold text-[#1c1c1e]">{title}</h2>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-[13px] font-medium text-[#1c1c1e]">
      {children}
      {required && <span className="ml-1 text-red-600">*</span>}
    </span>
  );
}

/**
 * Meldeformular (Getränkeautomat / Schadensmeldung) für App (Handy-Layout) und Kiosk (Tablet-Layout). Sammelt nur die
 * Eingaben, der Server prüft alles (submitNotificationCore). "Meldung absenden" ist erst aktiv, wenn alle Pflichtfelder
 * ausgefüllt sind. Der Layoutwechsel ändert nur Klassen, nie die Elementstruktur (kein Neueinhängen beim Drehen).
 */
export function NotificationFormView({
  form,
  products,
  layout,
  onSubmit,
  onDone,
  onCancel,
}: {
  form: NotificationForm;
  products: string[];
  layout: 'mobile' | 'tablet';
  onSubmit: (input: NotificationInput) => Promise<SubmitResult>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const tablet = layout === 'tablet';
  const [values, setValues] = useState<NotificationValues>(() => emptyValues(form, viennaToday()));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { filled, total, complete } = countRequired(values);

  async function handleSubmit() {
    if (!complete || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(toInput(values));
      if (result.error) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      onDone();
    } catch {
      setError('Die Meldung konnte nicht gesendet werden. Bitte erneut versuchen.');
      setSubmitting(false);
    }
  }

  const inputClass = `w-full rounded-lg border border-neutral-300 bg-white px-3 text-[#1c1c1e] ${tablet ? 'min-h-[52px] text-base' : 'min-h-[44px] text-sm'}`;
  const textareaClass = `w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[#1c1c1e] ${tablet ? 'text-base' : 'text-sm'}`;
  const chipBase = 'min-h-[48px] rounded-full border px-5 text-[15px] font-semibold';

  // Ein einziger Textknoten (keine React-Kommentarknoten zwischen den Zahlen), damit der Zähler testbar bleibt.
  const counter = <span className="text-sm text-neutral-500">{`${filled} / ${total} Pflichtfelder ausgefüllt`}</span>;
  const cancelButton = (
    <button type="button" onClick={onCancel} className="min-h-[52px] rounded-lg border border-neutral-300 bg-white px-6 text-[15px] font-semibold">
      Abbrechen
    </button>
  );
  const submitButton = (
    <button
      type="button"
      disabled={!complete || submitting}
      onClick={handleSubmit}
      className={`min-h-[52px] rounded-lg px-8 text-[15px] font-semibold text-white ${complete && !submitting ? 'bg-brand' : 'bg-neutral-300'}`}
    >
      {submitting ? 'Wird gesendet …' : 'Meldung absenden'}
    </button>
  );

  return (
    <div data-layout={layout} className={`flex flex-col ${tablet ? 'gap-6' : 'gap-5 pb-48'}`}>
      {values.form === 'DRINKS' ? (
        <SectionCard number="01" title="Meldung" tablet={tablet}>
          <div>
            <FieldLabel required>Welche Produkte fehlen?</FieldLabel>
            <div className="flex flex-wrap gap-2.5">
              {products.map((product) => {
                const selected = values.form === 'DRINKS' && values.products.includes(product);
                return (
                  <button
                    key={product}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setValues((current) =>
                        current.form === 'DRINKS'
                          ? {
                              ...current,
                              products: current.products.includes(product)
                                ? current.products.filter((p) => p !== product)
                                : [...current.products, product],
                            }
                          : current,
                      )
                    }
                    className={`${chipBase} ${selected ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-[#1c1c1e]'}`}
                  >
                    {product}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block">
            <FieldLabel>Anmerkung</FieldLabel>
            <textarea
              value={values.note}
              maxLength={NOTE_MAX}
              rows={tablet ? 5 : 4}
              onChange={(event) => setValues((current) => (current.form === 'DRINKS' ? { ...current, note: event.target.value } : current))}
              className={textareaClass}
            />
          </label>
        </SectionCard>
      ) : (
        <>
          <SectionCard number="01" title="Datum" tablet={tablet}>
            <label className="block">
              <FieldLabel required>Datum</FieldLabel>
              <input
                type="date"
                value={values.occurredOn}
                max={viennaToday()}
                onChange={(event) => setValues((current) => (current.form === 'DAMAGE' ? { ...current, occurredOn: event.target.value } : current))}
                className={inputClass}
              />
            </label>
          </SectionCard>
          <SectionCard number="02" title="Schaden" tablet={tablet}>
            <label className="block">
              <FieldLabel required>Betroffenes Gerät / Ausrüstung</FieldLabel>
              <input
                type="text"
                value={values.equipment}
                maxLength={EQUIPMENT_MAX}
                onChange={(event) => setValues((current) => (current.form === 'DAMAGE' ? { ...current, equipment: event.target.value } : current))}
                className={inputClass}
              />
            </label>
            <div>
              <FieldLabel>Ist der Schaden akut?</FieldLabel>
              <div className="grid grid-cols-2 gap-3">
                {([['Akut', true], ['Nicht akut', false]] as const).map(([label, value]) => {
                  const selected = values.form === 'DAMAGE' && values.acute === value;
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setValues((current) => (current.form === 'DAMAGE' ? { ...current, acute: current.acute === value ? null : value } : current))
                      }
                      className={`min-h-[52px] rounded-lg border text-[15px] font-semibold ${
                        selected ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-[#1c1c1e]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block">
              <FieldLabel required>Beschreibung des Schadens</FieldLabel>
              <textarea
                value={values.description}
                maxLength={DESCRIPTION_MAX}
                rows={tablet ? 6 : 5}
                onChange={(event) => setValues((current) => (current.form === 'DAMAGE' ? { ...current, description: event.target.value } : current))}
                className={textareaClass}
              />
            </label>
          </SectionCard>
        </>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      {tablet ? (
        <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-4 border-t border-neutral-200 bg-white px-6 py-3">
          {cancelButton}
          {counter}
          {submitButton}
        </div>
      ) : (
        <div className="pb-safe-tabbar fixed inset-x-0 bottom-[98px] z-40 flex flex-col gap-2 border-t border-neutral-200 bg-white p-4 sm:bottom-0">
          <div className="text-center">{counter}</div>
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            {cancelButton}
            {submitButton}
          </div>
        </div>
      )}
    </div>
  );
}
```

Hinweis: `NOTIFICATION_FORM_LABEL` wird in dieser Komponente nicht gebraucht (Titel setzen die Seiten); den Import dann entfernen (`tsc` entscheidet). Weicht das echte Markup in einem Test geringfügig ab (Attributreihenfolge o. ä.), die **Test**-Erwartung anpassen, nicht das Verhalten.

Run: `npx vitest run src/lib/heimatfeuerwehr/notification-form-fields.test.ts src/components/heimatfeuerwehr/notification-form-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Typen, Tests, Commit**

```bash
npx tsc --noEmit
npm test
git add src/lib/heimatfeuerwehr/notification-form-fields.ts src/lib/heimatfeuerwehr/notification-form-fields.test.ts \
  src/components/heimatfeuerwehr/notification-form-view.tsx src/components/heimatfeuerwehr/notification-form-view.test.ts
git commit -m "feat: Meldeformulare - Formular-Oberfläche (Getränkeautomat, Schadensmeldung)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verwaltung der Meldeformulare

**Files:**
- Modify: `src/app/(app)/admin/heimatfeuerwehr/report-recipients-form.tsx`, `report-type-row.tsx`, `actions.ts`, `page.tsx`
- Create: `src/app/(app)/admin/heimatfeuerwehr/notification-form-row.tsx`, `drink-products-form.tsx`

**Interfaces:**
- Consumes: Aufgabe 1 (`saveNotificationFormEnabled`, `saveNotificationFormRecipients`, `saveDrinkProducts`, `getNotificationFormSettings`, `isNotificationForm`, `parseDrinkProducts`, `NOTIFICATION_FORMS`, `NOTIFICATION_FORM_LABEL`, `DEFAULT_DRINK_PRODUCTS`, `DRINK_PRODUCTS_MAX`, `DRINK_PRODUCT_MAX_LENGTH`)
- Produces (Server Actions in `actions.ts`): `setNotificationFormEnabled(organizationId, form, enabled): Promise<{ error?: string }>`, `setNotificationFormRecipients(organizationId, form, prevState, formData): Promise<ReportRecipientsState>`, `setDrinkProducts(organizationId, prevState, formData): Promise<ReportRecipientsState>`
- `ReportRecipientsForm` bekommt statt `organizationId`/`type` die Props `action` (gebundene Server Action `(prevState, formData) => Promise<ReportRecipientsState>`) und `idSuffix` (für eindeutige Element-Ids)

Diese Aufgabe ist Verdrahtung der Verwaltungsoberfläche; die Logik ist in Aufgabe 1 getestet. Geprüft wird mit `tsc`, `npm test` und dem Build.

- [ ] **Step 1: `ReportRecipientsForm` verallgemeinern**

In `report-recipients-form.tsx`:

1. Import ersetzen: `import { setReportTypeRecipients, type ReportRecipientsState } from './actions';` durch `import type { ReportRecipientsState } from './actions';`.
2. Die Props ändern auf:

```tsx
export function ReportRecipientsForm({
  action,
  idSuffix,
  initialEmails,
  members,
}: {
  /** Bereits gebundene Server Action (Organisation und Berichtsart bzw. Formular sind darin gebunden). */
  action: (prevState: ReportRecipientsState, formData: FormData) => Promise<ReportRecipientsState>;
  /** Eindeutiger Teil der Element-Ids (mehrere Formulare auf einer Seite). */
  idSuffix: string;
  initialEmails: string[];
  members: { id: string; firstName: string; lastName: string; email: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
```

   (die Zeile `const boundAction = setReportTypeRecipients.bind(null, organizationId, type);` entfällt).
3. Alle vier Vorkommen von `` `newReportRecipientEmail-${type}` `` und `` `reportRecipientPicker-${type}` `` (je `htmlFor` und `id`) auf `${idSuffix}` umstellen: `` `newReportRecipientEmail-${idSuffix}` `` bzw. `` `reportRecipientPicker-${idSuffix}` ``.

In `report-type-row.tsx` den Aufruf des Formulars ändern: Import `setReportTypeRecipients` zu den bestehenden aus `./actions` ergänzen (`import { setReportTypeEnabled, setReportTypeRecipients } from './actions';`) und ersetzen

```tsx
      <ReportRecipientsForm organizationId={organizationId} type={type} initialEmails={recipients} members={members} />
```

durch

```tsx
      <ReportRecipientsForm
        action={setReportTypeRecipients.bind(null, organizationId, type)}
        idSuffix={type}
        initialEmails={recipients}
        members={members}
      />
```

- [ ] **Step 2: Server Actions ergänzen (`actions.ts`)**

Imports ergänzen (zu den vorhandenen):

```ts
import { isNotificationForm, parseDrinkProducts } from '@/lib/heimatfeuerwehr/notification-form-constants';
import {
  saveDrinkProducts,
  saveNotificationFormEnabled,
  saveNotificationFormRecipients,
} from '@/lib/heimatfeuerwehr/notification-form-settings';
```

Am Ende der Datei anhängen:

```ts
/** Meldungen, die `notification-form-settings.ts`/`notification-form-constants.ts` bewusst werfen und die der Admin so lesen darf. */
const NOTIFICATION_FORM_BUSINESS_ERRORS = new Set([
  'Dieses Formular ist nicht verfügbar.',
  'Meldungen gibt es nur für Feuerwehren.',
  'Ungültige Eingabe.',
  'Höchstens 12 Produkte.',
]);

function notificationFormSaveErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    (NOTIFICATION_FORM_BUSINESS_ERRORS.has(error.message) || /^Ein Produktname darf höchstens \d+ Zeichen haben\.$/.test(error.message))
  ) {
    return error.message;
  }
  console.error('Meldeformular konnte nicht gespeichert werden:', error);
  return 'Änderung konnte nicht gespeichert werden.';
}

/** Empfänger eines Meldeformulars (Getränkeautomat/Schadensmeldung) - Chip-Liste wie bei den Berichtsarten. */
export async function setNotificationFormRecipients(
  organizationId: string,
  form: string,
  _prevState: ReportRecipientsState,
  formData: FormData,
): Promise<ReportRecipientsState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));
  if (!isNotificationForm(form)) return { error: 'Dieses Formular ist nicht verfügbar.' };

  const parsed = emailListSchema.safeParse(formData.get('emails'));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };
  }

  try {
    await saveNotificationFormRecipients(organizationId, form, parsed.data);
  } catch (error) {
    return { error: notificationFormSaveErrorMessage(error) };
  }

  revalidatePath('/admin/heimatfeuerwehr');
  revalidatePath('/meine-feuerwehr');
  return { success: true };
}

/** Schaltet ein Meldeformular für die Feuerwehr ein/aus (gilt in der App und am iPad; Empfänger und Produkte bleiben). */
export async function setNotificationFormEnabled(
  organizationId: string,
  form: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));
  if (!isNotificationForm(form)) return { error: 'Dieses Formular ist nicht verfügbar.' };

  try {
    await saveNotificationFormEnabled(organizationId, form, enabled);
  } catch (error) {
    return { error: notificationFormSaveErrorMessage(error) };
  }

  revalidatePath('/admin/heimatfeuerwehr');
  revalidatePath('/meine-feuerwehr');
  return {};
}

/** Produktliste des Getränkeautomaten (Chip-Liste als JSON in einem Hidden-Feld; leer = Standardprodukte). */
export async function setDrinkProducts(
  organizationId: string,
  _prevState: ReportRecipientsState,
  formData: FormData,
): Promise<ReportRecipientsState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const raw = formData.get('products');
  let list: unknown = [];
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      list = JSON.parse(raw);
    } catch {
      return { error: 'Ungültige Eingabe.' };
    }
  }
  const parsed = parseDrinkProducts(list);
  if (!parsed.ok) return { error: parsed.error };

  try {
    await saveDrinkProducts(organizationId, parsed.value);
  } catch (error) {
    return { error: notificationFormSaveErrorMessage(error) };
  }

  revalidatePath('/admin/heimatfeuerwehr');
  return { success: true };
}
```

- [ ] **Step 3: Zeile je Meldeformular (`notification-form-row.tsx`)**

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
import { setNotificationFormEnabled, setNotificationFormRecipients } from './actions';

/**
 * Ein Meldeformular (Getränkeautomat/Schadensmeldung) im Abschnitt "Meldungen" der Karte "Berichte": Schalter
 * "Aktiviert" (gilt in der App und am iPad) und die Empfänger der Meldung. Einschalten geht sofort, Ausschalten fragt per
 * Dialog nach (Muster wie ReportTypeRow); bei einem Serverfehler schaltet der Schalter zurück und zeigt einen Hinweis.
 * `children` nimmt formularspezifische Zusatzeinstellungen auf (Produktliste beim Getränkeautomat).
 */
export function NotificationFormRow({
  organizationId,
  form,
  title,
  enabled,
  recipients,
  members,
  children,
}: {
  organizationId: string;
  form: string;
  title: string;
  enabled: boolean;
  recipients: string[];
  members: { id: string; firstName: string; lastName: string; email: string }[];
  children?: React.ReactNode;
}) {
  const [optimisticEnabled, setOptimisticEnabled] = useState(enabled);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setOptimisticEnabled(enabled);
  }, [organizationId, form, enabled]);

  function apply(next: boolean) {
    setOptimisticEnabled(next);
    startTransition(async () => {
      try {
        const result = await setNotificationFormEnabled(organizationId, form, next);
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
      <p className="text-xs text-ink-faint">
        Diese Adressen erhalten die Meldung per E-Mail. Ohne mindestens eine Adresse ist das Formular nicht verfügbar.
      </p>
      <ReportRecipientsForm
        action={setNotificationFormRecipients.bind(null, organizationId, form)}
        idSuffix={`meldung-${form}`}
        initialEmails={recipients}
        members={members}
      />
      {children}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title} ausschalten?</AlertDialogTitle>
            <AlertDialogDescription>
              Das Formular „{title}“ verschwindet danach am iPad und in der App dieser Feuerwehr. Empfänger und Produkte bleiben
              unverändert erhalten.
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

- [ ] **Step 4: Produktliste (`drink-products-form.tsx`)**

```tsx
'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  DEFAULT_DRINK_PRODUCTS,
  DRINK_PRODUCTS_MAX,
  DRINK_PRODUCT_MAX_LENGTH,
} from '@/lib/heimatfeuerwehr/notification-form-constants';
import { setDrinkProducts, type ReportRecipientsState } from './actions';

const initialState: ReportRecipientsState = {};

/**
 * Produktliste des Getränkeautomaten je Feuerwehr (Chips, Hinzufügen/Entfernen, 1 bis 12 Produkte). Eine leere Liste
 * speichert die Standardprodukte. Die Liste geht als JSON in einem Hidden-Feld an die Server Action (wie die
 * E-Mail-Chips).
 */
export function DrinkProductsForm({ organizationId, initialProducts }: { organizationId: string; initialProducts: string[] }) {
  const [state, formAction, pending] = useActionState(setDrinkProducts.bind(null, organizationId), initialState);
  const [products, setProducts] = useState<string[]>(initialProducts);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.success) setDirty(false);
  }, [state]);

  const saved = state.success && !dirty;

  function add() {
    const name = draft.replace(/\s+/g, ' ').trim();
    if (!name || products.some((p) => p.toLowerCase() === name.toLowerCase()) || products.length >= DRINK_PRODUCTS_MAX) {
      setDraft('');
      return;
    }
    setProducts((current) => [...current, name]);
    setDraft('');
    setDirty(true);
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-3">
      <input type="hidden" name="products" value={JSON.stringify(products)} />
      <p className="text-[13px] font-medium text-ink">Produkte am Automaten</p>
      <div className="flex flex-wrap gap-2">
        {products.map((product) => (
          <span key={product} className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-3 py-1 text-sm text-ink">
            {product}
            <button
              type="button"
              aria-label={`${product} entfernen`}
              className="text-ink-muted hover:text-danger"
              onClick={() => {
                setProducts((current) => current.filter((p) => p !== product));
                setDirty(true);
              }}
            >
              ×
            </button>
          </span>
        ))}
        {products.length === 0 && <span className="text-sm text-ink-faint">Standard: {DEFAULT_DRINK_PRODUCTS.join(', ')}</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          maxLength={DRINK_PRODUCT_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Produkt hinzufügen"
          className="flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
        <button type="button" onClick={add} className="rounded-md bg-neutral-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-600">
          Hinzufügen
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        Höchstens {DRINK_PRODUCTS_MAX} Produkte. Ohne Einträge gilt die Standardliste.
      </p>
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

- [ ] **Step 5: Abschnitt "Meldungen" in `page.tsx` einbauen**

In `src/app/(app)/admin/heimatfeuerwehr/page.tsx`:

1. Imports ergänzen:

```tsx
import { NOTIFICATION_FORMS, NOTIFICATION_FORM_LABEL } from '@/lib/heimatfeuerwehr/notification-form-constants';
import { getNotificationFormSettings } from '@/lib/heimatfeuerwehr/notification-form-settings';
import { NotificationFormRow } from './notification-form-row';
import { DrinkProductsForm } from './drink-products-form';
```

2. Direkt unter der Zeile `const reportTypeSettings = await getReportTypeSettings(selectedOrgId);` ergänzen: `const notificationFormSettings = await getNotificationFormSettings(selectedOrgId);`
3. In der Karte "Berichte" **direkt nach** dem Block `{selectedOrgFull.type === 'FEUERWEHR' ? ( <div className="flex flex-col gap-3"> {ACTIVE_REPORT_TYPES.map(...)} </div> ) : ( <p ...>Nur für Feuerwehren verfügbar.</p> )}` und **vor** der Tabelle der abgegebenen Berichte (`<Table className="mt-3">`) einfügen:

```tsx
        {selectedOrgFull.type === 'FEUERWEHR' && (
          <>
            <h3 className="mb-1 mt-5 text-[15px] font-semibold text-ink">Meldungen</h3>
            <p className="mb-3 text-xs text-ink-faint">
              Getränkeautomat und Schadensmeldung gehen als E-Mail an die Empfänger. Eine Meldung ist nur verfügbar, wenn sie
              eingeschaltet ist und mindestens einen Empfänger hat. Es wird nichts gespeichert.
            </p>
            <div className="flex flex-col gap-3">
              {NOTIFICATION_FORMS.map((form) => (
                <NotificationFormRow
                  key={`${selectedOrgId}-${form}`}
                  organizationId={selectedOrgId}
                  form={form}
                  title={NOTIFICATION_FORM_LABEL[form]}
                  enabled={notificationFormSettings[form].enabled}
                  recipients={notificationFormSettings[form].recipients}
                  members={heimatfeuerwehrPickerMembers}
                >
                  {form === 'DRINKS' && (
                    <DrinkProductsForm
                      key={`${selectedOrgId}-products`}
                      organizationId={selectedOrgId}
                      initialProducts={notificationFormSettings.DRINKS.products}
                    />
                  )}
                </NotificationFormRow>
              ))}
            </div>
          </>
        )}
```

   Hinweis: `notificationFormSettings.DRINKS.products` ist bereits aufgelöst (leer gespeichert = Standardprodukte). Das Formular zeigt dann die Standardprodukte als Chips; ein Speichern ohne Änderung schreibt sie als eigene Liste. Das ist gewollt und harmlos.

- [ ] **Step 6: Typen, Tests, Commit**

```bash
npx tsc --noEmit
npm test
git add "src/app/(app)/admin/heimatfeuerwehr/report-recipients-form.tsx" "src/app/(app)/admin/heimatfeuerwehr/report-type-row.tsx" \
  "src/app/(app)/admin/heimatfeuerwehr/actions.ts" "src/app/(app)/admin/heimatfeuerwehr/page.tsx" \
  "src/app/(app)/admin/heimatfeuerwehr/notification-form-row.tsx" "src/app/(app)/admin/heimatfeuerwehr/drink-products-form.tsx"
git commit -m "feat: Verwaltung der Meldeformulare (Schalter, Empfänger, Produktliste)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: App: Einstieg und Seite

**Files:**
- Modify: `src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.tsx`, `report-type-sheet.test.ts`, `src/app/(app)/meine-feuerwehr/action-row.tsx`, `src/app/(app)/meine-feuerwehr/page.tsx`
- Create: `src/app/(app)/meine-feuerwehr/meldungen/[formular]/page.tsx`, `meldung-client.tsx`

**Interfaces:**
- Consumes: `getNotificationFormStates`, `getNotificationFormSetting` (Aufgabe 1), `NotificationFormView` (Aufgabe 4), `submitNotification` (Aufgabe 3)
- `ReportTypeSheet` bekommt zusätzlich die Prop `notificationStates: Record<string, NotificationFormState>`, `ActionRow` die Prop `notificationStates` (gleicher Typ)

- [ ] **Step 1: Tests für das Blatt erweitern (`report-type-sheet.test.ts`)**

Die Hilfsfunktion `render` im vorhandenen Test bekommt den neuen Parameter (Standardwert: beide Formulare verfügbar). Ersetzen:

```ts
function render(enabledTypes: string[]): string {
  return renderToStaticMarkup(createElement(ReportTypeSheet, { onClose: () => undefined, enabledTypes }));
}
```

durch

```ts
function render(
  enabledTypes: string[],
  notificationStates: Record<string, 'available' | 'norecipient' | 'off'> = { DRINKS: 'available', DAMAGE: 'available' },
): string {
  return renderToStaticMarkup(createElement(ReportTypeSheet, { onClose: () => undefined, enabledTypes, notificationStates }));
}
```

Die bestehende Prüfung "sperrt alle Arten, wenn keine eingeschaltet ist" zählt `disabled=""` (Anzahl 3). Sie bleibt gültig, wenn der zweite Parameter dort beide Formulare ebenfalls sperrt oder die Zahl angepasst wird: Den Aufruf `render([])` in diesem Test auf `render([], { DRINKS: 'off', DAMAGE: 'off' })` ändern und die erwartete Anzahl von `3` auf `5` setzen (drei Berichtsarten plus zwei Formulare). Neue Tests am Ende der Datei anhängen:

```ts
describe('ReportTypeSheet: Abschnitt Meldungen', () => {
  function buttonFor(html: string, title: string): string {
    const match = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${title}(?:(?!</button>).)*</button>`));
    return match ? match[0] : '';
  }

  it('zeigt den Abschnitt "Meldungen" mit beiden Formularen antippbar, wenn sie verfügbar sind', () => {
    const html = render(['ACTIVITY']);
    expect(html).toContain('Meldungen');
    expect(buttonFor(html, 'Getränkeautomat')).not.toBe('');
    expect(buttonFor(html, 'Getränkeautomat')).not.toContain('disabled=""');
    expect(buttonFor(html, 'Schadensmeldung')).not.toContain('disabled=""');
  });

  it('sperrt ein Formular ohne Empfänger ("Kein Empfänger hinterlegt") und ein abgeschaltetes ("Nicht aktiviert")', () => {
    const html = render(['ACTIVITY'], { DRINKS: 'norecipient', DAMAGE: 'off' });
    expect(buttonFor(html, 'Getränkeautomat')).toContain('disabled=""');
    expect(buttonFor(html, 'Getränkeautomat')).toContain('Kein Empfänger hinterlegt');
    expect(buttonFor(html, 'Schadensmeldung')).toContain('disabled=""');
    expect(buttonFor(html, 'Schadensmeldung')).toContain('Nicht aktiviert');
  });
});
```

Run: `npx vitest run "src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.test.ts"`
Expected: FAIL (Prop und Abschnitt fehlen; die "Nicht aktiviert"-Prüfung der Berichtsarten bleibt unberührt).

- [ ] **Step 2: `ReportTypeSheet` erweitern**

In `report-type-sheet.tsx`:

1. Imports ergänzen:

```tsx
import { NOTIFICATION_FORMS, NOTIFICATION_FORM_LABEL, NOTIFICATION_FORM_SLUG, type NotificationFormState } from '@/lib/heimatfeuerwehr/notification-form-constants';
```

2. Die Props erweitern (Parameterliste und Typ) um `notificationStates: Record<string, NotificationFormState>`.
3. Neue Funktion neben `choose`:

```tsx
  function chooseForm(form: (typeof NOTIFICATION_FORMS)[number]) {
    if (notificationStates[form] !== 'available') return;
    router.push(`/meine-feuerwehr/meldungen/${NOTIFICATION_FORM_SLUG[form]}`);
  }
```

4. Direkt **nach** dem schließenden `</div>` der Liste der Berichtsarten (`<div className="flex flex-col gap-2">…</div>`) und vor dem schließenden `</div>` des Blatts einfügen:

```tsx
        <h2 className="mb-3 mt-6 text-[17px] font-semibold text-[#1c1c1e]">Meldungen</h2>
        <div className="flex flex-col gap-2">
          {NOTIFICATION_FORMS.map((form) => {
            const state = notificationStates[form];
            const active = state === 'available';
            return (
              <button
                key={form}
                type="button"
                disabled={!active}
                onClick={() => chooseForm(form)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3.5 text-left text-[15px] font-medium ${
                  active ? 'border-brand text-[#1c1c1e]' : 'cursor-not-allowed border-neutral-200 text-neutral-400'
                }`}
              >
                <span>{NOTIFICATION_FORM_LABEL[form]}</span>
                {!active && (
                  <span className="text-xs font-normal">{state === 'norecipient' ? 'Kein Empfänger hinterlegt' : 'Nicht aktiviert'}</span>
                )}
              </button>
            );
          })}
        </div>
```

Run den Test aus Step 1: Expected PASS.

- [ ] **Step 3: `ActionRow` und Seite verdrahten**

`action-row.tsx`: Typimport `import type { NotificationFormState } from '@/lib/heimatfeuerwehr/notification-form-constants';`, die Props um `notificationStates: Record<string, NotificationFormState>` erweitern (Parameterliste und Typ) und den Aufruf ändern:

```tsx
      {sheetOpen && (
        <ReportTypeSheet onClose={() => setSheetOpen(false)} enabledTypes={enabledReportTypes} notificationStates={notificationStates} />
      )}
```

`src/app/(app)/meine-feuerwehr/page.tsx`: Import `import { getNotificationFormStates } from '@/lib/heimatfeuerwehr/notification-form-settings';`; in dem bestehenden `Promise.all`, das `getEnabledReportTypes(user.homeOrganizationId)` als letztes Element enthält, als **neues letztes Element** `getNotificationFormStates(user.homeOrganizationId)` ergänzen und die Destrukturierung entsprechend um `notificationStates` am Ende erweitern (Reihenfolge von Array und Variablenliste muss übereinstimmen). Den Aufruf ergänzen:

```tsx
        <ActionRow
          showPhotoUpload={canManagePhotoUploadsFor(user, user.homeOrganizationId)}
          enabledReportTypes={enabledReportTypes}
          notificationStates={notificationStates}
        />
```

(Den tatsächlichen Namen der Prop `showPhotoUpload` und die vorhandene Formatierung des Aufrufs in der Datei beibehalten.)

- [ ] **Step 4: Seite für die Meldung anlegen**

`src/app/(app)/meine-feuerwehr/meldungen/[formular]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import { formFromSlug, notificationFormState } from '@/lib/heimatfeuerwehr/notification-form-constants';
import { getNotificationFormSetting } from '@/lib/heimatfeuerwehr/notification-form-settings';
import { MeldungClient } from './meldung-client';

/** Meldeformular (Getränkeautomat/Schadensmeldung) für angemeldete Mitglieder. 404, wenn das Formular unbekannt, abgeschaltet oder ohne Empfänger ist. */
export default async function MeldungPage({ params }: { params: Promise<{ formular: string }> }) {
  const user = await requireUser();
  assertPermission(canCreateReportFor(user, user.homeOrganizationId));

  const { formular } = await params;
  const form = formFromSlug(formular);
  if (!form) notFound();

  const setting = await getNotificationFormSetting(user.homeOrganizationId, form);
  if (notificationFormState(setting) !== 'available') notFound();

  return <MeldungClient form={form} products={setting.products} />;
}
```

`src/app/(app)/meine-feuerwehr/meldungen/[formular]/meldung-client.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { NotificationForm } from '@prisma/client';
import { NOTIFICATION_FORM_LABEL } from '@/lib/heimatfeuerwehr/notification-form-constants';
import { NotificationFormView } from '@/components/heimatfeuerwehr/notification-form-view';
import { submitNotification } from '../actions';

/** Client-Teil der Meldeseite: Formular im Handy-Layout, nach dem Absenden die Bestätigung mit Link zurück zur Startseite. */
export function MeldungClient({ form, products }: { form: NotificationForm; products: string[] }) {
  const router = useRouter();
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <h1 className="text-[22px] font-bold text-[#1c1c1e]">Meldung gesendet</h1>
        <p className="text-sm text-neutral-500">{NOTIFICATION_FORM_LABEL[form]}</p>
        <Link href="/meine-feuerwehr" className="mt-4 rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white">
          Zur Startseite
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-bold text-[#1c1c1e]">{NOTIFICATION_FORM_LABEL[form]}</h1>
      <NotificationFormView
        form={form}
        products={products}
        layout="mobile"
        onSubmit={submitNotification}
        onDone={() => setSent(true)}
        onCancel={() => router.push('/meine-feuerwehr')}
      />
    </div>
  );
}
```

- [ ] **Step 5: Typen, Tests, Commit**

```bash
npx tsc --noEmit
npm test
git add "src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.tsx" "src/app/(app)/meine-feuerwehr/berichte/report-type-sheet.test.ts" \
  "src/app/(app)/meine-feuerwehr/action-row.tsx" "src/app/(app)/meine-feuerwehr/page.tsx" \
  "src/app/(app)/meine-feuerwehr/meldungen/[formular]/page.tsx" "src/app/(app)/meine-feuerwehr/meldungen/[formular]/meldung-client.tsx"
git commit -m "feat: Meldeformulare in der App (Einstieg im Berichtsblatt, Meldeseite)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: iPad: Kacheln, Seitendaten und Ablauf

**Files:**
- Modify: `src/lib/heimatfeuerwehr/kiosk-tiles.ts`, `kiosk-tiles.test.ts`, `report-kiosk-data.ts`, `report-kiosk-data.db.test.ts`
- Modify: `src/app/berichte-schnell/[token]/kiosk-form-screen.tsx`, `kiosk-flow.tsx` (vollständig ersetzen), `kiosk-flow.test.ts`, `page.tsx`

**Interfaces:**
- Produces: `KioskTileState` bekommt `'norecipient'`; `KioskTile` bekommt `form: NotificationForm | null`; `KIOSK_TILE_HINT` bekommt `norecipient: 'Kein Empfänger hinterlegt'`; `getKioskTiles(enabledTypes, notificationStates = {})`
- Produces: `KioskData.notificationForms: Record<NotificationForm, { state: NotificationFormState; products: string[] }>`; `KioskFlowProps.notificationForms` (gleicher Typ)

- [ ] **Step 1: Tests für die Kacheln erweitern (`kiosk-tiles.test.ts`)**

Am Ende der Datei anhängen:

```ts
describe('getKioskTiles: Meldeformulare', () => {
  const both = ['ACTIVITY', 'EXERCISE'];

  it('Getränkeautomat und Schadensmeldung sind aktiv, wenn das Formular verfügbar ist', () => {
    const states = Object.fromEntries(getKioskTiles(both, { DRINKS: 'available', DAMAGE: 'available' }).map((tile) => [tile.key, tile.state]));
    expect(states.DRINKS).toBe('active');
    expect(states.DAMAGE).toBe('active');
    expect(states.INCIDENT).toBe('soon');
  });

  it('ein eingeschaltetes Formular ohne Empfänger ist "norecipient", ein abgeschaltetes "off"', () => {
    const states = Object.fromEntries(getKioskTiles(both, { DRINKS: 'norecipient', DAMAGE: 'off' }).map((tile) => [tile.key, tile.state]));
    expect(states.DRINKS).toBe('norecipient');
    expect(states.DAMAGE).toBe('off');
  });

  it('ohne Angabe zu den Formularen bleiben sie "Bald verfügbar" (soon)', () => {
    const states = Object.fromEntries(getKioskTiles(both).map((tile) => [tile.key, tile.state]));
    expect(states.DRINKS).toBe('soon');
    expect(states.DAMAGE).toBe('soon');
  });

  it('trägt das Formular der Meldekacheln und null bei den Berichtskacheln', () => {
    const forms = Object.fromEntries(getKioskTiles(both).map((tile) => [tile.key, tile.form]));
    expect(forms).toEqual({ ACTIVITY: null, EXERCISE: null, INCIDENT: null, DRINKS: 'DRINKS', DAMAGE: 'DAMAGE' });
  });

  it('hat den Hinweistext für fehlende Empfänger', () => {
    expect(KIOSK_TILE_HINT.norecipient).toBe('Kein Empfänger hinterlegt');
  });
});
```

(`KIOSK_TILE_HINT` und `getKioskTiles` sind in dieser Testdatei bereits importiert; sonst ergänzen. Die vorhandene Prüfung `expect(KIOSK_TILE_HINT).toEqual({ off: ..., soon: ... })` auf `toEqual({ off: 'Nicht aktiviert', soon: 'Bald verfügbar', norecipient: 'Kein Empfänger hinterlegt' })` erweitern.)

Run: `npx vitest run src/lib/heimatfeuerwehr/kiosk-tiles.test.ts` — Expected: FAIL.

- [ ] **Step 2: `kiosk-tiles.ts` ändern**

Den Inhalt der Datei ersetzen durch:

```ts
import type { NotificationForm, ReportType } from '@prisma/client';
import type { NotificationFormState } from './notification-form-constants';
import { ACTIVE_REPORT_TYPES } from './report-constants';

export type KioskTileState = 'active' | 'off' | 'soon' | 'norecipient';

export interface KioskTile {
  key: 'ACTIVITY' | 'EXERCISE' | 'INCIDENT' | 'DRINKS' | 'DAMAGE';
  title: string;
  subtitle: string;
  state: KioskTileState;
  /** Berichtsart der Kachel; null bei den Meldeformularen (Getränkeautomat, Schadensmeldung). */
  type: ReportType | null;
  /** Meldeformular der Kachel; null bei den Berichts-Kacheln. */
  form: NotificationForm | null;
}

export const KIOSK_TILE_HINT = {
  off: 'Nicht aktiviert',
  soon: 'Bald verfügbar',
  norecipient: 'Kein Empfänger hinterlegt',
} as const;

const TILE_DEFINITIONS: {
  key: KioskTile['key'];
  title: string;
  subtitle: string;
  type: ReportType | null;
  form: NotificationForm | null;
}[] = [
  { key: 'ACTIVITY', title: 'Tätigkeitsbericht', subtitle: 'Dienste, Versammlungen, Wartung', type: 'ACTIVITY', form: null },
  { key: 'EXERCISE', title: 'Übungsbericht', subtitle: 'Geplante Übungen, Schulungen', type: 'EXERCISE', form: null },
  { key: 'INCIDENT', title: 'Einsatzbericht', subtitle: 'Alarmierungen, Einsätze', type: 'INCIDENT', form: null },
  { key: 'DRINKS', title: 'Getränkeautomat', subtitle: 'Meldung an Getränkewart', type: null, form: 'DRINKS' },
  { key: 'DAMAGE', title: 'Schadensmeldung', subtitle: 'Defekte Ausrüstung melden', type: null, form: 'DAMAGE' },
];

/**
 * Kacheln des Startbildschirms. Eine Berichts-Kachel ist nur aktiv, wenn die Art in der App freigeschaltet
 * (`ACTIVE_REPORT_TYPES`) UND für die Feuerwehr eingeschaltet ist; eine freigeschaltete, aber abgeschaltete Art ist
 * "off". Eine Meldekachel ist aktiv, wenn das Formular verfügbar ist (eingeschaltet UND mindestens ein Empfänger),
 * "norecipient" bei eingeschaltet ohne Empfänger, "off" bei abgeschaltet; ohne Angabe zum Formular bleibt sie "soon".
 * Alles Übrige (Einsatzbericht) ist "soon" (noch nicht verfügbar).
 */
export function getKioskTiles(
  enabledTypes: readonly string[],
  notificationStates: Partial<Record<string, NotificationFormState>> = {},
): KioskTile[] {
  return TILE_DEFINITIONS.map((definition) => {
    let state: KioskTileState = 'soon';
    if (definition.type && ACTIVE_REPORT_TYPES.includes(definition.type)) {
      state = enabledTypes.includes(definition.type) ? 'active' : 'off';
    } else if (definition.form) {
      const formState = notificationStates[definition.form];
      if (formState === 'available') state = 'active';
      else if (formState === 'norecipient') state = 'norecipient';
      else if (formState === 'off') state = 'off';
    }
    return { ...definition, state };
  });
}
```

Run den Test aus Step 1: Expected PASS (alle vorhandenen Kachel-Tests bleiben grün, weil ohne zweites Argument alles wie bisher ist).

- [ ] **Step 3: Hinweis in der Kachelansicht anpassen (`kiosk-form-screen.tsx`)**

Die Zeile

```tsx
                    {KIOSK_TILE_HINT[tile.state === 'off' ? 'off' : 'soon']}
```

ersetzen durch

```tsx
                    {tile.state !== 'active' && KIOSK_TILE_HINT[tile.state]}
```

Den Doc-Kommentar der Komponente um "'Kein Empfänger hinterlegt' = Meldeformular ohne Empfänger" ergänzen.

- [ ] **Step 4: Seitendaten ergänzen (Test zuerst)**

In `report-kiosk-data.db.test.ts` (Fixtures dort: `orgA`, Token über `setReportKioskToken(orgA)`; die tatsächlichen Namen der Datei verwenden) Import `import { saveDrinkProducts, saveNotificationFormEnabled, saveNotificationFormRecipients } from './notification-form-settings';` ergänzen und im `describe('loadKioskData', …)` anhängen:

```ts
  it('liefert Zustand und Produkte der Meldeformulare, ohne Empfängeradressen', async () => {
    const token = await setReportKioskToken(orgA);
    const before = await loadKioskData(token);
    expect(before?.notificationForms.DRINKS.state).toBe('norecipient');
    expect(before?.notificationForms.DRINKS.products).toEqual(['Bier', 'Spritzer', 'Eistee', 'Spezi']);
    expect(before?.notificationForms.DAMAGE).toEqual({ state: 'norecipient', products: [] });

    await saveNotificationFormRecipients(orgA, 'DRINKS', ['geheim@example.local']);
    await saveNotificationFormRecipients(orgA, 'DAMAGE', ['geheim2@example.local']);
    await saveDrinkProducts(orgA, ['Cola']);
    await saveNotificationFormEnabled(orgA, 'DAMAGE', false);
    try {
      const after = await loadKioskData(token);
      expect(after?.notificationForms.DRINKS).toEqual({ state: 'available', products: ['Cola'] });
      expect(after?.notificationForms.DAMAGE.state).toBe('off');
      expect(JSON.stringify(after)).not.toContain('geheim');
    } finally {
      await saveNotificationFormEnabled(orgA, 'DAMAGE', true);
      await saveNotificationFormRecipients(orgA, 'DRINKS', []);
      await saveNotificationFormRecipients(orgA, 'DAMAGE', []);
      await saveDrinkProducts(orgA, []);
    }
  });
```

Run: `npx vitest run --config vitest.db.config.ts src/lib/heimatfeuerwehr/report-kiosk-data.db.test.ts` — Expected: der neue Test FAIL (Feld fehlt). Dann `report-kiosk-data.ts` ändern:

1. Imports ergänzen: `import type { NotificationForm } from '@prisma/client';`, `import { NOTIFICATION_FORMS, notificationFormState, type NotificationFormState } from './notification-form-constants';`, `import { getNotificationFormSettings } from './notification-form-settings';`
2. `KioskData` ergänzen:

```ts
  /** Zustand je Meldeformular und (nur Getränkeautomat) die Produktliste; nie die Empfängeradressen (das Gerät ist öffentlich). */
  notificationForms: Record<NotificationForm, { state: NotificationFormState; products: string[] }>;
```

3. In `loadKioskData` direkt nach `const enabledTypes = await getEnabledReportTypes(organization.id);` ergänzen:

```ts
  const notificationSettings = await getNotificationFormSettings(organization.id);
  const notificationForms = Object.fromEntries(
    NOTIFICATION_FORMS.map((form) => [
      form,
      { state: notificationFormState(notificationSettings[form]), products: notificationSettings[form].products },
    ]),
  ) as KioskData['notificationForms'];
```

   und im Rückgabeobjekt `notificationForms,` ergänzen.

Run den Test erneut: Expected PASS (alle in der Datei).

- [ ] **Step 5: Tests für den Ablauf anpassen (`kiosk-flow.test.ts`)**

In den Test-Props (`const props = { … }`) ergänzen:

```ts
  notificationForms: {
    DRINKS: { state: 'available' as const, products: ['Bier', 'Spritzer'] },
    DAMAGE: { state: 'norecipient' as const, products: [] },
  },
```

Neue Tests im vorhandenen `describe('KioskFlow: Startbildschirm', …)` anhängen (die Hilfsfunktionen `render` und `buttonFor` existieren dort):

```ts
  it('zeigt die Meldekacheln: Getränkeautomat antippbar, Schadensmeldung ohne Empfänger gesperrt mit Hinweis', () => {
    const html = render();
    expect(buttonFor(html, 'Getränkeautomat')).not.toContain('disabled=""');
    expect(buttonFor(html, 'Schadensmeldung')).toContain('disabled=""');
    expect(buttonFor(html, 'Schadensmeldung')).toContain('Kein Empfänger hinterlegt');
    expect(buttonFor(html, 'Einsatzbericht')).toContain('Bald verfügbar');
  });

  it('zeigt ein abgeschaltetes Meldeformular als "Nicht aktiviert"', () => {
    const html = render({
      notificationForms: { DRINKS: { state: 'off', products: [] }, DAMAGE: { state: 'available', products: [] } },
    });
    expect(buttonFor(html, 'Getränkeautomat')).toContain('disabled=""');
    expect(buttonFor(html, 'Getränkeautomat')).toContain('Nicht aktiviert');
    expect(buttonFor(html, 'Schadensmeldung')).not.toContain('disabled=""');
  });
```

Falls der Typ von `render(over: Partial<typeof props>)` wegen der Literalarten (`'available' as const`) meckert, die Props-Konstante bzw. die Parameter so typisieren, dass `state` die Union `'available' | 'norecipient' | 'off'` zulässt (z. B. `const props: Parameters<typeof KioskFlow>[0] = { … }` und `render(over: Partial<Parameters<typeof KioskFlow>[0]> = {})`).

Run: `npx vitest run "src/app/berichte-schnell/[token]/kiosk-flow.test.ts"` — Expected: FAIL (Prop/Verhalten fehlt).

- [ ] **Step 6: `kiosk-flow.tsx` vollständig ersetzen**

Den gesamten Inhalt von `src/app/berichte-schnell/[token]/kiosk-flow.tsx` ersetzen (Write-Werkzeug, danach `git diff --cached --stat` prüfen):

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReportWizard } from '@/app/(app)/meine-feuerwehr/berichte/neu/report-wizard';
import { NotificationFormView } from '@/components/heimatfeuerwehr/notification-form-view';
import { getKioskTiles, type KioskTile } from '@/lib/heimatfeuerwehr/kiosk-tiles';
import { NOTIFICATION_FORM_LABEL, type NotificationFormState } from '@/lib/heimatfeuerwehr/notification-form-constants';
import { REPORT_TYPE_LABEL } from '@/lib/heimatfeuerwehr/report-constants';
import type { NotificationForm, ReportType } from '@prisma/client';
import { submitNotificationViaKiosk, submitReportViaKiosk } from './actions';
import { KioskFormScreen } from './kiosk-form-screen';
import { KioskHeader } from './kiosk-header';
import { WizardFrame } from './wizard-frame';

export interface KioskFlowProps {
  token: string;
  organizationName: string;
  deviceName: string | null;
  enabledTypes: string[];
  notificationForms: Record<NotificationForm, { state: NotificationFormState; products: string[] }>;
  members: { id: string; firstName: string; lastName: string }[];
  vehicles: { id: string; taktischeBezeichnung: string; kennzeichen: string }[];
  recentKindsByType: Record<string, string[]>;
}

type Target = { kind: 'report'; type: ReportType } | { kind: 'form'; form: NotificationForm };

type Phase =
  | { phase: 'form' }
  | { phase: 'name'; target: Target }
  | { phase: 'wizard'; filledById: string; type: ReportType; run: number }
  | { phase: 'notify'; filledById: string; form: NotificationForm; run: number }
  | { phase: 'done'; kind: 'report' | 'notification'; number?: number; year?: number };

const DONE_RESET_MS = 30_000;

/**
 * Ablauf der iPad-Schnellerfassung als reiner Client-Zustand: Formular (Kacheln) -> Namenswahl -> Assistent (Bericht) bzw.
 * Meldeformular (Getränkeautomat/Schadensmeldung) -> Bestätigung -> (nach 30 s oder "Neues Formular") zurück zum
 * Formularbildschirm. Damit bleibt keine Person auf dem gemeinsamen Gerät "angemeldet", und die Eingaben der Vorgängerin
 * sind weg (Assistent und Meldeformular halten ihren Zustand nur im Browser-Speicher und werden bei jedem Lauf neu
 * eingehängt). Die Elementstruktur der Phasen hängt nie vom Layout ab: ein Layoutwechsel (Drehen) hängt nichts neu ein.
 */
export function KioskFlow({
  token,
  organizationName,
  deviceName,
  enabledTypes,
  notificationForms,
  members,
  vehicles,
  recentKindsByType,
}: KioskFlowProps) {
  const [state, setState] = useState<Phase>({ phase: 'form' });
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

  const reset = useCallback(() => {
    setSearch('');
    setState({ phase: 'form' });
  }, []);

  // Nach der Bestätigung automatisch zurück zum Formularbildschirm; der Timer wird beim Verlassen der Phase gelöscht.
  const isDone = state.phase === 'done';
  useEffect(() => {
    if (!isDone) return;
    const timer = setTimeout(reset, DONE_RESET_MS);
    return () => clearTimeout(timer);
  }, [isDone, reset]);

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
        onDone={(result) => setState({ phase: 'done', kind: 'report', number: result.number, year: result.year })}
        onCancel={reset}
      />
    );
    // Stabiler Rahmen in beiden Layouts: ein Layoutwechsel (Drehen) darf den Assistenten nicht neu einhängen.
    return <WizardFrame layout={layout}>{wizard}</WizardFrame>;
  }

  if (state.phase === 'notify') {
    const sender = members.find((member) => member.id === state.filledById);
    return (
      <div className="flex min-h-[100dvh] touch-manipulation flex-col bg-[#f6f6f7] text-[#1c1c1e]">
        <KioskHeader organizationName={organizationName} title={NOTIFICATION_FORM_LABEL[state.form]} deviceName={deviceName} />
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">
          {sender && (
            <p className="mb-4 text-sm text-neutral-500">
              Meldung von {sender.firstName} {sender.lastName}
            </p>
          )}
          <NotificationFormView
            key={state.run}
            form={state.form}
            products={notificationForms[state.form].products}
            layout={layout}
            onSubmit={(input) => submitNotificationViaKiosk(token, state.filledById, input)}
            onDone={() => setState({ phase: 'done', kind: 'notification' })}
            onCancel={reset}
          />
        </main>
      </div>
    );
  }

  const tiles = getKioskTiles(
    enabledTypes,
    Object.fromEntries(Object.entries(notificationForms).map(([form, value]) => [form, value.state])),
  );
  const headerTitle =
    state.phase === 'form'
      ? 'Welches Formular ausfüllen?'
      : state.phase === 'name'
        ? state.target.kind === 'report'
          ? 'Wer schreibt den Bericht?'
          : 'Wer macht die Meldung?'
        : state.kind === 'notification'
          ? 'Meldung gesendet'
          : 'Bericht abgegeben';

  return (
    <div className="flex min-h-[100dvh] touch-manipulation flex-col bg-[#f6f6f7] text-[#1c1c1e]">
      <KioskHeader organizationName={organizationName} title={headerTitle} deviceName={deviceName} />

      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        {state.phase === 'form' && (
          <KioskFormScreen
            tiles={tiles}
            onChoose={(tile: KioskTile) => {
              if (tile.state !== 'active') return;
              if (tile.type) {
                setSearch('');
                setState({ phase: 'name', target: { kind: 'report', type: tile.type } });
              } else if (tile.form) {
                setSearch('');
                setState({ phase: 'name', target: { kind: 'form', form: tile.form } });
              }
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
                      // Jeder Lauf bekommt einen neuen key, damit Assistent bzw. Meldeformular mit leerem Zustand starten.
                      const nextRun = run + 1;
                      setRun(nextRun);
                      setState(
                        state.target.kind === 'report'
                          ? { phase: 'wizard', filledById: member.id, type: state.target.type, run: nextRun }
                          : { phase: 'notify', filledById: member.id, form: state.target.form, run: nextRun },
                      );
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
            {state.kind === 'report' && state.number !== undefined && state.year !== undefined && (
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
}
```

`page.tsx` des Kiosks: dem `<KioskFlow … />` die neue Prop übergeben: `notificationForms={data.notificationForms}`.

Run: `npx vitest run "src/app/berichte-schnell/[token]/kiosk-flow.test.ts" "src/app/berichte-schnell/[token]/wizard-frame.test.ts"` — Expected PASS.

- [ ] **Step 7: Typen, Tests, Commit**

```bash
npx tsc --noEmit
npm test
git add src/lib/heimatfeuerwehr/kiosk-tiles.ts src/lib/heimatfeuerwehr/kiosk-tiles.test.ts \
  src/lib/heimatfeuerwehr/report-kiosk-data.ts src/lib/heimatfeuerwehr/report-kiosk-data.db.test.ts \
  "src/app/berichte-schnell/[token]/kiosk-form-screen.tsx" "src/app/berichte-schnell/[token]/kiosk-flow.tsx" \
  "src/app/berichte-schnell/[token]/kiosk-flow.test.ts" "src/app/berichte-schnell/[token]/page.tsx"
git commit -m "feat: Meldeformulare am iPad (Kachelzustände, Seitendaten, Ablauf)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Dokumentation und Gesamtprüfung

**Files:**
- Modify: `src/app/(app)/meine-feuerwehr/CLAUDE.md`

- [ ] **Step 1: Dokumentation anpassen**

In `src/app/(app)/meine-feuerwehr/CLAUDE.md` den Abschnitt "Berichte-Schnellerfassung am iPad" ergänzen und veraltete Sätze berichtigen (die Datei zuerst lesen, die Formulierungen an das tatsächlich Vorhandene anpassen, nichts Unwahres stehen lassen):

- Neuer Unterabschnitt "Meldeformulare (Getränkeautomat, Schadensmeldung)":
  - Spec `docs/superpowers/specs/2026-11-15-meldungen-getraenke-schaden-design.md`, Plan `docs/superpowers/plans/2026-11-15-meldungen-getraenke-schaden.md`.
  - Sie sind keine Berichte (`Report`): keine Nummer, kein PDF, **nichts wird gespeichert**; die Meldung geht als eine E-Mail je Empfänger (Reply-To = Absender), scheitert der Versand an allen Empfängern, bekommt der Nutzer einen Fehler (Teilausfall = gesendet).
  - Daten: Tabelle `NotificationFormSetting` (je Feuerwehr und `NotificationForm` `DRINKS`/`DAMAGE`: `enabled`, `recipients`, `products` nur DRINKS), fehlende Zeile = eingeschaltet/keine Empfänger/Standardprodukte (`Bier, Spritzer, Eistee, Spezi`, 1 bis 12 Produkte, je höchstens 30 Zeichen); **verfügbar nur mit Schalter an UND mindestens einem Empfänger** (`notificationFormState`: `available`/`norecipient`/`off`).
  - Kern `submit-notification-core.ts` (geteilt von `submitNotificationForKiosk` mit Link und gemeinsamem Limit (derselbe Zähler wie die Berichte) und der App-Aktion `submitNotification` mit Sitzung): Reihenfolge Formular verfügbar, Absender aktives Mitglied der Feuerwehr, Felder (`notification-input.ts`, rein), Versand (`notify-notification-form.ts`); `AKUT:`-Vorsatz im Betreff, "Akut: Ja/Nein/nicht angegeben".
  - Oberfläche: `NotificationFormView` mit Tablet-/Handy-Layout, Pflichtfeldzähler (`notification-form-fields.ts`); Kiosk-Phase `notify` (Elementstruktur layoutunabhängig), App-Seite `/meine-feuerwehr/meldungen/[formular]` (404 bei nicht verfügbar), zweiter Abschnitt "Meldungen" im `ReportTypeSheet`.
  - Verwaltung: Abschnitt "Meldungen" in der Karte "Berichte" (`notification-form-row.tsx`, Produktliste `drink-products-form.tsx`, Aktionen `setNotificationFormEnabled`/`setNotificationFormRecipients`/`setDrinkProducts` in `admin/heimatfeuerwehr/actions.ts`); `ReportRecipientsForm` bekommt die gebundene Aktion und `idSuffix` als Props.
  - Kachelzustände am iPad: aktiv / "Kein Empfänger hinterlegt" / "Nicht aktiviert" / "Bald verfügbar" (nur Einsatzbericht).
  - Bekannte Folge von "nur E-Mail": kein Verlauf und kein Nachweis über abgeschickte Meldungen außer den Mails.
- Im Abschnitt des Kiosks überall, wo steht, dass Getränkeautomat/Schadensmeldung "Platzhalter ohne Funktion" sind, den Satz auf den neuen Stand korrigieren.

- [ ] **Step 2: Gesamtprüfung**

```bash
npx tsc --noEmit
npm test
npm run test:db
npm run build
```

Expected: alle grün (Anzahlen im Bericht festhalten). Schlägt `tsc` nur wegen veralteter `.next/types` nach dem Branchwechsel fehl, `npm run build` einmal laufen lassen und `tsc` danach bewerten. Keinen Dev-Server starten; die Browser-Prüfung (Startbildschirm bei 1180×820 mit den neuen Kachelzuständen, 404 bei nicht verfügbarem Formular) macht der Controller anschließend selbst.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/meine-feuerwehr/CLAUDE.md"
git commit -m "docs: Meldeformulare Getränkeautomat und Schadensmeldung dokumentiert

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Spec-Abdeckung

| Spec-Abschnitt | Aufgabe |
|---|---|
| 1 Daten (`NotificationFormSetting`, Produktliste, Bibliothek, Kennungen) | 1 |
| 2 Abgabe (Kern, Validierung, Mail, Kiosk-Einstieg mit Limit, App-Einstieg) | 2, 3 |
| 3 Formulare (gemeinsame Komponente, Pflichtfelder, Layouts) | 4 |
| 4 iPad (Kachelzustände, Ablauf, Seitendaten) | 7 |
| 5 App (Blatt "Meldungen", Meldeseite) | 6 |
| 6 Verwaltung (Schalter, Empfänger, Produktliste, Dialog, Aktionen) | 5 |
| 7 Tests und Prüfung | je Aufgabe, 8 |
| 8 Rollout (additive Migration, Standard "nicht verfügbar" ohne Empfänger) | Hinweise im Plan; Rollout selbst gibt der Betreiber-Dialog |
