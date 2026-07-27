'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageDroneFlights } from '@/lib/auth/permissions';
import { flightSchema, parseFlightFormData } from '@/lib/validation/flight.schema';

export interface FlightFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export async function createFlight(_prevState: FlightFormState, formData: FormData): Promise<FlightFormState> {
  const user = await requireUser();
  if (!canManageDroneFlights(user)) {
    return { error: 'Keine Berechtigung, Flüge zu registrieren.' };
  }

  const parsed = flightSchema.safeParse(parseFlightFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  await prisma.droneFlight.create({
    data: {
      startsAt: new Date(data.startsAt),
      pilotName: data.pilotName,
      location: data.location,
      droneId: data.droneId,
      purpose: data.purpose,
      notes: data.notes || null,
      registeredById: user.id,
    },
  });

  revalidatePath('/drohnen');
  redirect('/drohnen');
}

export async function updateFlight(
  flightId: string,
  _prevState: FlightFormState,
  formData: FormData,
): Promise<FlightFormState> {
  const user = await requireUser();
  assertPermission(canManageDroneFlights(user));

  const existing = await prisma.droneFlight.findUnique({ where: { id: flightId } });
  if (!existing) {
    return { error: 'Flug wurde nicht gefunden.' };
  }

  const parsed = flightSchema.safeParse(parseFlightFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  await prisma.droneFlight.update({
    where: { id: flightId },
    data: {
      startsAt: new Date(data.startsAt),
      pilotName: data.pilotName,
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
  assertPermission(canManageDroneFlights(user));

  await prisma.droneFlight.delete({ where: { id: flightId } }).catch(() => null);
  revalidatePath('/drohnen');
  redirect('/drohnen');
}
