import { describe, expect, it } from 'vitest';
import { OPERATION_CHECK_KEYS, PREFLIGHT_CHECK_KEYS, type ChecklistData } from './data';
import { MAX_FLIGHT_HEIGHT, missingForSubmit, openOperationCount, openPreflightCount, stepGate } from './rules';

const allChecked = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, true]));

/** Ein vollständig und gültig ausgefülltes Formular, von dem die einzelnen Tests gezielt abweichen. */
function completeData(): ChecklistData {
  return {
    art: 'Einsatz',
    drohnen: ['drone-1'],
    grundlage: 'open',
    openKat: 'A1',
    hoehe: 60,
    pilot: 'user-1',
    checks: { ...allChecked(PREFLIGHT_CHECK_KEYS), ...allChecked(OPERATION_CHECK_KEYS) },
    bestaetigt: true,
  };
}

describe('offene Punkte zählen', () => {
  it('zählt ohne Angaben alle Punkte als offen', () => {
    expect(openPreflightCount({})).toBe(11);
    expect(openOperationCount({})).toBe(10);
  });

  it('zählt nur nicht abgehakte Punkte', () => {
    const data: ChecklistData = { checks: { p_gesund: true, p_fs: false, b_start: true } };
    expect(openPreflightCount(data)).toBe(10);
    expect(openOperationCount(data)).toBe(9);
  });

  it('ist 0, wenn alle Punkte abgehakt sind', () => {
    const data = completeData();
    expect(openPreflightCount(data)).toBe(0);
    expect(openOperationCount(data)).toBe(0);
  });
});

describe('stepGate (Sperre Nr. 15-17)', () => {
  it('sperrt Schritt 4, solange Punkte offen sind und der Kommentar fehlt', () => {
    expect(stepGate(4, {})).toBe('Alle Punkte Nr. 15–16 abhaken oder Kommentar eintragen');
  });

  it('sperrt Schritt 5 mit dem Text für Nr. 17', () => {
    expect(stepGate(5, {})).toBe('Alle Punkte Nr. 17 abhaken oder Kommentar eintragen');
  });

  it('zählt einen Kommentar nur aus Leerzeichen nicht', () => {
    expect(stepGate(4, { kommentar15: '   ' })).not.toBeNull();
    expect(stepGate(5, { kommentar17: '\n' })).not.toBeNull();
  });

  it('gibt frei, sobald ein Kommentar vorhanden ist', () => {
    expect(stepGate(4, { kommentar15: 'Akku 2 defekt' })).toBeNull();
    expect(stepGate(5, { kommentar17: 'Gimbal ruckelt' })).toBeNull();
  });

  it('gibt frei, wenn alle Punkte abgehakt sind, auch ohne Kommentar', () => {
    expect(stepGate(4, completeData())).toBeNull();
    expect(stepGate(5, completeData())).toBeNull();
  });

  it('prüft jeden Schritt nur gegen seine eigenen Punkte', () => {
    const data: ChecklistData = { checks: allChecked(PREFLIGHT_CHECK_KEYS) };
    expect(stepGate(4, data)).toBeNull();
    expect(stepGate(5, data)).not.toBeNull();
  });

  it('kennt für alle übrigen Schritte keine Sperre', () => {
    for (const step of [0, 1, 2, 3, 6, 7, 8]) expect(stepGate(step, {})).toBeNull();
  });
});

describe('missingForSubmit', () => {
  it('meldet nichts bei einem vollständigen Formular', () => {
    expect(missingForSubmit(completeData())).toEqual([]);
  });

  it('meldet bei einem leeren Formular jeden Pflichtpunkt mit seinem Schritt', () => {
    const missing = missingForSubmit({});
    expect(missing.map((m) => m.step)).toEqual([0, 0, 1, 1, 2, 4, 5, 8]);
    // Texte wie im Prototyp (missingList), die Schritte springen zum jeweiligen Wizard-Schritt.
    expect(missing.map((m) => m.text)).toEqual([
      'Art des Fluges',
      'Eingesetztes Fluggerät',
      'Grundlage des Fluges',
      'Geplante Flughöhe',
      'Pilot',
      'Vorflugkontrolle Nr. 15–16: offene Punkte ohne Kommentar',
      'Betriebskontrolle Nr. 17: offene Punkte ohne Kommentar',
      'Bestätigung des Piloten',
    ]);
  });

  it('verlangt mindestens eine Drohne', () => {
    expect(missingForSubmit({ ...completeData(), drohnen: [] }).map((m) => m.step)).toEqual([0]);
  });

  it('akzeptiert Flughöhen bis einschließlich 120 m', () => {
    expect(MAX_FLIGHT_HEIGHT).toBe(120);
    expect(missingForSubmit({ ...completeData(), hoehe: 120 })).toEqual([]);
  });

  it('meldet fehlende, 0 m und negative Höhen als "Geplante Flughöhe"', () => {
    for (const hoehe of [undefined, 0, -5]) {
      expect(missingForSubmit({ ...completeData(), hoehe })).toEqual([{ text: 'Geplante Flughöhe', step: 1 }]);
    }
  });

  it('meldet Höhen über 120 m gesondert', () => {
    for (const hoehe of [120.1, 200]) {
      expect(missingForSubmit({ ...completeData(), hoehe })).toEqual([{ text: 'Flughöhe über 120 m', step: 1 }]);
    }
  });

  it('lässt offene Punkte mit Kommentar zu', () => {
    const data: ChecklistData = { ...completeData(), checks: {}, kommentar15: 'x', kommentar17: 'y' };
    expect(missingForSubmit(data)).toEqual([]);
  });
});
