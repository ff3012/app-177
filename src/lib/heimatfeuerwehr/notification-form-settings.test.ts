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
