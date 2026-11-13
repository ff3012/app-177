import { z } from 'zod';
import { isBezirksAdmin } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/prisma';
import { clampLimit, decodeCursor, toPage } from './context';
import { defineTool } from './define';

export const listOrganizations = defineTool({
  name: 'list_organizations',
  description:
    'Listet Feuerwehren und Abschnittskommandos im eigenen Verwaltungsbereich (mit IDs, die z. B. create_user als homeOrganizationId braucht). Ohne Verwaltungsrecht ist die Liste leer.',
  access: 'READ',
  inputSchema: {
    query: z.string().max(100).optional().describe('Suchtext im Namen'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional().describe('nextCursor der vorherigen Seite'),
  },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);
    const query = input.query?.trim();

    const rows = await prisma.organization.findMany({
      where: {
        isActive: true,
        ...(isBezirksAdmin(user) ? {} : { id: { in: user.feuerwehrAdminOrgIds } }),
        ...(query
          ? { OR: [{ name: { contains: query, mode: 'insensitive' as const } }, { shortName: { contains: query, mode: 'insensitive' as const } }] }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
      select: { id: true, name: true, shortName: true, type: true, parent: { select: { shortName: true, name: true } } },
    });

    const page = toPage(rows, limit, offset);
    return {
      data: {
        items: page.items.map((org) => ({
          id: org.id,
          name: org.name,
          kurzname: org.shortName,
          art: org.type === 'ABSCHNITTSKOMMANDO' ? 'Abschnittskommando' : 'Feuerwehr',
          abschnitt: org.parent ? (org.parent.shortName ?? org.parent.name) : null,
        })),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const listDienstgrade = defineTool({
  name: 'list_dienstgrade',
  description: 'Listet alle Dienstgrade (NÖ-Dienstgradtabelle) in der Rangfolge, mit IDs für create_user.',
  access: 'READ',
  inputSchema: {},
  handler: async () => {
    const rows = await prisma.dienstgrad.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, kurzform: true, bezeichnung: true } });
    return { data: { items: rows } };
  },
});
