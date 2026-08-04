'use server';

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageVehicleBooking } from '@/lib/auth/permissions';
import { vehicleBookingSchema, parseVehicleBookingFormData } from '@/lib/validation/vehicle-booking.schema';
import { findOverlappingBooking } from '@/lib/heimatfeuerwehr/vehicle-availability';
import { sendVehicleBookingApprovalRequest } from '@/lib/heimatfeuerwehr/notify-vehicle-booking';

export interface VehicleBookingFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

/**
 * Legt eine Fahrzeug-Reservierung an. Ist für die Feuerwehr eine `fahrzeugReservierungEmail`
 * hinterlegt, startet die Reservierung als OFFEN und braucht erst eine Freigabe (Genehmigen/
 * Ablehnen-Mail an diese Adresse, siehe notify-vehicle-booking.ts) - der verknüpfte Kalender-Termin
 * (Event.vehicleBookingId) wird dann erst bei GENEHMIGT angelegt, siehe approveVehicleBooking. Ist
 * keine Adresse hinterlegt, bleibt es beim ursprünglichen Verhalten: sofort GENEHMIGT + Termin.
 */
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

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: data.vehicleId },
    include: { organization: { select: { name: true, shortName: true, fahrzeugReservierungEmail: true } } },
  });
  if (!vehicle || !vehicle.isActive || vehicle.organizationId !== user.homeOrganizationId) {
    return { fieldErrors: { vehicleId: ['Ausgewähltes Fahrzeug ist nicht verfügbar.'] } };
  }

  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);

  const overlap = await findOverlappingBooking(data.vehicleId, startsAt, endsAt);
  if (overlap) {
    return {
      error: `Das Fahrzeug ist in diesem Zeitraum bereits von ${overlap.user.firstName} ${overlap.user.lastName} reserviert.`,
    };
  }

  const approvalEmail = vehicle.organization.fahrzeugReservierungEmail;
  const approvalToken = approvalEmail ? crypto.randomBytes(24).toString('hex') : null;

  const booking = await prisma.vehicleBooking.create({
    data: {
      vehicleId: data.vehicleId,
      userId: user.id,
      startsAt,
      endsAt,
      details: data.details,
      status: approvalEmail ? 'OFFEN' : 'GENEHMIGT',
      approvalToken,
    },
  });

  if (!approvalEmail) {
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
  } else {
    try {
      await sendVehicleBookingApprovalRequest(
        {
          approvalToken: approvalToken!,
          startsAt,
          endsAt,
          details: data.details,
          vehicleTaktischeBezeichnung: vehicle.taktischeBezeichnung,
          vehicleKennzeichen: vehicle.kennzeichen,
          organizationLabel: vehicle.organization.shortName ?? vehicle.organization.name,
          requesterName: user.name,
          requesterEmail: user.email,
        },
        approvalEmail,
      );
    } catch (error) {
      // Ein Mailjet-Ausfall darf die Reservierung selbst nicht verhindern - dieselbe Abwägung wie
      // notify-flight-created.ts/notify-atemschutz-warnung.ts. Der Admin sieht die offene
      // Reservierung trotzdem in der Fahrzeug-Buchungen-Tabelle und kann notfalls direkt Bescheid geben.
      console.error('Freigabe-Anfrage-E-Mail für Fahrzeug-Reservierung fehlgeschlagen:', error);
    }
  }

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/kalender');
  redirect('/meine-feuerwehr');
}

// Die Genehmigen-/Ablehnen-Entscheidung selbst lebt in
// src/lib/heimatfeuerwehr/vehicle-booking-decision.ts (decideVehicleBooking) - eine reine, nicht
// als Server Action markierte lib-Funktion, die direkt beim Laden der jeweiligen öffentlichen Seite
// aufgerufen wird (ein Klick auf den E-Mail-Link reicht), statt hier als zusätzlicher, per Button
// ausgelöster Zwischenschritt zu existieren.

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
  // blind zu löschen. Eine noch OFFENE oder ABGELEHNTE Reservierung hat ohnehin nie einen Termin.
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
