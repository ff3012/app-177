import crypto from 'crypto';

/** Zufälliger, URL-sicherer Wert (Standard 32 Byte = 43 Zeichen). */
export function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** SHA-256 als Hex - so werden Codes und Token gespeichert (wie PasswordToken). */
export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/** Eine S256-Code-Challenge ist base64url(SHA-256) = genau 43 Zeichen. */
export function isValidCodeChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** RFC 7636: Verifier 43-128 Zeichen aus unreserved; Vergleich zeitkonstant. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(crypto.createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}
