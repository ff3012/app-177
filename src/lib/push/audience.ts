import { NewsAudienceType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';

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
  droneGroupId: string | null;
}): Promise<string[]> {
  if (event.category === 'DROHNENGRUPPE') {
    // Defensiv: sollte nach Task 8 nie eintreten (jedes DROHNENGRUPPE-Event trägt eine droneGroupId),
    // aber `droneMembership: { droneGroupId: undefined }` würde in Prisma dieses Feld GAR NICHT
    // filtern (nested-relation-Filter mit undefined = "kein Filter auf dieses Feld", nicht "kein
    // Treffer") und damit wieder auf alle Gruppen zurückweiten - exakt der Bug, der hier behoben wird.
    // Per Live-Test bestätigt (siehe Task-12-Report), nicht nur angenommen: lieber niemanden
    // benachrichtigen als versehentlich wieder bezirksweit an alle Drohnengruppen zu pushen.
    if (!event.droneGroupId) return [];
    const members = await prisma.user.findMany({
      where: { droneMembership: { droneGroupId: event.droneGroupId }, isActive: true },
      select: { id: true },
    });
    return members.map((member) => member.id);
  }

  if (!event.isSectionWide) {
    const members = await prisma.user.findMany({
      where: { isActive: true, homeOrganizationId: event.organizationId },
      select: { id: true },
    });
    return members.map((member) => member.id);
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: event.organizationId },
    select: { type: true, id: true, parentId: true },
  });
  const abschnittOrganizationId = getAbschnittOrganizationId(organization);
  const members = await prisma.user.findMany({
    where: {
      isActive: true,
      homeOrganization: { OR: [{ id: abschnittOrganizationId }, { parentId: abschnittOrganizationId }] },
    },
    select: { id: true },
  });
  return members.map((member) => member.id);
}
