import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * A real bcrypt hash (same cost factor) of a fixed, unrelated value - computed once and cached.
 * Used so login always pays the same bcrypt.compare cost whether or not the submitted email
 * matches a real account, closing a timing side-channel that would otherwise let an attacker
 * infer valid emails from response time (no user found -> no compare -> faster response).
 */
export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('dummy-password-for-constant-time-comparison-only');
  }
  return dummyHashPromise;
}
