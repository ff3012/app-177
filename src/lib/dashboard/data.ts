import { prisma } from '@/lib/db/prisma';

// Obere clamp-Grenze aus Design-Spec §4 ("Termine 4-10") - der Server liefert das Maximum, die
// HeightFittedList-Komponente (Task 5) blendet je nach gemessener Höhe den Überhang clientseitig aus.
const MAX_EVENTS = 10;
const MAX_VEHICLE_BOOKINGS = 8;
const VEHICLE_BOOKING_WINDOW_DAYS = 30;

export interface DashboardEvent {
  id: string;
  title: string;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  category: 'ALLGEMEIN' | 'DROHNENGRUPPE';
  isSectionWide: boolean;
}

/** Kommende Termine der eigenen Heimatfeuerwehr + Abschnitt-weite + Drohnengruppe, OHNE RSVP-Felder
 * (Design-Spec §3: "Ohne RSVP-Felder"). Anders als die normale Kalenderansicht wird die
 * Drohnengruppe-Kategorie hier NICHT nach canViewDroneModule gefiltert - der Dashboard-Screen hat
 * keinen Viewer mit eigenen Rechten, er zeigt alle Kategorien der eigenen Org/des Abschnitts. */
export async function getDashboardEvents(organizationId: string): Promise<DashboardEvent[]> {
  const now = new Date();
  return prisma.event.findMany({
    where: {
      startsAt: { gte: now },
      OR: [{ organizationId }, { isSectionWide: true }],
    },
    orderBy: { startsAt: 'asc' },
    take: MAX_EVENTS,
    select: {
      id: true,
      title: true,
      location: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      category: true,
      isSectionWide: true,
    },
  });
}

export interface DashboardVehicleBooking {
  id: string;
  startsAt: Date;
  endsAt: Date;
  vehicleTaktischeBezeichnung: string;
  borrowerName: string;
}

/** Ausgeborgte Fahrzeuge der nächsten 30 Tage (Design-Spec §3), Limit 8 für die Tabelle - die
 * Gesamtzahl (ohne Limit) liefert getUpcomingVehicleBookingsCount() separat für die Fußzeile. */
export async function getDashboardVehicleBookings(organizationId: string): Promise<DashboardVehicleBooking[]> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + VEHICLE_BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const bookings = await prisma.vehicleBooking.findMany({
    where: {
      vehicle: { organizationId },
      startsAt: { gte: now, lte: windowEnd },
    },
    orderBy: { startsAt: 'asc' },
    take: MAX_VEHICLE_BOOKINGS,
    include: {
      vehicle: { select: { taktischeBezeichnung: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });

  return bookings.map((booking) => ({
    id: booking.id,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    vehicleTaktischeBezeichnung: booking.vehicle.taktischeBezeichnung,
    borrowerName: `${booking.user.firstName} ${booking.user.lastName}`,
  }));
}

export async function getUpcomingVehicleBookingsCount(organizationId: string): Promise<number> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + VEHICLE_BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return prisma.vehicleBooking.count({
    where: {
      vehicle: { organizationId },
      startsAt: { gte: now, lte: windowEnd },
    },
  });
}
