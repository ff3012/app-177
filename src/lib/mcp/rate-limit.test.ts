import { describe, expect, it } from 'vitest';
import { checkRateLimit } from './rate-limit';

describe('checkRateLimit', () => {
  it('lässt bis zum Limit durch und sperrt danach, mit Wartezeit', () => {
    const key = `t-${Math.random()}`;
    const t0 = 1_000_000;
    expect(checkRateLimit(key, 2, 60_000, t0).allowed).toBe(true);
    expect(checkRateLimit(key, 2, 60_000, t0 + 1_000).allowed).toBe(true);
    const blocked = checkRateLimit(key, 2, 60_000, t0 + 2_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(58);
  });

  it('gibt nach Ablauf des Fensters wieder frei', () => {
    const key = `t-${Math.random()}`;
    const t0 = 5_000_000;
    checkRateLimit(key, 1, 10_000, t0);
    expect(checkRateLimit(key, 1, 10_000, t0 + 5_000).allowed).toBe(false);
    expect(checkRateLimit(key, 1, 10_000, t0 + 10_001).allowed).toBe(true);
  });

  it('trennt verschiedene Schlüssel', () => {
    const t0 = 9_000_000;
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    checkRateLimit(a, 1, 60_000, t0);
    expect(checkRateLimit(a, 1, 60_000, t0 + 1).allowed).toBe(false);
    expect(checkRateLimit(b, 1, 60_000, t0 + 1).allowed).toBe(true);
  });
});
