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
