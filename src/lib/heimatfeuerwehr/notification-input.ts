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
