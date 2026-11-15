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
