import { prisma } from '@/lib/db/prisma';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { NINETY_DAY_REQUIRED_FLIGHTS, getNinetyDayCutoff } from './ninety-day-rule';

export type EinsatzbereitschaftStatus = 'GRUEN' | 'GELB' | 'ROT';

export interface PilotEinsatzbereitschaft {
  id: string;
  name: string;
  flightCount: number;
  status: EinsatzbereitschaftStatus;
}

export interface GruppenEinsatzbereitschaft {
  droneGroupId: string;
  droneGroupName: string;
  totalMembers: number;
  a2Count: number;
  pilots: PilotEinsatzbereitschaft[];
}

/**
 * GRÜN = 90-Tage-Regel erfüllt (>= NINETY_DAY_REQUIRED_FLIGHTS Flüge), GELB = genau einer zu
 * wenig, ROT = alles darunter. Nur für Mitglieder mit gesetztem bos1AusbildungAm aufgerufen -
 * siehe getGruppenEinsatzbereitschaft.
 */
export function classifyFlightCount(flightCount: number): EinsatzbereitschaftStatus {
  if (flightCount >= NINETY_DAY_REQUIRED_FLIGHTS) return 'GRUEN';
  if (flightCount === NINETY_DAY_REQUIRED_FLIGHTS - 1) return 'GELB';
  return 'ROT';
}

const STATUS_SORT_ORDER: Record<EinsatzbereitschaftStatus, number> = { ROT: 0, GELB: 1, GRUEN: 2 };

/**
 * Einsatzbereitschaft einer einzelnen Drohnengruppe: Gesamtmitgliederzahl, Anzahl mit
 * A2-Zertifikat, und die Ampel-Liste aller Mitglieder MIT bos1AusbildungAm (wer keine BOS1-
 * Ausbildung hat, erscheint nicht in `pilots`, zählt aber in `totalMembers` mit - siehe
 * Design-Spec §3/§6). `memberships` wird bereits nach Nachname/Vorname sortiert geladen; das
 * abschließende .sort() ist stabil (JS-Array-Sort ist seit ES2019 garantiert stabil) und
 * sortiert nur noch nach Dringlichkeit um, ohne die alphabetische Reihenfolge innerhalb einer
 * Ampel-Farbe zu zerstören.
 */
export async function getGruppenEinsatzbereitschaft(droneGroupId: string): Promise<GruppenEinsatzbereitschaft> {
  const [droneGroup, memberships, flightCounts] = await Promise.all([
    prisma.droneGroup.findUniqueOrThrow({ where: { id: droneGroupId }, select: { name: true } }),
    prisma.drohnengruppeMembership.findMany({
      where: { droneGroupId, user: NOT_DEACTIVATED_WHERE },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      select: {
        bos1AusbildungAm: true,
        a2LizenzAm: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.droneFlight.groupBy({
      by: ['pilotUserId'],
      where: { startsAt: { gte: getNinetyDayCutoff() }, pilotUser: { droneMembership: { droneGroupId } } },
      _count: { _all: true },
    }),
  ]);

  const countByPilot = new Map(flightCounts.map((c) => [c.pilotUserId, c._count._all]));

  const pilots: PilotEinsatzbereitschaft[] = memberships
    .filter((m) => m.bos1AusbildungAm !== null)
    .map((m) => {
      const flightCount = countByPilot.get(m.user.id) ?? 0;
      return {
        id: m.user.id,
        name: `${m.user.lastName} ${m.user.firstName}`,
        flightCount,
        status: classifyFlightCount(flightCount),
      };
    })
    .sort((a, b) => STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]);

  return {
    droneGroupId,
    droneGroupName: droneGroup.name,
    totalMembers: memberships.length,
    a2Count: memberships.filter((m) => m.a2LizenzAm !== null).length,
    pilots,
  };
}
