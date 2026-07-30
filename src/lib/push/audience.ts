import { NewsAudienceType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export async function resolveAudienceUserIds(
  audienceType: NewsAudienceType,
  audienceOrgId: string | null,
): Promise<string[]> {
  if (audienceType === NewsAudienceType.DROHNENGRUPPE) {
    const members = await prisma.user.findMany({
      where: { droneMembership: { isNot: null }, isActive: true },
      select: { id: true },
    });
    return members.map((member) => member.id);
  }

  if (!audienceOrgId) return [];

  const members = await prisma.user.findMany({
    where: { homeOrganizationId: audienceOrgId, isActive: true },
    select: { id: true },
  });
  return members.map((member) => member.id);
}

/**
 * Zielgruppe für die "Push-Benachrichtigung jetzt senden"-Option auf der Termin-Detailseite -
 * bewusst dieselbe Sichtbarkeitsregel wie canViewEvent/die Kalenderübersicht-Query (eigene
 * Feuerwehr ODER abschnittsweit, Drohnengruppe-Kategorie zusätzlich nur Mitglieder), nicht die
 * ORGANIZATION/DROHNENGRUPPE-Unterscheidung von NewsMessage, da ein Termin abschnittsweit sein
 * kann, ohne eine eigene NewsAudienceType-Zeile zu haben.
 */
export async function resolveEventAudienceUserIds(event: {
  organizationId: string;
  isSectionWide: boolean;
  category: string;
}): Promise<string[]> {
  if (event.category === 'DROHNENGRUPPE') {
    const members = await prisma.user.findMany({
      where: { droneMembership: { isNot: null }, isActive: true },
      select: { id: true },
    });
    return members.map((member) => member.id);
  }

  const members = await prisma.user.findMany({
    where: event.isSectionWide ? { isActive: true } : { isActive: true, homeOrganizationId: event.organizationId },
    select: { id: true },
  });
  return members.map((member) => member.id);
}
