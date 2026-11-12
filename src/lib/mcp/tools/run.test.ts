import { describe, expect, it, vi } from 'vitest';
import { denied, invalid } from './context';
import { defineTool } from './define';
import { principalFixture, sessionUserFixture } from './test-support';
import { RATE_LIMIT_PER_MINUTE, runTool } from './run';

const readTool = (handler: () => Promise<{ data: unknown; audit?: { summary: string; targetUserId?: string } }>) =>
  defineTool({ name: 'demo_read', description: 'x', access: 'READ', inputSchema: {}, handler });
const writeTool = (handler: () => Promise<{ data: unknown; audit?: { summary: string; targetUserId?: string } }>) =>
  defineTool({ name: 'demo_write', description: 'x', access: 'WRITE', inputSchema: {}, handler });

function setup() {
  const audit = vi.fn(async () => undefined);
  const principal = principalFixture(sessionUserFixture({ id: 'u1' }), 'WRITE');
  return { audit, principal };
}

describe('runTool', () => {
  it('liefert die Daten als JSON-Text und schreibt für reine Lesewerkzeuge kein Protokoll', async () => {
    const { audit, principal } = setup();
    const result = await runTool(principal, readTool(async () => ({ data: { a: 1 } })), {}, { audit });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ a: 1 });
    expect(audit).not.toHaveBeenCalled();
  });

  it('protokolliert erfolgreiche Schreibaktionen (OK) mit Ziel und Zusammenfassung', async () => {
    const { audit, principal } = setup();
    await runTool(principal, writeTool(async () => ({ data: {}, audit: { targetUserId: 't1', summary: 'Benutzer angelegt' } })), {}, { audit });
    expect(audit).toHaveBeenCalledWith({
      userId: 'u1',
      clientId: 'mcp_test',
      tool: 'demo_write',
      outcome: 'OK',
      targetUserId: 't1',
      summary: 'Benutzer angelegt',
    });
  });

  it('gibt verweigerte Zugriffe als Fehler zurück und protokolliert DENIED', async () => {
    const { audit, principal } = setup();
    const result = await runTool(principal, readTool(async () => { throw denied('Keine Berechtigung.'); }), {}, { audit });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Keine Berechtigung.');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'DENIED', tool: 'demo_read', summary: 'Keine Berechtigung.' }));
  });

  it('meldet ungültige Eingaben: bei Lesewerkzeugen ohne, bei Schreibwerkzeugen mit Protokoll (ERROR)', async () => {
    const { audit, principal } = setup();
    const readResult = await runTool(principal, readTool(async () => { throw invalid('Unbekannte Feuerwehr.'); }), {}, { audit });
    expect(readResult).toMatchObject({ isError: true, content: [{ text: 'Unbekannte Feuerwehr.' }] });
    expect(audit).not.toHaveBeenCalled();
    await runTool(principal, writeTool(async () => { throw invalid('E-Mail existiert bereits.'); }), {}, { audit });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ERROR', tool: 'demo_write' }));
  });

  it('gibt bei unerwarteten Fehlern nur eine allgemeine Meldung zurück (kein Stacktrace) und protokolliert ERROR', async () => {
    const { audit, principal } = setup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('Invalid prisma.user.findMany() where email "max@example.org" host 10.0.0.5');
    error.name = 'PrismaClientValidationError';
    const result = await runTool(principal, readTool(async () => { throw error; }), {}, { audit });
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'Die Anfrage konnte nicht verarbeitet werden. Bitte später erneut versuchen.' }] });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ERROR', summary: 'Unerwarteter Fehler' }));
    expect(logged).toContain('PrismaClientValidationError');
    expect(logged).not.toContain('max@example.org');
    expect(logged).not.toContain('10.0.0.5');
  });

  it('verweigert ein Werkzeug oberhalb der MCP-Stufe (DENIED, Handler wird nicht aufgerufen)', async () => {
    const audit = vi.fn(async () => undefined);
    const handler = vi.fn(async () => ({ data: 1 }));
    const principal = principalFixture(sessionUserFixture({ id: 'u1' }), 'READ');
    const result = await runTool(principal, writeTool(handler), {}, { audit });
    expect(result.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'DENIED', tool: 'demo_write', summary: 'Unzureichende MCP-Stufe' }));
  });

  it('begrenzt die Aufrufe je Token pro Minute', async () => {
    const { audit, principal } = setup();
    const tool = readTool(async () => ({ data: 1 }));
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      expect((await runTool(principal, tool, {}, { audit })).isError).toBeUndefined();
    }
    const blocked = await runTool(principal, tool, {}, { audit });
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toMatch(/Zu viele Anfragen/);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'DENIED', summary: expect.stringContaining('Mengenbegrenzung') }));
  });

  it('protokolliert bei Dauerfeuer nur die erste Mengenbegrenzung je Token und Fenster', async () => {
    const { audit, principal } = setup();
    const tool = readTool(async () => ({ data: 1 }));
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) await runTool(principal, tool, {}, { audit });
    for (let i = 0; i < 25; i++) expect((await runTool(principal, tool, {}, { audit })).isError).toBe(true);
    expect(audit).toHaveBeenCalledTimes(1);
  });
});
