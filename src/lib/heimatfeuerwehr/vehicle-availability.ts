import { prisma } from '@/lib/db/prisma';

/**
 * Serverseitiger Überlappungs-Check für Fahrzeug-Buchungen - Postgres-Exclusion-Constraints sind
 * über Prisma nicht abbildbar, daher hier ein einfacher Intervall-Überlappungs-Query
 * (existingStart < newEnd AND existingEnd > newStart), analog zum Recheck-Muster von
 * isEligiblePilot/isActiveDrone (lib/drone/members.ts). excludeBookingId wird beim Stornieren
 * einer eigenen Buchung nicht gebraucht (nur beim - hier nicht vorhandenen - Bearbeiten einer
 * bestehenden Buchung), aber schon vorgesehen, falls das später dazukommt.
 *
 * ABGELEHNT-Reservierungen blockieren absichtlich NICHT (das Fahrzeug ist für diesen Zeitraum
 * wieder frei) - OFFEN blockiert dagegen weiterhin wie GENEHMIGT, sonst könnten zwei Mitglieder
 * denselben Zeitraum gleichzeitig zur Genehmigung einreichen und nur einer würde beim Genehmigen
 * bemerken, dass es schon eine Kollision gibt.
 */
export async function findOverlappingBooking(
  vehicleId: string,
  startsAt: Date,
  endsAt: Date,
  excludeBookingId?: string,
) {
  return prisma.vehicleBooking.findFirst({
    where: {
      vehicleId,
      id: excludeBookingId ? { not: excludeBookingId } : undefined,
      status: { not: 'ABGELEHNT' },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
}
