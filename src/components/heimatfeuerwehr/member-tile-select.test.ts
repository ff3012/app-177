import { describe, expect, it } from 'vitest';
import { filterSelectableMembers } from './member-tile-select';

const members = [
  { id: '1', firstName: 'Anna', lastName: 'Huber' },
  { id: '2', firstName: 'Bernd', lastName: 'Bauer' },
  { id: '3', firstName: 'Clara', lastName: 'Bauer' },
];

describe('filterSelectableMembers', () => {
  it('schließt bereits eingetragene Mitglieder aus', () => {
    expect(filterSelectableMembers(members, ['2'], '').map((m) => m.id)).toEqual(['1', '3']);
  });

  it('sucht ohne Beachtung der Groß-/Kleinschreibung in "Nachname Vorname"', () => {
    expect(filterSelectableMembers(members, [], 'bauer c').map((m) => m.id)).toEqual(['3']);
    expect(filterSelectableMembers(members, [], '  HUBER ').map((m) => m.id)).toEqual(['1']);
  });

  it('liefert bei leerer Suche alle nicht ausgeschlossenen', () => {
    expect(filterSelectableMembers(members, [], '')).toHaveLength(3);
  });
});
