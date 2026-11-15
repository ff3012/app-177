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
