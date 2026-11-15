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
