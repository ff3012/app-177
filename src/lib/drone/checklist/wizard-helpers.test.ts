import { describe, expect, it } from 'vitest';
import { checkSummary } from './rules';
import { filterMembers } from './members-search';
import { isTextEntry } from './viewport';

const members = [
  { id: '1', name: 'Lukas Pichler' },
  { id: '2', name: 'Anna Müller' },
  { id: '3', name: 'Max Muster' },
  { id: '4', name: 'Éva Fürst' },
];

describe('filterMembers', () => {
  it('liefert ohne Suchtext alle Mitglieder', () => {
    expect(filterMembers(members, '', [])).toHaveLength(4);
    expect(filterMembers(members, '   ', [])).toHaveLength(4);
  });

  it('findet Teile des Namens, ohne Rücksicht auf Groß-/Kleinschreibung', () => {
    expect(filterMembers(members, 'PICH', []).map((m) => m.id)).toEqual(['1']);
  });

  it('findet Vor- und Nachname in beliebiger Reihenfolge', () => {
    expect(filterMembers(members, 'pichler lukas', []).map((m) => m.id)).toEqual(['1']);
    expect(filterMembers(members, 'muster m', []).map((m) => m.id)).toEqual(['3']);
  });

  it('ignoriert Umlaute und Akzente', () => {
    expect(filterMembers(members, 'muller', []).map((m) => m.id)).toEqual(['2']);
    expect(filterMembers(members, 'fuerst', []).map((m) => m.id)).toEqual([]);
    expect(filterMembers(members, 'furst eva', []).map((m) => m.id)).toEqual(['4']);
  });

  it('lässt ausgeschlossene Mitglieder weg (bereits gewählt, Pilot)', () => {
    expect(filterMembers(members, '', ['1', '2']).map((m) => m.id)).toEqual(['3', '4']);
    expect(filterMembers(members, 'pichler', ['1'])).toEqual([]);
  });

  it('liefert nichts, wenn kein Name passt', () => {
    expect(filterMembers(members, 'zzz', [])).toEqual([]);
  });
});

describe('isTextEntry', () => {
  it('erkennt Felder, bei denen die Tastatur oder ein Auswahlrad erscheint', () => {
    expect(isTextEntry('TEXTAREA')).toBe(true);
    expect(isTextEntry('INPUT', 'text')).toBe(true);
    expect(isTextEntry('INPUT', 'tel')).toBe(true);
    expect(isTextEntry('INPUT', 'date')).toBe(true);
    expect(isTextEntry('INPUT', 'time')).toBe(true);
    expect(isTextEntry('INPUT')).toBe(true);
  });

  it('ignoriert Knöpfe, Kästchen, Auswahlfelder und andere Elemente', () => {
    expect(isTextEntry('INPUT', 'checkbox')).toBe(false);
    expect(isTextEntry('INPUT', 'radio')).toBe(false);
    expect(isTextEntry('INPUT', 'button')).toBe(false);
    expect(isTextEntry('BUTTON')).toBe(false);
    expect(isTextEntry('SELECT')).toBe(false);
    expect(isTextEntry('DIV')).toBe(false);
  });
});

describe('checkSummary', () => {
  it('zählt offene Punkte je Kontrolle und ob ein Kommentar vorliegt', () => {
    const summary = checkSummary({
      checks: { p_gesund: true, p_fs: true, b_start: true },
      kommentar15: ' Akku schwach ',
    });
    expect(summary.preflight).toEqual({ open: 9, total: 11, commented: true });
    expect(summary.operation).toEqual({ open: 9, total: 10, commented: false });
  });

  it('meldet bei vollständig abgehakten Kontrollen 0 offen', () => {
    const all = Object.fromEntries(
      [
        ...['p_gesund', 'p_fs', 'p_drohne', 'p_licht', 'p_verb', 'p_kamera', 'p_modus', 'p_rthpos', 'p_rthh', 'p_akku30', 'p_akku20'],
        ...['b_start', 'b_schweb', 'b_akku', 'b_r360', 'b_l360', 'b_gr', 'b_gl', 'b_vor', 'b_rueck', 'b_land'],
      ].map((k) => [k, true]),
    );
    const summary = checkSummary({ checks: all });
    expect(summary.preflight.open).toBe(0);
    expect(summary.operation.open).toBe(0);
  });
});
