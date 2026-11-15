import { describe, expect, it } from 'vitest';
import { distinctRecentKinds } from './recent-activity-kinds';

describe('distinctRecentKinds', () => {
  it('liefert die ersten drei verschiedenen Codes, neueste Berichte zuerst', () => {
    const reports = [
      { activityKinds: ['A'] },
      { activityKinds: ['B', 'A'] },
      { activityKinds: ['C'] },
      { activityKinds: ['D'] },
    ];
    expect(distinctRecentKinds(reports)).toEqual(['A', 'B', 'C']);
  });

  it('liefert weniger, wenn es weniger gibt', () => {
    expect(distinctRecentKinds([{ activityKinds: ['A'] }, { activityKinds: [] }])).toEqual(['A']);
    expect(distinctRecentKinds([])).toEqual([]);
  });

  it('beachtet ein anderes Limit', () => {
    expect(distinctRecentKinds([{ activityKinds: ['A', 'B', 'C'] }], 2)).toEqual(['A', 'B']);
  });
});
