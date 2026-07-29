import { prisma } from '@/lib/db/prisma';

/** Alle aktiven Mitglieder der Drohnengruppe (Rolle PILOT oder ADMIN), für Piloten-Auswahl & Berichte. */
export async function listDrohnengruppeMembers() {
  return prisma.user.findMany({
    where: { droneMembership: { isNot: null }, isActive: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true },
  });
}

/**
 * Serverseitige Eligibility-Prüfung für einen als Pilot übermittelten userId (Formular bietet nur
 * aktive Mitglieder an, aber ein manipuliertes Request könnte trotzdem eine andere Id senden) -
 * dieselbe where-Klausel wie listDrohnengruppeMembers, nur für eine einzelne Id statt einer Liste.
 */
export async function isEligiblePilot(userId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: userId, isActive: true, droneMembership: { isNot: null } },
    select: { id: true },
  });
  return Boolean(user);
}

/** Serverseitige Eligibility-Prüfung für eine als droneId übermittelte Id, analog zu isEligiblePilot. */
export async function isActiveDrone(droneId: string): Promise<boolean> {
  const drone = await prisma.drone.findFirst({ where: { id: droneId, isActive: true }, select: { id: true } });
  return Boolean(drone);
}
