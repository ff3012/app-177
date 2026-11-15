import { describe, expect, it } from 'vitest';
import { getKioskTiles, KIOSK_TILE_HINT } from './kiosk-tiles';

describe('getKioskTiles', () => {
  it('liefert die fünf Kacheln in fester Reihenfolge', () => {
    expect(getKioskTiles(['ACTIVITY', 'EXERCISE']).map((tile) => tile.title)).toEqual([
      'Tätigkeitsbericht',
      'Übungsbericht',
      'Einsatzbericht',
      'Getränkeautomat',
      'Schadensmeldung',
    ]);
  });

  it('Tätigkeits- und Übungsbericht sind aktiv, wenn eingeschaltet; die übrigen immer "Bald verfügbar"', () => {
    const states = Object.fromEntries(getKioskTiles(['ACTIVITY', 'EXERCISE']).map((tile) => [tile.key, tile.state]));
    expect(states).toEqual({ ACTIVITY: 'active', EXERCISE: 'active', INCIDENT: 'soon', DRINKS: 'soon', DAMAGE: 'soon' });
  });

  it('eine abgeschaltete freigeschaltete Art ist "off"', () => {
    const states = Object.fromEntries(getKioskTiles(['ACTIVITY']).map((tile) => [tile.key, tile.state]));
    expect(states.ACTIVITY).toBe('active');
    expect(states.EXERCISE).toBe('off');
  });

  it('ohne eingeschaltete Art ist keine Kachel aktiv', () => {
    expect(getKioskTiles([]).some((tile) => tile.state === 'active')).toBe(false);
  });

  it('trägt die Berichtsart der Berichts-Kacheln und null bei den übrigen', () => {
    const types = Object.fromEntries(getKioskTiles(['ACTIVITY']).map((tile) => [tile.key, tile.type]));
    expect(types).toEqual({ ACTIVITY: 'ACTIVITY', EXERCISE: 'EXERCISE', INCIDENT: 'INCIDENT', DRINKS: null, DAMAGE: null });
  });

  it('hat feste Hinweistexte', () => {
    expect(KIOSK_TILE_HINT).toEqual({ off: 'Nicht aktiviert', soon: 'Bald verfügbar' });
  });
});
