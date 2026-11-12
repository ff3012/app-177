import { describe, expect, it } from 'vitest';
import { combineStatus } from './atemschutz';

describe('combineStatus', () => {
  it('abgelaufen schlägt alles', () => {
    expect(combineStatus('abgelaufen', 'aktiv')).toBe('abgelaufen');
    expect(combineStatus('keine_angabe', 'abgelaufen')).toBe('abgelaufen');
    expect(combineStatus('laeuft_bald_ab', 'abgelaufen')).toBe('abgelaufen');
  });

  it('dann läuft bald ab', () => {
    expect(combineStatus('aktiv', 'laeuft_bald_ab')).toBe('laeuft_bald_ab');
    expect(combineStatus('keine_angabe', 'laeuft_bald_ab')).toBe('laeuft_bald_ab');
  });

  it('keine Angabe nur, wenn beides fehlt; ein erfasster aktiver Wert genügt für aktiv', () => {
    expect(combineStatus('keine_angabe', 'keine_angabe')).toBe('keine_angabe');
    expect(combineStatus('aktiv', 'aktiv')).toBe('aktiv');
    expect(combineStatus('aktiv', 'keine_angabe')).toBe('aktiv');
  });
});
