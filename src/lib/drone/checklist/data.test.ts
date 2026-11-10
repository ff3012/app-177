import { describe, expect, it } from 'vitest';
import { OPERATION_CHECK_KEYS, PREFLIGHT_CHECK_KEYS, checklistDataSchema } from './data';

describe('checklistDataSchema (Entwurf: alles optional)', () => {
  it('akzeptiert ein leeres Formular', () => {
    expect(checklistDataSchema.safeParse({}).success).toBe(true);
  });

  it('akzeptiert einen teilweise ausgefüllten Stand', () => {
    const result = checklistDataSchema.safeParse({
      art: 'Training',
      drohnen: ['d1', 'd2'],
      grundlage: 'open',
      openKat: 'A1',
      hoehe: 60,
      checks: { p_gesund: true, p_fs: false },
      fluege: [{ akku: '1', uVor: '100', uNach: '60', start: '10:00', landung: '10:20', zw: true }],
    });
    expect(result.success).toBe(true);
  });

  it('lehnt unbekannte Enum-Werte ab', () => {
    expect(checklistDataSchema.safeParse({ art: 'Wettkampf' }).success).toBe(false);
    expect(checklistDataSchema.safeParse({ grundlage: 'foo' }).success).toBe(false);
    expect(checklistDataSchema.safeParse({ absperrung: '7' }).success).toBe(false);
  });

  it('lehnt eine Zwischenflugkontrolle ab, die kein Haken (boolean) ist', () => {
    expect(checklistDataSchema.safeParse({ fluege: [{ zw: 'ja' }] }).success).toBe(false);
  });

  it('lehnt eine Flughöhe ab, die keine Zahl ist', () => {
    expect(checklistDataSchema.safeParse({ hoehe: '60' }).success).toBe(false);
  });

  it('entfernt unbekannte Schlüssel statt sie zu speichern', () => {
    const result = checklistDataSchema.parse({ art: 'Einsatz', unbekannt: 'x' });
    expect(result).toEqual({ art: 'Einsatz' });
  });
});

describe('Check-Schlüssel', () => {
  it('hat 11 Punkte für Nr. 15–16 und 10 für Nr. 17', () => {
    expect(PREFLIGHT_CHECK_KEYS).toHaveLength(11);
    expect(OPERATION_CHECK_KEYS).toHaveLength(10);
  });

  it('nutzt die Schlüssel exakt wie der Prototyp', () => {
    expect(PREFLIGHT_CHECK_KEYS).toEqual([
      'p_gesund', 'p_fs', 'p_drohne', 'p_licht', 'p_verb', 'p_kamera',
      'p_modus', 'p_rthpos', 'p_rthh', 'p_akku30', 'p_akku20',
    ]);
    expect(OPERATION_CHECK_KEYS).toEqual([
      'b_start', 'b_schweb', 'b_akku', 'b_r360', 'b_l360', 'b_gr', 'b_gl', 'b_vor', 'b_rueck', 'b_land',
    ]);
  });
});
