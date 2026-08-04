import { prisma } from '@/lib/db/prisma';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';

/**
 * Mitglieder der Drohnengruppe (Rolle PILOT oder ADMIN) für Piloten-Auswahl & Berichte - schließt
 * noch nie aktivierte Benutzer bewusst ein (damit bereits absolvierte Flüge sofort erfasst werden
 * können), aber bewusst deaktivierte Benutzer aus (NOT_DEACTIVATED_WHERE, siehe dort).
 */
export async function listDrohnengruppeMembers() {
  return prisma.user.findMany({
    where: { droneMembership: { isNot: null }, ...NOT_DEACTIVATED_WHERE },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true },
  });
}

/**
 * Serverseitige Eligibility-Prüfung für einen als Pilot übermittelten userId (Formular bietet nur
 * berechtigte Mitglieder an, aber ein manipuliertes Request könnte trotzdem eine andere Id senden) -
 * dieselbe where-Klausel wie listDrohnengruppeMembers, nur für eine einzelne Id statt einer Liste.
 */
export async function isEligiblePilot(userId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: userId, ...NOT_DEACTIVATED_WHERE, droneMembership: { isNot: null } },
    select: { id: true },
  });
  return Boolean(user);
}

/** Serverseitige Eligibility-Prüfung für eine als droneId übermittelte Id, analog zu isEligiblePilot. */
export async function isActiveDrone(droneId: string): Promise<boolean> {
  const drone = await prisma.drone.findFirst({ where: { id: droneId, isActive: true }, select: { id: true } });
  return Boolean(drone);
}
