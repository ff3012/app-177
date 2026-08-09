import { prisma } from '@/lib/db/prisma';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';

/**
 * Mitglieder EINER Drohnengruppe (Rolle PILOT oder ADMIN) für Piloten-Auswahl & Berichte - schließt
 * noch nie aktivierte Benutzer bewusst ein (damit bereits absolvierte Flüge sofort erfasst werden
 * können), aber bewusst deaktivierte Benutzer aus (NOT_DEACTIVATED_WHERE, siehe dort). Jetzt
 * gruppenscoped statt app-weit - jede Gruppe hat ihre eigene Mitgliederliste.
 */
export async function listDrohnengruppeMembers(droneGroupId: string) {
  return prisma.user.findMany({
    where: { droneMembership: { droneGroupId }, ...NOT_DEACTIVATED_WHERE },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true },
  });
}

/**
 * Serverseitige Eligibility-Prüfung für einen als Pilot übermittelten userId, jetzt zusätzlich gegen
 * eine konkrete droneGroupId geprüft - ein Pilot einer anderen Gruppe darf nicht ausgewählt werden.
 */
export async function isEligiblePilot(userId: string, droneGroupId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: userId, ...NOT_DEACTIVATED_WHERE, droneMembership: { droneGroupId } },
    select: { id: true },
  });
  return Boolean(user);
}

/** Serverseitige Eligibility-Prüfung für eine als droneId übermittelte Id, jetzt zusätzlich gegen
 * eine konkrete droneGroupId geprüft. */
export async function isActiveDrone(droneId: string, droneGroupId: string): Promise<boolean> {
  const drone = await prisma.drone.findFirst({ where: { id: droneId, isActive: true, droneGroupId }, select: { id: true } });
  return Boolean(drone);
}
