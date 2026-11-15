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
