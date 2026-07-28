'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageFlight, canRegisterFlight } from '@/lib/auth/permissions';
import { flightSchema, parseFlightFormData } from '@/lib/validation/flight.schema';
import { notifyDroneFlightCreated } from '@/lib/drone/notify-flight-created';

export interface FlightFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
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
