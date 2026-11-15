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
    expect(KIOSK_TILE_HINT).toEqual({ off: 'Nicht aktiviert', soon: 'Bald verfügbar', norecipient: 'Kein Empfänger hinterlegt' });
  });
});

describe('getKioskTiles: Meldeformulare', () => {
  const both = ['ACTIVITY', 'EXERCISE'];

  it('Getränkeautomat und Schadensmeldung sind aktiv, wenn das Formular verfügbar ist', () => {
    const states = Object.fromEntries(getKioskTiles(both, { DRINKS: 'available', DAMAGE: 'available' }).map((tile) => [tile.key, tile.state]));
    expect(states.DRINKS).toBe('active');
    expect(states.DAMAGE).toBe('active');
    expect(states.INCIDENT).toBe('soon');
  });

  it('ein eingeschaltetes Formular ohne Empfänger ist "norecipient", ein abgeschaltetes "off"', () => {
    const states = Object.fromEntries(getKioskTiles(both, { DRINKS: 'norecipient', DAMAGE: 'off' }).map((tile) => [tile.key, tile.state]));
    expect(states.DRINKS).toBe('norecipient');
    expect(states.DAMAGE).toBe('off');
  });

  it('ohne Angabe zu den Formularen bleiben sie "Bald verfügbar" (soon)', () => {
    const states = Object.fromEntries(getKioskTiles(both).map((tile) => [tile.key, tile.state]));
    expect(states.DRINKS).toBe('soon');
    expect(states.DAMAGE).toBe('soon');
  });

  it('trägt das Formular der Meldekacheln und null bei den Berichtskacheln', () => {
    const forms = Object.fromEntries(getKioskTiles(both).map((tile) => [tile.key, tile.form]));
    expect(forms).toEqual({ ACTIVITY: null, EXERCISE: null, INCIDENT: null, DRINKS: 'DRINKS', DAMAGE: 'DAMAGE' });
  });

  it('hat den Hinweistext für fehlende Empfänger', () => {
    expect(KIOSK_TILE_HINT.norecipient).toBe('Kein Empfänger hinterlegt');
  });
});
