import { describe, expect, it } from 'vitest';
import { checkRateLimit, rateLimitKeyCount } from './rate-limit';

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

describe('Speicherbegrenzung', () => {
  it('räumt abgelaufene Einmal-Schlüssel auf, sobald die Map über der Schwelle liegt', () => {
    const t0 = 20_000_000;
    for (let i = 0; i < 10_001; i++) checkRateLimit(`sweep-a-${i}`, 1, 10_000, t0);
    expect(rateLimitKeyCount()).toBeGreaterThanOrEqual(10_001);
    // Ein späterer Aufruf (Fenster aller alten Schlüssel längst abgelaufen) stößt die Bereinigung an.
    checkRateLimit('sweep-a-trigger', 1, 10_000, t0 + 120_000);
    expect(rateLimitKeyCount()).toBeLessThan(100);
  });

  it('behält bei der Bereinigung Schlüssel mit noch laufendem (eigenem) Fenster', () => {
    const t0 = 30_000_000;
    // Langes Fenster: bleibt bei t0 + 120 s noch aktiv und muss weiter sperren.
    checkRateLimit('sweep-b-long', 1, 3_600_000, t0);
    for (let i = 0; i < 10_001; i++) checkRateLimit(`sweep-b-${i}`, 1, 10_000, t0);
    checkRateLimit('sweep-b-trigger', 1, 10_000, t0 + 120_000);
    expect(checkRateLimit('sweep-b-long', 1, 3_600_000, t0 + 120_001).allowed).toBe(false);
  });

  it('bereinigt nicht, solange die Map unter der Schwelle bleibt', () => {
    const t0 = 40_000_000;
    const before = rateLimitKeyCount();
    checkRateLimit('sweep-c-1', 1, 1_000, t0);
    checkRateLimit('sweep-c-2', 1, 1_000, t0 + 500_000);
    expect(rateLimitKeyCount()).toBe(before + 2);
  });
});
