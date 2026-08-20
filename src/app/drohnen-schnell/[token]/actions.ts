'use server';

import { prisma } from '@/lib/db/prisma';
import { flightSchema, parseFlightFormData } from '@/lib/validation/flight.schema';
import { getOrCreateQuickRegisterUser } from '@/lib/drone/quick-register-user';
import { notifyDroneFlightCreated } from '@/lib/drone/notify-flight-created';
import { isEligiblePilot, isActiveDrone } from '@/lib/drone/members';

export interface QuickFlightFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

/**
 * Erstellt einen Flug über den öffentlichen QR-Code-Link – bewusst OHNE requireUser()/Session,
 * dafür mit erneuter serverseitiger Token-Prüfung (das Formular selbst erscheint nur bei
 * gültigem Token, siehe page.tsx, aber die Server Action vertraut dem Client nicht blind).
 * Kein Zugriff auf bestehende Flüge oder andere Daten möglich – nur das Anlegen eines Flugs, und
 * ausschließlich innerhalb der Gruppe, deren qrToken der Link trägt.
 */
export async function registerFlightViaQuickLink(
  token: string,
  _prevState: QuickFlightFormState,
  formData: FormData,
): Promise<QuickFlightFormState> {
  const droneGroup = await prisma.droneGroup.findUnique({ where: { qrToken: token } });
  if (!droneGroup) {
    return { error: 'Dieser Link ist ungültig oder wurde deaktiviert.' };
  }

  const parsed = flightSchema.safeParse(parseFlightFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (!(await isEligiblePilot(data.pilotUserId, droneGroup.id))) {
    return { fieldErrors: { pilotUserId: ['Ausgewählter Pilot ist kein aktives Mitglied dieser Drohnengruppe.'] } };
  }

  if (!(await isActiveDrone(data.droneId, droneGroup.id))) {
    return { fieldErrors: { droneId: ['Ausgewählte Drohne ist nicht aktiv oder gehört nicht zu dieser Gruppe.'] } };
  }

  const systemUser = await getOrCreateQuickRegisterUser();

  const flight = await prisma.droneFlight.create({
    data: {
      startsAt: new Date(data.startsAt),
      pilotUserId: data.pilotUserId,
      location: data.location,
      droneId: data.droneId,
      purpose: data.purpose,
      notes: data.notes || null,
      registeredById: systemUser.id,
    },
    include: { drone: true, pilotUser: true, registeredBy: true },
  });

  await notifyDroneFlightCreated(flight, droneGroup.flightNotificationEmails);

  return { success: true };
}
