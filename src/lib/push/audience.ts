import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';

/**
 * Zielgruppe für die "Push-Benachrichtigung jetzt senden"-Option auf der Termin-Detailseite -
 * bewusst dieselbe Sichtbarkeitsregel wie canViewEvent/die Kalenderübersicht-Query:
 * - Kategorie DROHNENGRUPPE ist VÖLLIG UNABHÄNGIG von organizationId/isSectionWide (siehe
 *   canViewEvent) - Zielgruppe ist ausschließlich über die Drohnengruppen-Mitgliedschaft bestimmt:
 *   die eine Gruppe (droneGroupId gesetzt) oder JEDE Gruppe (droneGroupId null, bezirksweit).
 * - Kategorie ALLGEMEIN bleibt bei der alten organisations-/abschnittsbasierten Regel.
 * Nicht die FIRE_DEPARTMENT/DRONE_GROUP-Unterscheidung von NewsPost, da ein Termin abschnittsweit
 * sein kann, ohne eine eigene NewsPost-Zeile mit passendem NewsAudience-Wert zu haben.
 */
export async function resolveEventAudienceUserIds(event: {
  organizationId: string;
  isSectionWide: boolean;
  isDistrictWide: boolean;
  category: string;
  droneGroupId: string | null;
}): Promise<string[]> {
  if (event.category === 'DROHNENGRUPPE') {
    // droneGroupId null bedeutet bezirksweit (alle 4 Gruppen) - genau wie bei canViewEvent und bei
    // NewsPost.droneGroupId (siehe Kommentar dort im Schema), NICHT mehr "niemand". Das
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

  // Die Organisations-/Abschnitts-/Bezirkshälfte der Sichtbarkeitsregel - identisch zu canViewEvent:
  // eigene Feuerwehr ODER (abschnittsweit UND im selben Abschnitt) ODER bezirksweit (jedes aktive
  // Mitglied). Bei einem abschnittsweiten Termin umfasst die Abschnittsbedingung die
  // eigene-Feuerwehr-Bedingung bereits vollständig; bei einem bezirksweiten Termin die
  // Abschnittsbedingung ebenfalls.
  let visibilityWhere: Prisma.UserWhereInput;
  if (event.isDistrictWide) {
    visibilityWhere = {};
  } else if (event.isSectionWide) {
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
