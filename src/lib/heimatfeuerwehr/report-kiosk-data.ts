import type { ReportType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { ACTIVE_REPORT_TYPES } from './report-constants';
import { findOrganizationByKioskToken } from './report-kiosk-token';
import { getRecentActivityKindsForOrg } from './recent-activity-kinds';

export interface KioskData {
  organization: { id: string; name: string };
  /** Nur Id und Name: das Gerät ist öffentlich, E-Mail/Stb-Nr./Telefon verlassen den Server nie. */
  members: { id: string; firstName: string; lastName: string }[];
  vehicles: { id: string; taktischeBezeichnung: string; kennzeichen: string }[];
  recentKindsByType: Record<string, string[]>;
}

/** Alles, was die Seite /berichte-schnell/[token] braucht - null bei unbekanntem/abgeschaltetem Link. */
export async function loadKioskData(token: string): Promise<KioskData | null> {
  const organization = await findOrganizationByKioskToken(token);
  if (!organization) return null;

  const [members, vehicles, recent] = await Promise.all([
    prisma.user.findMany({
      where: { homeOrganizationId: organization.id, ...NOT_DEACTIVATED_WHERE },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.vehicle.findMany({
      where: { organizationId: organization.id, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
    }),
    Promise.all(
      ACTIVE_REPORT_TYPES.map(async (type) => [type, await getRecentActivityKindsForOrg(organization.id, type as ReportType)] as const),
    ),
  ]);

  return { organization, members, vehicles, recentKindsByType: Object.fromEntries(recent) };
}
