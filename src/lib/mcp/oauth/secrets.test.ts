import { describe, expect, it } from 'vitest';
import { hashSecret, isValidCodeChallenge, randomSecret, verifyPkceS256 } from './secrets';

describe('randomSecret / hashSecret', () => {
  it('erzeugt lange, verschiedene, URL-sichere Werte', () => {
    const a = randomSecret();
    const b = randomSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hasht deterministisch zu 64 Hex-Zeichen', () => {
    expect(hashSecret('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('verifyPkceS256', () => {
  // Beispiel aus RFC 7636 Anhang B.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('akzeptiert das RFC-Beispiel', () => {
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it('lehnt einen falschen Verifier ab', () => {
    expect(verifyPkceS256('x'.repeat(43), challenge)).toBe(false);
  });

  it('lehnt zu kurze, zu lange und ungültige Verifier ab', () => {
    expect(verifyPkceS256('kurz', challenge)).toBe(false);
    expect(verifyPkceS256('a'.repeat(129), challenge)).toBe(false);
    expect(verifyPkceS256('a'.repeat(42) + '!', challenge)).toBe(false);
  });
});

describe('isValidCodeChallenge', () => {
  it('verlangt genau 43 Zeichen base64url (SHA-256)', () => {
    expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true);
    expect(isValidCodeChallenge('zu-kurz')).toBe(false);
    expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-c=')).toBe(false);
  });
});
