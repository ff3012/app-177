'use server';

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor, canManageVehicleBooking } from '@/lib/auth/permissions';
import { vehicleBookingSchema, parseVehicleBookingFormData } from '@/lib/validation/vehicle-booking.schema';
import { findOverlappingBooking } from '@/lib/heimatfeuerwehr/vehicle-availability';
import {
  sendVehicleBookingApprovalRequest,
  sendVehicleBookingAdminInfoEmail,
  sendVehicleBookingDriverNotificationEmail,
} from '@/lib/heimatfeuerwehr/notify-vehicle-booking';
import { deleteEventFromGoogleCalendar, pushEventToGoogleCalendar } from '@/lib/calendar/google-calendar-push';

export interface VehicleBookingFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

/**
 * Legt eine Fahrzeug-Reservierung an. Sind für die Feuerwehr `fahrzeugReservierungEmails`
 * hinterlegt, startet die Reservierung als OFFEN und braucht erst eine Freigabe (Genehmigen/
 * Ablehnen-Mail an diese Adressen, siehe notify-vehicle-booking.ts) - der verknüpfte Kalender-Termin
 * (Event.vehicleBookingId) wird dann erst bei GENEHMIGT angelegt, siehe approveVehicleBooking. Ist
 * keine Adresse hinterlegt (leeres Array), bleibt es beim ursprünglichen Verhalten: sofort GENEHMIGT
 * + Termin.
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
    include: { organization: { select: { name: true, shortName: true, fahrzeugReservierungEmails: true } } },
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

  // Stellvertretende Buchung: nur wenn ein anderer Wert als die eigene ID übermittelt wurde UND
  // der handelnde Nutzer tatsächlich Admin dieser Feuerwehr ist - serverseitig erneut geprüft,
  // nie nur der Formular-UI vertraut. Siehe docs/superpowers/specs/2026-08-28-
  // fahrzeugreservierung-admin-stellvertretend-design.md.
  const bookingForUserIdRaw = formData.get('bookingForUserId');
  const bookingForUserId =
    typeof bookingForUserIdRaw === 'string' && bookingForUserIdRaw.length > 0 ? bookingForUserIdRaw : null;
  const isOnBehalfOf = bookingForUserId !== null && bookingForUserId !== user.id;

  if (isOnBehalfOf) {
    if (!canManageHeimatfeuerwehrFor(user, vehicle.organizationId)) {
      return { error: 'Keine Berechtigung, für ein anderes Mitglied zu reservieren.' };
    }

    const driver = await prisma.user.findUnique({
      where: { id: bookingForUserId! },
      select: { id: true, firstName: true, lastName: true, email: true, homeOrganizationId: true },
    });
    if (!driver || driver.homeOrganizationId !== vehicle.organizationId) {
      return { error: 'Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.' };
    }

    const driverName = `${driver.firstName} ${driver.lastName}`;
    const organizationLabel = vehicle.organization.shortName ?? vehicle.organization.name;

    const booking = await prisma.vehicleBooking.create({
      data: {
        vehicleId: data.vehicleId,
        userId: driver.id,
        bookedByAdminId: user.id,
        startsAt,
        endsAt,
        details: data.details,
        status: 'GENEHMIGT',
      },
    });

    const bookingEvent = await prisma.event.create({
      data: {
        title: `Fahrzeug: ${vehicle.taktischeBezeichnung} (${driverName})`,
        startsAt,
        endsAt,
        organizationId: vehicle.organizationId,
        isSectionWide: false,
        category: 'ALLGEMEIN',
        createdById: user.id,
        vehicleBookingId: booking.id,
      },
    });
    await pushEventToGoogleCalendar(bookingEvent);

    const emailCtx = {
      startsAt,
      endsAt,
      details: data.details,
      vehicleTaktischeBezeichnung: vehicle.taktischeBezeichnung,
      vehicleKennzeichen: vehicle.kennzeichen,
      organizationLabel,
      adminName: user.name,
      driverName,
      driverEmail: driver.email,
    };
    await sendVehicleBookingAdminInfoEmail(emailCtx, vehicle.organization.fahrzeugReservierungEmails);
    await sendVehicleBookingDriverNotificationEmail(emailCtx);

    revalidatePath('/meine-feuerwehr');
    revalidatePath('/kalender');
    redirect('/meine-feuerwehr');
  }

  const approvalEmails = vehicle.organization.fahrzeugReservierungEmails;
  const needsApproval = approvalEmails.length > 0;
  const approvalToken = needsApproval ? crypto.randomBytes(24).toString('hex') : null;

  const booking = await prisma.vehicleBooking.create({
    data: {
      vehicleId: data.vehicleId,
      userId: user.id,
      startsAt,
      endsAt,
      details: data.details,
      status: needsApproval ? 'OFFEN' : 'GENEHMIGT',
      approvalToken,
    },
  });

  if (!needsApproval) {
    const bookingEvent = await prisma.event.create({
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
    await pushEventToGoogleCalendar(bookingEvent);
  } else {
    // sendVehicleBookingApprovalRequest versendet pro Empfänger einzeln und fängt Mailjet-Fehler
    // bereits selbst ab (wirft nie) - ein Ausfall darf die Reservierung selbst nicht verhindern,
    // dieselbe Abwägung wie notify-flight-created.ts/notify-atemschutz-warnung.ts. Der Admin sieht
    // die offene Reservierung trotzdem in der Fahrzeug-Buchungen-Tabelle und kann notfalls direkt
    // Bescheid geben.
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
      approvalEmails,
    );
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
    await deleteEventFromGoogleCalendar(linkedEvent);
    await prisma.event.delete({ where: { id: linkedEvent.id } });
  }

  await prisma.vehicleBooking.delete({ where: { id: bookingId } });
  revalidatePath('/meine-feuerwehr');
  revalidatePath('/admin/heimatfeuerwehr');
  revalidatePath('/kalender');
  redirect(safeRedirectTo);
}
