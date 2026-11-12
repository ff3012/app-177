import { z } from 'zod';
import { canManageHeimatfeuerwehrFor, isBezirksAdmin } from '@/lib/auth/permissions';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { prisma } from '@/lib/db/prisma';
import { getExpiryStatus, getFinnentestExpiryDate, type AtemschutzExpiryStatus } from '@/lib/heimatfeuerwehr/atemschutz-status';
import { clampLimit, decodeCursor, denied, encodeCursor } from './context';
import { defineTool } from './define';

/** Schlechtester Zustand gewinnt; "keine Angabe" nur, wenn beide Werte fehlen. */
export function combineStatus(a: AtemschutzExpiryStatus, b: AtemschutzExpiryStatus): AtemschutzExpiryStatus {
  if (a === 'abgelaufen' || b === 'abgelaufen') return 'abgelaufen';
  if (a === 'laeuft_bald_ab' || b === 'laeuft_bald_ab') return 'laeuft_bald_ab';
  if (a === 'keine_angabe' && b === 'keine_angabe') return 'keine_angabe';
  return 'aktiv';
}

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

interface AtemschutzRow {
  id: string;
  firstName: string;
  lastName: string;
  atemschutzGueltigBis: Date | null;
  atemschutzFinnentestAm: Date | null;
  homeOrganization: { name: string; shortName: string | null };
}

function toDto(row: AtemschutzRow) {
  const finnentestBis = getFinnentestExpiryDate(row.atemschutzFinnentestAm);
  const untersuchungStatus = getExpiryStatus(row.atemschutzGueltigBis);
  const finnentestStatus = getExpiryStatus(finnentestBis);
  return {
    id: row.id,
    name: `${row.lastName} ${row.firstName}`,
    feuerwehr: row.homeOrganization.shortName ?? row.homeOrganization.name,
    untersuchungGueltigBis: day(row.atemschutzGueltigBis),
    untersuchungStatus,
    finnentestAm: day(row.atemschutzFinnentestAm),
    finnentestGueltigBis: day(finnentestBis),
    finnentestStatus,
    gesamtStatus: combineStatus(untersuchungStatus, finnentestStatus),
  };
}

const rowSelect = {
  id: true,
  firstName: true,
  lastName: true,
  atemschutzGueltigBis: true,
  atemschutzFinnentestAm: true,
  homeOrganization: { select: { name: true, shortName: true, featureAtemschutz: true } },
} as const;

export const getAtemschutzStatus = defineTool({
  name: 'get_atemschutz_status',
  description:
    'Atemschutz: Gültigkeit von Untersuchung und Finnentest. Zeigt immer den eigenen Status; Admins zusätzlich die Atemschutzgeräteträger ihrer Feuerwehr(en). Ein Bezirksadmin muss organizationId angeben. Feuerwehren ohne aktivierten Funktionsschalter Atemschutz liefern nichts.',
  access: 'READ',
  inputSchema: {
    organizationId: z.string().optional().describe('Nur diese Feuerwehr (ID aus list_organizations)'),
    status: z.enum(['aktiv', 'laeuft_bald_ab', 'abgelaufen', 'keine_angabe']).optional().describe('Nur Träger mit diesem Gesamtstatus'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional().describe('nextCursor der vorherigen Seite'),
  },
  handler: async ({ principal }, input) => {
    const user = principal.user;

    const own = await prisma.user.findUnique({ where: { id: user.id }, select: { ...rowSelect, istAtemschutzgeraeteTraeger: true } });
    // Wie die App (meine-feuerwehr/page.tsx): ohne Funktionsschalter Atemschutz der Feuerwehr gibt es keinen Status.
    const eigener = own?.istAtemschutzgeraeteTraeger && own.homeOrganization.featureAtemschutz ? toDto(own) : null;

    if (input.organizationId && !canManageHeimatfeuerwehrFor(user, input.organizationId)) {
      throw denied('Keine Berechtigung für diese Feuerwehr.');
    }
    const orgIds = input.organizationId ? [input.organizationId] : isBezirksAdmin(user) ? null : user.feuerwehrAdminOrgIds;
    if (orgIds === null) {
      return { data: { eigener, hinweis: 'Für die Liste bitte organizationId angeben (Bezirksadmin).' } };
    }
    if (orgIds.length === 0) return { data: { eigener } };

    const rows = await prisma.user.findMany({
      where: {
        homeOrganizationId: { in: orgIds },
        homeOrganization: { featureAtemschutz: true },
        istAtemschutzgeraeteTraeger: true,
        ...NOT_DEACTIVATED_WHERE,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      select: rowSelect,
    });
    const all = rows.map(toDto).filter((dto) => !input.status || dto.gesamtStatus === input.status);

    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);
    const items = all.slice(offset, offset + limit);
    const nextCursor = offset + limit < all.length ? encodeCursor(offset + limit) : null;
    return { data: { eigener, liste: { items, nextCursor } } };
  },
});
