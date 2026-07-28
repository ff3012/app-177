import { prisma } from '@/lib/db/prisma';

/** Alle aktiven Mitglieder der Drohnengruppe (Rolle PILOT oder ADMIN), für Piloten-Auswahl & Berichte. */
export async function listDrohnengruppeMembers() {
  return prisma.user.findMany({
    where: { droneMembership: { isNot: null }, isActive: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true },
  });
}
