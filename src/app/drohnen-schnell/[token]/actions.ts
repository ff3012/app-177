'use server';

import { prisma } from '@/lib/db/prisma';
import { flightSchema, parseFlightFormData } from '@/lib/validation/flight.schema';
import { getDroneQuickRegisterToken } from '@/lib/settings';
import { getOrCreateQuickRegisterUser } from '@/lib/drone/quick-register-user';
import { notifyDroneFlightCreated } from '@/lib/drone/notify-flight-created';

export interface QuickFlightFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

async function isDrohnengruppeMemberId(userId: string): Promise<boolean> {
  const membership = await prisma.drohnengruppeMembership.findUnique({ where: { userId } });
  return Boolean(membership);
}

/**
 * Erstellt einen Flug über den öffentlichen QR-Code-Link – bewusst OHNE requireUser()/Session,
 * dafür mit erneuter serverseitiger Token-Prüfung (das Formular selbst erscheint nur bei
 * gültigem Token, siehe page.tsx, aber die Server Action vertraut dem Client nicht blind).
 * Kein Zugriff auf bestehende Flüge oder andere Daten möglich – nur das Anlegen eines Flugs.
 */
export async function registerFlightViaQuickLink(
  token: string,
  _prevState: QuickFlightFormState,
  formData: FormData,
): Promise<QuickFlightFormState> {
  const storedToken = await getDroneQuickRegisterToken();
  if (!storedToken || token !== storedToken) {
    return { error: 'Dieser Link ist ungültig oder wurde deaktiviert.' };
  }

  const parsed = flightSchema.safeParse(parseFlightFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (!(await isDrohnengruppeMemberId(data.pilotUserId))) {
    return { fieldErrors: { pilotUserId: ['Ausgewählter Pilot ist kein Mitglied der Drohnengruppe.'] } };
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

  await notifyDroneFlightCreated(flight);

  return { success: true };
}
