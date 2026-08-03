'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageVehicleBooking } from '@/lib/auth/permissions';
import { vehicleBookingSchema, parseVehicleBookingFormData } from '@/lib/validation/vehicle-booking.schema';
import { findOverlappingBooking } from '@/lib/heimatfeuerwehr/vehicle-availability';

export interface VehicleBookingFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

// Legt neben der VehicleBooking zusätzlich einen normalen Kalender-Termin an (Titel "Fahrzeug: X
// (Vorname Nachname)", in der eigenen Heimatfeuerwehr, category ALLGEMEIN) - verknüpft über
// Event.vehicleBookingId. Der Termin ist ab dann ein STANDARD-Termin im Hauptkalender (sichtbar,
// mit RSVP), aber vor normaler Bearbeitung/Löschung geschützt (siehe kalender/actions.ts und
// kalender/[eventId]/bearbeiten/page.tsx).
export async function createVehicleBooking(
  _prevState: VehicleBookingFormState,
  formData: FormData,
): Promise<VehicleBookingFormState> {
  const user = await requireUser();

  const parsed = vehicleBookingSchema.safeParse(parseVehicleBookingFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const vehicle = await prisma.vehicle.findUnique({ where: { id: data.vehicleId } });
  if (!vehicle || !vehicle.isActive || vehicle.organizationId !== user.homeOrganizationId) {
    return { fieldErrors: { vehicleId: ['Ausgewähltes Fahrzeug ist nicht verfügbar.'] } };
  }

  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);

  const overlap = await findOverlappingBooking(data.vehicleId, startsAt, endsAt);
  if (overlap) {
    return {
      error: `Das Fahrzeug ist in diesem Zeitraum bereits von ${overlap.user.firstName} ${overlap.user.lastName} gebucht.`,
    };
  }

  const booking = await prisma.vehicleBooking.create({
    data: { vehicleId: data.vehicleId, userId: user.id, startsAt, endsAt, details: data.details },
  });

  await prisma.event.create({
    data: {
      title: `Fahrzeug: ${vehicle.taktischeBezeichnung} (${user.name})`,
      startsAt,
      endsAt,
      organizationId: user.homeOrganizationId,
      isSectionWide: false,
      category: 'ALLGEMEIN',
      createdById: user.id,
      vehicleBookingId: booking.id,
    },
  });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/kalender');
  redirect('/meine-feuerwehr');
}

// redirectTo lässt admin/heimatfeuerwehr/page.tsx diese exakte Funktion wiederverwenden (statt
// sie zu duplizieren), ohne einen Admin nach dem Löschen fremder Buchungen auf /meine-feuerwehr
// statt zurück auf die Verwaltungsseite zu schicken.
export async function cancelVehicleBooking(bookingId: string, redirectTo = '/meine-feuerwehr'): Promise<void> {
  const user = await requireUser();

  // redirectTo kommt bei einem direkten Server-Action-Aufruf potenziell von außerhalb dieser
  // Codebase (die Action ist über ihre Action-ID mit beliebigen Argumenten erreichbar) - ein
  // führender "/" stellt sicher, dass redirect() niemals auf eine absolute/externe URL zeigt.
  const safeRedirectTo = redirectTo.startsWith('/') ? redirectTo : '/meine-feuerwehr';

  const booking = await prisma.vehicleBooking.findUnique({
    where: { id: bookingId },
    include: { vehicle: { select: { organizationId: true } } },
  });
  if (!booking) {
    redirect(safeRedirectTo);
  }
  assertPermission(canManageVehicleBooking(user, booking, booking.vehicle.organizationId));

  // Der verknüpfte Termin könnte theoretisch schon unabhängig gelöscht worden sein (z. B. direkt
  // über Prisma Studio, am eigentlich vorgesehenen Schutz vorbei) - daher erst nachsehen statt
  // blind zu löschen.
  const linkedEvent = await prisma.event.findUnique({ where: { vehicleBookingId: bookingId } });
  if (linkedEvent) {
    await prisma.event.delete({ where: { id: linkedEvent.id } });
  }

  await prisma.vehicleBooking.delete({ where: { id: bookingId } });
  revalidatePath('/meine-feuerwehr');
  revalidatePath('/admin/heimatfeuerwehr');
  revalidatePath('/kalender');
  redirect(safeRedirectTo);
}
