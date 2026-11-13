import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Die Willkommens-Mail darf in Tests nie wirklich versendet werden.
const sendActivationEmail = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
vi.mock('@/lib/email/templates', () => ({ sendActivationEmail }));

import { prisma } from '@/lib/db/prisma';
import { recordMcpAudit } from '../audit';
import { principalFixture, sessionUserFixture } from './test-support';
import { CREATE_USER_PER_HOUR, createUserTool } from './create-user';
import { runTool } from './run';

const RUN = `mcp-cu-${Date.now()}`;
let orgA: { id: string; name: string; shortName: string | null; parentId: string | null };
let orgB: { id: string };
let group: { id: string };
let actorId: string;
let limitActorId: string;

const email = (key: string) => `${RUN}-${key}@example.local`;
const baseArgs = (key: string, extra: Record<string, unknown> = {}) => ({
  firstName: 'Neu',
  lastName: RUN,
  email: email(key),
  stbNr: '4711',
  homeOrganizationId: orgA.id,
  ...extra,
});
const principal = (overrides = {}, access: 'READ' | 'WRITE' = 'WRITE') =>
  principalFixture(sessionUserFixture({ id: actorId, email: email('actor'), homeOrganizationId: orgA.id, feuerwehrAdminOrgIds: [orgA.id], ...overrides }), access);
const bezirksadmin = () => principal({ feuerwehrAdminOrgIds: [], isBezirksAdmin: true });
const run = (key: string, extra: Record<string, unknown> = {}, p = principal()) => createUserTool.handler({ principal: p }, baseArgs(key, extra));
const created = (key: string) => prisma.user.findUnique({ where: { email: email(key) } });

beforeAll(async () => {
  const orgs = await prisma.organization.findMany({ where: { type: 'FEUERWEHR', isActive: true, parentId: { not: null } }, orderBy: { name: 'asc' } });
  if (orgs.length < 2) throw new Error('Seed fehlt: npm run db:seed');
  orgA = orgs[0];
  orgB = orgs.find((o) => o.parentId !== orgA.parentId)!;
  if (!orgB) throw new Error('Seed fehlt: npm run db:seed (zwei Abschnitte erwartet)');
  group = await prisma.droneGroup.findFirstOrThrow({ where: { name: 'AFKDO Purkersdorf' } });
  const mk = (key: string) =>
    prisma.user.create({ data: { email: email(key), passwordHash: 'x', firstName: 'Akteur', lastName: RUN, homeOrganizationId: orgA.id, mcpAccess: 'WRITE' } });
  actorId = (await mk('actor')).id;
  limitActorId = (await mk('limitactor')).id;
});

beforeEach(() => {
  sendActivationEmail.mockClear();
  sendActivationEmail.mockResolvedValue(undefined);
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { startsWith: RUN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.mcpAuditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { targetUserId: { in: ids } }] } });
    await prisma.passwordToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.drohnengruppeMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe('create_user', () => {
  it('verlangt in der Beschreibung ausdrückliche Bestätigung durch den Benutzer', () => {
    expect(createUserTool.description).toContain('ausdrücklich');
    expect(createUserTool.description).toContain('Heimatfeuerwehr und Rollen');
  });

  it('lehnt eine unbekannte Feuerwehr unter "Admin für" ab (auch als Bezirksadmin) und legt nichts an', async () => {
    await expect(run('adminunbekannt', { adminOrgIds: [orgA.id, 'gibt-es-nicht'] }, bezirksadmin())).rejects.toMatchObject({
      kind: 'invalid',
      message: 'Admin-Feuerwehr wurde nicht gefunden.',
    });
    expect(await created('adminunbekannt')).toBeNull();
    expect(sendActivationEmail).not.toHaveBeenCalled();
  });

  it('dedupliziert "Admin für" (doppelte Feuerwehr-ID ist kein Fehler)', async () => {
    await run('admindoppelt', { adminOrgIds: [orgA.id, orgA.id] }, bezirksadmin());
    const row = await created('admindoppelt');
    expect(await prisma.membership.count({ where: { userId: row!.id } })).toBe(1);
  });

  it('entfernt Steuerzeichen aus dem Prüfprotokoll-Text (Zeilenumbruch, ANSI-Escape)', async () => {
    const result = await run('steuer', { firstName: 'Neu\nZeile', lastName: `${RUN}\u001b[31mrot\r\tX` });
    const summary = result.audit!.summary;
    expect(summary).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(summary).toContain('Neu Zeile');
    expect(summary).toContain(email('steuer'));
  });

  it('legt den Benutzer an, sendet die Willkommens-Mail nur an ihn und gibt nie Token oder Link aus', async () => {
    const result = await run('ok');
    const row = await created('ok');
    expect(row).not.toBeNull();
    expect(row!.isActive).toBe(false);
    expect(sendActivationEmail).toHaveBeenCalledTimes(1);
    const [recipient, token] = sendActivationEmail.mock.calls[0] as unknown as [{ email: string }, string];
    expect(recipient.email).toBe(email('ok'));
    expect(token.length).toBeGreaterThan(20);

    const data = result.data as { userId: string; emailSent: boolean };
    expect(data.userId).toBe(row!.id);
    expect(data.emailSent).toBe(true);
    expect(Object.keys(result.data as object).sort()).toEqual(['email', 'emailSent', 'heimatfeuerwehr', 'name', 'userId']);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(token);
    expect(serialized.toLowerCase()).not.toContain('aktivieren');
    expect(serialized.toLowerCase()).not.toContain('token');
    expect(result.audit).toMatchObject({ targetUserId: row!.id });
    expect(result.audit!.summary).toContain(email('ok'));
    expect(result.audit!.summary).toContain(email('actor'));
    expect(result.audit!.summary).toContain('durch ');
    expect(JSON.stringify(result.audit)).not.toContain(token);
  });

  it('legt Rollen an: Admin für die eigene Feuerwehr, Drohnengruppen-Mitglied mit Ausbildung (als Bezirksadmin)', async () => {
    await run('rollen', { adminOrgIds: [orgA.id], droneRole: 'PILOT', droneGroupId: group.id, ausbildung: { a1a3Lizenz: '2025-01-10' }, istAtemschutzgeraeteTraeger: true }, bezirksadmin());
    const row = await created('rollen');
    expect(row!.istAtemschutzgeraeteTraeger).toBe(true);
    expect(await prisma.membership.count({ where: { userId: row!.id } })).toBe(1);
    expect(await prisma.drohnengruppeMembership.count({ where: { userId: row!.id, droneGroupId: group.id } })).toBe(1);
  });

  it('lehnt Bezirks- und MCP-Rechte im Aufruf ab (strenges Schema) und legt nichts an', async () => {
    for (const [key, extra] of [
      ['rechte1', { isBezirksAdmin: true }],
      ['rechte2', { isBezirksDrohnenAdmin: true }],
      ['rechte3', { mcpAccess: 'WRITE' }],
      ['rechte4', { secondaryOrganizationId: orgB.id }],
      ['rechte5', { isActive: true }],
    ] as const) {
      await expect(run(key, extra, bezirksadmin())).rejects.toMatchObject({ kind: 'invalid', message: 'Unbekannte Felder in der Eingabe.' });
      expect(await created(key)).toBeNull();
    }
    expect(sendActivationEmail).not.toHaveBeenCalled();
  });

  it('lehnt Aufrufer ohne WRITE-Stufe und Mitglieder ohne Verwaltungsrecht ab', async () => {
    await expect(run('read', {}, principal({}, 'READ'))).rejects.toMatchObject({ kind: 'denied' });
    await expect(run('member', {}, principalFixture(sessionUserFixture({ id: actorId }), 'WRITE'))).rejects.toMatchObject({ kind: 'denied' });
    expect(await created('read')).toBeNull();
    expect(await created('member')).toBeNull();
    expect(sendActivationEmail).not.toHaveBeenCalled();
  });

  it('Feuerwehr-Admin: nur die eigene Feuerwehr; Bezirksadmin: jede; unbekannte Feuerwehr ist ungültig', async () => {
    await expect(run('fremd', { homeOrganizationId: orgB.id })).rejects.toMatchObject({ kind: 'denied' });
    await expect(run('unbekannt', { homeOrganizationId: 'gibt-es-nicht' }, bezirksadmin())).rejects.toMatchObject({ kind: 'invalid' });
    expect(await created('fremd')).toBeNull();
    expect(await created('unbekannt')).toBeNull();
    await run('bezirk', { homeOrganizationId: orgB.id }, bezirksadmin());
    expect(await created('bezirk')).not.toBeNull();
  });

  it('Abschnittsadmin: Feuerwehren des eigenen Abschnitts ja, anderer Abschnitt nein', async () => {
    const abschnittAdmin = principal({ feuerwehrAdminOrgIds: [orgA.parentId!, orgA.id], abschnittAdminOrgIds: [orgA.parentId!] });
    await run('abschnitt-ok', {}, abschnittAdmin);
    expect(await created('abschnitt-ok')).not.toBeNull();
    await expect(run('abschnitt-fremd', { homeOrganizationId: orgB.id }, abschnittAdmin)).rejects.toMatchObject({ kind: 'denied' });
    expect(await created('abschnitt-fremd')).toBeNull();
  });

  it('lehnt "Admin für" und Drohnengruppen ohne Recht ab und legt dann nichts an', async () => {
    await expect(run('adminfremd', { adminOrgIds: [orgB.id] })).rejects.toMatchObject({ kind: 'denied' });
    await expect(run('gruppe', { droneRole: 'PILOT', droneGroupId: group.id })).rejects.toMatchObject({ kind: 'denied' });
    expect(await created('adminfremd')).toBeNull();
    expect(await created('gruppe')).toBeNull();
  });

  it('meldet ungültige Eingaben mit statischer, lesbarer Meldung (Standesbuchnummer, Telefon, Rolle ohne Gruppe, Reihenfolge)', async () => {
    await expect(run('stb', { stbNr: '0123' })).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('Standesbuchnummer') });
    await expect(run('tel', { phone: '0660123' })).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('E.164') });
    await expect(run('rolle', { droneRole: 'PILOT' })).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('Drohnengruppe') });
    await expect(run('reihe', { droneRole: 'PILOT', droneGroupId: group.id, ausbildung: { bos1: '2025-04-01' } }, bezirksadmin())).rejects.toMatchObject({
      kind: 'invalid',
      message: expect.stringContaining('der Reihe nach'),
    });
    await expect(run('dienstgrad', { dienstgradId: 'gibt-es-nicht' })).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('Dienstgrad') });
    await expect(run('datum', { ausbildung: { a1a3Lizenz: 'morgen' } })).rejects.toMatchObject({ kind: 'invalid' });
    for (const key of ['stb', 'tel', 'rolle', 'reihe', 'dienstgrad', 'datum']) expect(await created(key)).toBeNull();
  });

  it('gibt Eingabewerte nie in Fehlermeldungen wieder (Meldungen landen wörtlich im Prüfprotokoll)', async () => {
    const secret = `${RUN}-geheim`;
    const cases: Record<string, unknown>[] = [
      { phone: '0660123' },
      { stbNr: '0123' },
      { email: 'kein-email', lastName: secret },
      { droneRole: 'GEHEIM' },
      { dienstgradId: secret },
      { homeOrganizationId: secret },
      { [secret]: 1 },
    ];
    for (const extra of cases) {
      const error = await run('echo', extra, bezirksadmin()).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      for (const leak of [secret, 'GEHEIM', '0660123', 'kein-email']) expect((error as Error).message).not.toContain(leak);
    }
  });

  it('meldet eine bereits vergebene E-Mail-Adresse', async () => {
    await run('doppelt');
    await expect(run('doppelt')).rejects.toMatchObject({ kind: 'invalid', message: 'Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.' });
  });

  it('behält den Benutzer, wenn die Mail nicht gesendet werden kann, und sagt das ehrlich', async () => {
    sendActivationEmail.mockRejectedValueOnce(new Error('Mailjet down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await run('mailfehler');
    spy.mockRestore();
    expect(await created('mailfehler')).not.toBeNull();
    expect(result.data).toMatchObject({ emailSent: false });
    expect((result.data as { hinweis: string }).hinweis).toContain('Passwort-Reset');
  });
});

describe('create_user über runTool (Prüfprotokoll)', () => {
  it('protokolliert DENIED, ungültige Eingaben (ERROR) und OK mit Aufrufer-E-Mail, ohne Telefonnummer', async () => {
    const audit = vi.fn(async (_entry: unknown) => undefined);
    const phone = '+436601234567';
    await runTool(principal({}, 'READ'), createUserTool, baseArgs('audit-read'), { audit });
    await runTool(principal(), createUserTool, baseArgs('audit-denied', { homeOrganizationId: orgB.id }), { audit });
    await runTool(principal(), createUserTool, baseArgs('audit-invalid', { stbNr: '0123' }), { audit });
    await runTool(principal(), createUserTool, baseArgs('audit-ok', { phone }), { audit });
    const entries = audit.mock.calls.map((c) => c[0] as { tool: string; outcome: string; summary: string; targetUserId?: string });
    expect(entries.map((e) => e.outcome)).toEqual(['DENIED', 'DENIED', 'ERROR', 'OK']);
    expect(entries.every((e) => e.tool === 'create_user')).toBe(true);
    const ok = entries[3];
    expect(ok.targetUserId).toEqual(expect.any(String));
    expect(ok.summary).toContain(email('audit-ok'));
    expect(ok.summary).toContain(email('actor'));
    expect(ok.summary).toContain(orgA.shortName ?? orgA.name);
    expect(ok.summary).not.toContain(phone);
    expect(JSON.stringify(entries)).not.toContain(phone);
  });

  it('schreibt den OK-Eintrag in das echte Prüfprotokoll (zählt für die Mengenbegrenzung)', async () => {
    const result = await runTool(principal(), createUserTool, baseArgs('audit-db', { phone: '+436601234567' }));
    expect(result.isError).toBeUndefined();
    const row = await created('audit-db');
    const logs = await prisma.mcpAuditLog.findMany({ where: { userId: actorId, tool: 'create_user', outcome: 'OK', targetUserId: row!.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].summary).toContain(email('actor'));
    expect(logs[0].summary).not.toContain('+4366');
    expect(result.content[0].text).not.toContain('aktivieren');
  });
});

describe('create_user Mengenbegrenzung', () => {
  const limitPrincipal = () =>
    principalFixture(sessionUserFixture({ id: limitActorId, email: email('limitactor'), homeOrganizationId: orgA.id, feuerwehrAdminOrgIds: [orgA.id] }), 'WRITE');
  const seed = (n: number, outcome: 'OK' | 'DENIED' | 'ERROR' = 'OK') =>
    Promise.all(Array.from({ length: n }, () => recordMcpAudit({ userId: limitActorId, clientId: 'mcp_test', tool: 'create_user', outcome, summary: 'x' })));

  it('zählt nur OK-Einträge: der 20. Benutzer ist erlaubt, der 21. gesperrt; nichts wird bei Sperre angelegt', async () => {
    await seed(CREATE_USER_PER_HOUR - 1);
    await seed(3, 'DENIED');
    await seed(2, 'ERROR');
    await run('limit-19', {}, limitPrincipal());
    expect(await created('limit-19')).not.toBeNull();
    await seed(1);
    await expect(run('limit-20', {}, limitPrincipal())).rejects.toMatchObject({ kind: 'denied', message: expect.stringContaining('Mengenbegrenzung') });
    expect(await created('limit-20')).toBeNull();
    expect(sendActivationEmail).toHaveBeenCalledTimes(1);
  });
});
