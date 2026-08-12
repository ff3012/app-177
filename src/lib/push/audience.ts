import { NewsAudienceType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';

export async function resolveAudienceUserIds(
  audienceType: NewsAudienceType,
  audienceOrgId: string | null,
  audienceDroneGroupId: string | null = null,
): Promise<string[]> {
  if (audienceType === NewsAudienceType.DROHNENGRUPPE) {
    // Ein null audienceDroneGroupId bedeutet für NewsMessage bewusst "alle Gruppen" (siehe Kommentar
    // auf NewsMessage.audienceDroneGroupId im Schema) - das ist die richtige Zielsemantik hier.
    //
    // WICHTIG, per Live-Test gegen die echte Dev-DB verifiziert, NICHT nur angenommen - die vom
    // Task-Brief wörtlich vorgeschlagene Schreibweise `droneMembership: { droneGroupId: ... ?? undefined }`
    // (ohne `is:`) ist real fehlerhaft und wurde deshalb NICHT übernommen: wenn jedes Feld eines
    // verschachtelten Relations-Filterobjekts undefined ist, lässt Prisma die Relation dabei komplett
    // ungeprüft - das Ergebnis matcht dann JEDEN aktiven Nutzer, auch solche ganz OHNE droneMembership,
    // nicht nur "Mitglieder irgendeiner Gruppe". Live bestätigt: mit einem einzigen aktiven Nutzer ohne
    // Drohnengruppen-Zugehörigkeit in der DB matchte `droneMembership: { droneGroupId: undefined }`
    // genau diesen Nutzer trotzdem - identisch zu `droneMembership: {}`. Das explizite `is: {...}`
    // dagegen verlangt weiterhin, dass die Relation existiert, und filtert nur zusätzlich auf
    // droneGroupId wenn gesetzt - das ist die Form, die den alten Notbehelf `isNot: null` sauber um
    // die Gruppen-Eingrenzung erweitert, ohne diesen Bug zu erben.
    const members = await prisma.user.findMany({
      where: {
        droneMembership: { is: { droneGroupId: audienceDroneGroupId ?? undefined } },
        isActive: true,
      },
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
 * bewusst dieselbe Sichtbarkeitsregel wie canViewEvent/die Kalenderübersicht-Query:
 * - Kategorie DROHNENGRUPPE ist VÖLLIG UNABHÄNGIG von organizationId/isSectionWide (siehe
 *   canViewEvent) - Zielgruppe ist ausschließlich über die Drohnengruppen-Mitgliedschaft bestimmt:
 *   die eine Gruppe (droneGroupId gesetzt) oder JEDE Gruppe (droneGroupId null, bezirksweit).
 * - Kategorie ALLGEMEIN bleibt bei der alten organisations-/abschnittsbasierten Regel.
 * Nicht die ORGANIZATION/DROHNENGRUPPE-Unterscheidung von NewsMessage, da ein Termin abschnittsweit
 * sein kann, ohne eine eigene NewsAudienceType-Zeile zu haben.
 */
export async function resolveEventAudienceUserIds(event: {
  organizationId: string;
  isSectionWide: boolean;
  category: string;
  droneGroupId: string | null;
}): Promise<string[]> {
  if (event.category === 'DROHNENGRUPPE') {
    // droneGroupId null bedeutet bezirksweit (alle 4 Gruppen) - genau wie bei canViewEvent und bei
    // NewsMessage.audienceDroneGroupId (siehe Kommentar dort im Schema), NICHT mehr "niemand". Das
    // `is: {...}` (statt eines nackten `droneGroupId: ...`) verlangt weiterhin, dass die
    // droneMembership-Relation überhaupt existiert - ein Feld auf undefined setzen würde Prisma bei
    // einem verschachtelten Relations-Filter dazu bringen, dieses Feld GAR NICHT zu filtern (siehe
    // resolveAudienceUserIds oben für den bereits live bestätigten Prisma-Bug dieser Form).
    const members = await prisma.user.findMany({
      where: {
        isActive: true,
        droneMembership: { is: { droneGroupId: event.droneGroupId ?? undefined } },
      },
      select: { id: true },
    });
    return members.map((member) => member.id);
  }

  // Die Organisations-/Abschnittshälfte der Sichtbarkeitsregel - identisch zu canViewEvent:
  // eigene Feuerwehr ODER (abschnittsweit UND im selben Abschnitt). Bei einem abschnittsweiten Termin
  // umfasst die Abschnittsbedingung die eigene-Feuerwehr-Bedingung bereits vollständig.
  let visibilityWhere: Prisma.UserWhereInput;
  if (event.isSectionWide) {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: event.organizationId },
      select: { type: true, id: true, parentId: true },
    });
    const abschnittOrganizationId = getAbschnittOrganizationId(organization);
    visibilityWhere = {
      homeOrganization: { OR: [{ id: abschnittOrganizationId }, { parentId: abschnittOrganizationId }] },
    };
  } else {
    visibilityWhere = { homeOrganizationId: event.organizationId };
  }

  const members = await prisma.user.findMany({
    where: { isActive: true, ...visibilityWhere },
    select: { id: true },
  });
  return members.map((member) => member.id);
}
