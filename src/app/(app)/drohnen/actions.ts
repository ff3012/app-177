'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageFlight, canRegisterFlight } from '@/lib/auth/permissions';
import { flightSchema, parseFlightFormData } from '@/lib/validation/flight.schema';
import { getDroneFlightNotificationEmail } from '@/lib/settings';
import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';

export interface FlightFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

const PURPOSE_LABEL: Record<string, string> = {
  UEBUNG: 'Übung',
  EINSATZ: 'Einsatz',
};

type NewFlightForNotification = {
  startsAt: Date;
  location: string;
  purpose: string;
  drone: { name: string };
  pilotUser: { firstName: string; lastName: string };
  registeredBy: { firstName: string; lastName: string };
};

async function notifyDroneFlightCreated(flight: NewFlightForNotification): Promise<void> {
  const recipient = await getDroneFlightNotificationEmail();
  if (!recipient) return;

  const dateLabel = flight.startsAt.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  const purposeLabel = PURPOSE_LABEL[flight.purpose] ?? flight.purpose;
  const pilotName = `${flight.pilotUser.firstName} ${flight.pilotUser.lastName}`;
  const registeredByName = `${flight.registeredBy.firstName} ${flight.registeredBy.lastName}`;

  try {
    await sendEmail({
      to: recipient,
      subject: `Neuer Drohnenflug: ${pilotName} am ${dateLabel}`,
      textPart: [
        'Ein neuer Drohnenflug wurde registriert.',
        '',
        `Datum/Uhrzeit: ${dateLabel}`,
        `Pilot: ${pilotName}`,
        `Ort: ${flight.location}`,
        `Drohne: ${flight.drone.name}`,
        `Zweck: ${purposeLabel}`,
        `Erfasst von: ${registeredByName}`,
      ].join('\n'),
      htmlPart: `<p>Ein neuer Drohnenflug wurde registriert.</p><ul>
        <li><b>Datum/Uhrzeit:</b> ${escapeHtml(dateLabel)}</li>
        <li><b>Pilot:</b> ${escapeHtml(pilotName)}</li>
        <li><b>Ort:</b> ${escapeHtml(flight.location)}</li>
        <li><b>Drohne:</b> ${escapeHtml(flight.drone.name)}</li>
        <li><b>Zweck:</b> ${escapeHtml(purposeLabel)}</li>
        <li><b>Erfasst von:</b> ${escapeHtml(registeredByName)}</li>
      </ul>`,
    });
  } catch (error) {
    console.error('Benachrichtigung für neuen Drohnenflug fehlgeschlagen:', error);
  }
}

async function isDrohnengruppeMemberId(userId: string): Promise<boolean> {
  const membership = await prisma.drohnengruppeMembership.findUnique({ where: { userId } });
  return Boolean(membership);
}

export async function createFlight(_prevState: FlightFormState, formData: FormData): Promise<FlightFormState> {
  const user = await requireUser();
  if (!canRegisterFlight(user)) {
    return { error: 'Keine Berechtigung, Flüge zu registrieren.' };
  }

  const parsed = flightSchema.safeParse(parseFlightFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (!(await isDrohnengruppeMemberId(data.pilotUserId))) {
    return { fieldErrors: { pilotUserId: ['Ausgewählter Pilot ist kein Mitglied der Drohnengruppe.'] } };
  }

  const flight = await prisma.droneFlight.create({
    data: {
      startsAt: new Date(data.startsAt),
      pilotUserId: data.pilotUserId,
      location: data.location,
      droneId: data.droneId,
      purpose: data.purpose,
      notes: data.notes || null,
      registeredById: user.id,
    },
    include: { drone: true, pilotUser: true, registeredBy: true },
  });

  await notifyDroneFlightCreated(flight);

  revalidatePath('/drohnen');
  redirect('/drohnen');
}

export async function updateFlight(
  flightId: string,
  _prevState: FlightFormState,
  formData: FormData,
): Promise<FlightFormState> {
  const user = await requireUser();

  const existing = await prisma.droneFlight.findUnique({ where: { id: flightId } });
  if (!existing) {
    return { error: 'Flug wurde nicht gefunden.' };
  }
  assertPermission(canManageFlight(user, existing));

  const parsed = flightSchema.safeParse(parseFlightFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (!(await isDrohnengruppeMemberId(data.pilotUserId))) {
    return { fieldErrors: { pilotUserId: ['Ausgewählter Pilot ist kein Mitglied der Drohnengruppe.'] } };
  }

  await prisma.droneFlight.update({
    where: { id: flightId },
    data: {
      startsAt: new Date(data.startsAt),
      pilotUserId: data.pilotUserId,
      location: data.location,
      droneId: data.droneId,
      purpose: data.purpose,
      notes: data.notes || null,
    },
  });

  revalidatePath('/drohnen');
  redirect('/drohnen');
}

export async function deleteFlight(flightId: string): Promise<void> {
  const user = await requireUser();

  const existing = await prisma.droneFlight.findUnique({ where: { id: flightId } });
  if (!existing) {
    redirect('/drohnen');
  }
  assertPermission(canManageFlight(user, existing));

  await prisma.droneFlight.delete({ where: { id: flightId } });
  revalidatePath('/drohnen');
  redirect('/drohnen');
}
