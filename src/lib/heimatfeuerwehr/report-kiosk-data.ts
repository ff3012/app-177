import { prisma } from '@/lib/db/prisma';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { getEnabledReportTypes } from './report-type-settings';
import { findOrganizationByKioskToken } from './report-kiosk-token';
import { getRecentActivityKindsForOrg } from './recent-activity-kinds';

export interface KioskData {
  organization: { id: string; name: string };
  /** Nur Id und Name: das Gerät ist öffentlich, E-Mail/Stb-Nr./Telefon verlassen den Server nie. */
  members: { id: string; firstName: string; lastName: string }[];
  vehicles: { id: string; taktischeBezeichnung: string; kennzeichen: string }[];
  /** Nur eingeschaltete Berichtsarten. */
  recentKindsByType: Record<string, string[]>;
  deviceName: string | null;
  enabledTypes: string[];
}

/** Alles, was die Seite /berichte-schnell/[token] braucht - null bei unbekanntem/abgeschaltetem Link. */
export async function loadKioskData(token: string): Promise<KioskData | null> {
  const organization = await findOrganizationByKioskToken(token);
  if (!organization) return null;

  const enabledTypes = await getEnabledReportTypes(organization.id);
  const [members, vehicles, recent, device] = await Promise.all([
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
      enabledTypes.map(async (type) => [type, await getRecentActivityKindsForOrg(organization.id, type)] as const),
    ),
    prisma.organization.findUniqueOrThrow({ where: { id: organization.id }, select: { reportKioskDeviceName: true } }),
  ]);

  return {
    organization,
    members,
    vehicles,
    recentKindsByType: Object.fromEntries(recent),
    deviceName: device.reportKioskDeviceName,
    enabledTypes,
  };
}
