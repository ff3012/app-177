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
  // Defensiv: sollte nach Task 8 nie eintreten (jedes DROHNENGRUPPE-Event trägt eine droneGroupId),
  // aber `droneMembership: { droneGroupId: undefined }` würde in Prisma dieses Feld GAR NICHT
  // filtern (nested-relation-Filter mit undefined = "kein Filter auf dieses Feld", nicht "kein
  // Treffer") und damit wieder auf alle Gruppen zurückweiten - exakt der Bug, der hier behoben wird.
  // Per Live-Test bestätigt (siehe Task-12-Report), nicht nur angenommen: lieber niemanden
  // benachrichtigen als versehentlich wieder bezirksweit an alle Drohnengruppen zu pushen.
  if (event.category === 'DROHNENGRUPPE' && !event.droneGroupId) return [];

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

  // Bei Kategorie DROHNENGRUPPE kommt die Gruppenbedingung ZUSÄTZLICH zur obigen Hälfte dazu (UND,
  // nicht STATT) - genau wie in canViewEvent. Vorher wurde nur auf die Gruppe gefiltert, wodurch ein
  // NICHT abschnittsweiter Drohnengruppen-Termin einer einzelnen Feuerwehr an alle Mitglieder der
  // Gruppe über alle ihre Feuerwehren hinweg gepusht wurde - also auch an Leute, die den Termin gar
  // nicht öffnen können.
  const members = await prisma.user.findMany({
    where: {
      isActive: true,
      ...visibilityWhere,
      ...(event.category === 'DROHNENGRUPPE'
        ? { droneMembership: { is: { droneGroupId: event.droneGroupId as string } } }
        : {}),
    },
    select: { id: true },
  });
  return members.map((member) => member.id);
}
