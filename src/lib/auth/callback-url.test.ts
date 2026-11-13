import { describe, expect, it } from 'vitest';
import { buildLoginCallbackUrl } from './callback-url';

describe('buildLoginCallbackUrl', () => {
  it('erhält für /oauth/authorize die Query (sonst gingen die OAuth-Parameter beim Login verloren)', () => {
    expect(buildLoginCallbackUrl('/oauth/authorize', '?client_id=a&state=b')).toBe('/oauth/authorize?client_id=a&state=b');
  });

  it('lässt alle anderen Pfade unverändert beim reinen Pfad', () => {
    expect(buildLoginCallbackUrl('/kalender', '?x=1')).toBe('/kalender');
    expect(buildLoginCallbackUrl('/oauth/authorize/andere', '?x=1')).toBe('/oauth/authorize/andere');
  });
});
