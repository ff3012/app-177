import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { canAccessUserManagementAdmin, canManageUsersFor, isBezirksAdmin } from '@/lib/auth/permissions';
import { getUserStatus } from '@/lib/auth/user-status';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/types/next-auth';
import { clampLimit, decodeCursor, denied, invalid, toPage } from './context';
import { defineTool } from './define';
import { viennaDayOrNull } from './vienna-time';

type StatusFilter = 'aktiv' | 'inaktiv' | 'deaktiviert';

/** Wessen Benutzer darf der Aufrufer sehen - exakt wie admin/benutzer/page.tsx. */
export function userScopeWhere(user: SessionUser): Prisma.UserWhereInput {
  return isBezirksAdmin(user) ? {} : { homeOrganizationId: { in: user.feuerwehrAdminOrgIds } };
}

/** Dieselbe Ableitung wie getUserStatus (lib/auth/user-status.ts), hier als Prisma-Bedingung. */
export function statusWhere(status: StatusFilter): Prisma.UserWhereInput {
  if (status === 'aktiv') return { isActive: true };
  if (status === 'inaktiv') return { isActive: false, passwordChangedAt: null };
  return { isActive: false, passwordChangedAt: { not: null } };
}

/** Jedes Suchwort muss in Vorname, Nachname oder E-Mail vorkommen ("Krebs Florian" = "Florian Krebs"). */
export function searchWhere(query: string): Prisma.UserWhereInput {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return {};
  return {
    AND: words.map((word) => ({
      OR: [
        { firstName: { contains: word, mode: 'insensitive' as const } },
        { lastName: { contains: word, mode: 'insensitive' as const } },
        { email: { contains: word, mode: 'insensitive' as const } },
      ],
    })),
  };
}

const userSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  stbNr: true,
  phone: true,
  isActive: true,
  passwordChangedAt: true,
  lastLoginAt: true,
  istAtemschutzgeraeteTraeger: true,
  dienstgrad: { select: { kurzform: true } },
  homeOrganization: { select: { id: true, name: true, shortName: true } },
  memberships: { where: { role: 'ADMIN' as const }, select: { organization: { select: { name: true, shortName: true } } } },
  droneMembership: {
    select: {
      role: true,
      droneGroup: { select: { name: true } },
      a1a3LizenzAm: true,
      a2LizenzAm: true,
      stuetzpunktausbildungAm: true,
      bos1AusbildungAm: true,
      bos2AusbildungAm: true,
    },
  },
} satisfies Prisma.UserSelect;

type UserRecord = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const day = viennaDayOrNull;

function toUserDto(user: UserRecord) {
  return {
    id: user.id,
    name: `${user.lastName} ${user.firstName}`,
    vorname: user.firstName,
    nachname: user.lastName,
    dienstgrad: user.dienstgrad?.kurzform ?? null,
    heimatfeuerwehr: user.homeOrganization.shortName ?? user.homeOrganization.name,
    heimatfeuerwehrId: user.homeOrganization.id,
    email: user.email,
    standesbuchnummer: user.stbNr,
    telefon: user.phone,
    status: getUserStatus(user).toLowerCase() as StatusFilter,
    adminFuer: user.memberships.map((m) => m.organization.shortName ?? m.organization.name),
    drohnengruppe: user.droneMembership
      ? { name: user.droneMembership.droneGroup.name, rolle: user.droneMembership.role === 'ADMIN' ? 'Admin' : 'Mitglied' }
      : null,
    atemschutzgeraetetraeger: user.istAtemschutzgeraeteTraeger,
    zuletztAktiv: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

function requireUserAdmin(user: SessionUser): void {
  if (!canAccessUserManagementAdmin(user)) {
    throw denied('Keine Berechtigung: Benutzer sehen dürfen nur Admins (Bezirk, Abschnitt oder Feuerwehr).');
  }
}

export const listUsers = defineTool({
  name: 'list_users',
  description:
    'Benutzerverwaltung: listet Benutzer im eigenen Verwaltungsbereich (Name, Dienstgrad, Feuerwehr, E-Mail, Status, Rollen). Nur für Admins.',
  access: 'READ',
  inputSchema: {
    query: z.string().max(100).optional().describe('Suchtext in Vorname, Nachname oder E-Mail'),
    organizationId: z.string().optional().describe('Nur Benutzer dieser Heimatfeuerwehr (ID aus list_organizations)'),
    status: z.enum(['aktiv', 'inaktiv', 'deaktiviert']).optional().describe('inaktiv = nie aktiviert, deaktiviert = vom Admin abgeschaltet'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional().describe('nextCursor der vorherigen Seite'),
  },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    requireUserAdmin(user);
    if (input.organizationId && !canManageUsersFor(user, input.organizationId)) {
      throw denied('Keine Berechtigung für diese Feuerwehr.');
    }
    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);

    const rows = await prisma.user.findMany({
      where: {
        AND: [
          userScopeWhere(user),
          input.organizationId ? { homeOrganizationId: input.organizationId } : {},
          input.status ? statusWhere(input.status) : {},
          input.query ? searchWhere(input.query) : {},
        ],
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
      select: userSelect,
    });

    const page = toPage(rows, limit, offset);
    return { data: { items: page.items.map(toUserDto), nextCursor: page.nextCursor } };
  },
});

export const getUser = defineTool({
  name: 'get_user',
  description: 'Benutzerverwaltung: ein Benutzer im Detail, inklusive Drohnengruppen-Ausbildungsstufen. Nur für Admins, nur im eigenen Verwaltungsbereich.',
  access: 'READ',
  inputSchema: { userId: z.string().min(1).describe('ID aus list_users') },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    requireUserAdmin(user);
    const row = await prisma.user.findUnique({ where: { id: input.userId }, select: userSelect });
    // Außerhalb des Bereichs wird bewusst derselbe Text wie bei "unbekannt" geantwortet - sonst ließe sich die Existenz von
    // Benutzern erraten. Der Fall "existiert, aber außerhalb" wird als DENIED protokolliert, "unbekannt" nicht.
    if (!row) throw invalid('Benutzer wurde nicht gefunden.');
    if (!canManageUsersFor(user, row.homeOrganization.id)) throw denied('Benutzer wurde nicht gefunden.');
    const training = row.droneMembership;
    return {
      data: {
        ...toUserDto(row),
        ausbildung: {
          a1a3Lizenz: day(training?.a1a3LizenzAm ?? null),
          a2Lizenz: day(training?.a2LizenzAm ?? null),
          stuetzpunktausbildung: day(training?.stuetzpunktausbildungAm ?? null),
          bos1: day(training?.bos1AusbildungAm ?? null),
          bos2: day(training?.bos2AusbildungAm ?? null),
        },
      },
    };
  },
});
