import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { countRecentOk, recordMcpAudit } from './audit';

const RUN = `mcp-audit-${Date.now()}`;
let userId: string;

beforeAll(async () => {
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  const user = await prisma.user.create({
    data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'Audit', lastName: RUN, homeOrganizationId: org.id },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.mcpAuditLog.deleteMany({ where: { OR: [{ userId }, { clientId: RUN }] } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('recordMcpAudit / countRecentOk', () => {
  it('schreibt einen Eintrag und zählt nur OK-Einträge des Werkzeugs im Zeitfenster', async () => {
    await recordMcpAudit({ userId, clientId: RUN, tool: 'create_user', outcome: 'OK', summary: 'Benutzer angelegt' });
    await recordMcpAudit({ userId, clientId: RUN, tool: 'create_user', outcome: 'DENIED', summary: 'abgelehnt' });
    await recordMcpAudit({ userId, clientId: RUN, tool: 'list_users', outcome: 'OK', summary: 'x' });
    expect(await countRecentOk(userId, 'create_user', 60_000)).toBe(1);
    // Ein Fenster in der Zukunft (now + 2 h) enthält den Eintrag nicht mehr.
    expect(await countRecentOk(userId, 'create_user', 60_000, new Date(Date.now() + 2 * 60 * 60 * 1000))).toBe(0);
  });

  it('wirft nie, auch wenn der Eintrag nicht gespeichert werden kann', async () => {
    // Der erwartete Fremdschlüssel-Fehler wird von recordMcpAudit per console.error protokolliert; hier stumm geschaltet.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(
        recordMcpAudit({ userId: 'gibt-es-nicht', clientId: RUN, tool: 'x', outcome: 'ERROR', summary: 'y' }),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
