import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeErrorSummary } from './safe-log';

afterEach(() => vi.restoreAllMocks());

describe('safeErrorSummary', () => {
  it('lässt die Meldung eines Prisma-Fehlers (mit E-Mail und IP) nie in die Ausgabe gelangen', () => {
    const error = new Error('Invalid prisma.user.findMany() invocation: where: { email: "max@example.org" } host 10.0.0.5');
    error.name = 'PrismaClientValidationError';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    console.error('[mcp] Werkzeugfehler', 'demo', safeErrorSummary(error));
    const output = JSON.stringify(spy.mock.calls);
    expect(output).toContain('PrismaClientValidationError');
    expect(output).not.toContain('max@example.org');
    expect(output).not.toContain('10.0.0.5');
  });

  it('nimmt bei Prisma-Fehlern den Code auf', () => {
    const error = Object.assign(new Error('secret'), { name: 'PrismaClientKnownRequestError', code: 'P2002' });
    expect(safeErrorSummary(error)).toBe('PrismaClientKnownRequestError code=P2002');
  });

  it('behält bei gewöhnlichen Fehlern die auf 200 Zeichen gekürzte Meldung', () => {
    expect(safeErrorSummary(new Error('kaputt'))).toBe('Error: kaputt');
    expect(safeErrorSummary(new TypeError('x'.repeat(500)))).toBe(`TypeError: ${'x'.repeat(200)}`);
  });

  it('meldet Nicht-Error-Werte allgemein', () => {
    expect(safeErrorSummary('geheim')).toBe('unbekannter Fehler');
    expect(safeErrorSummary(null)).toBe('unbekannter Fehler');
    expect(safeErrorSummary({ message: 'x' })).toBe('unbekannter Fehler');
  });
});
