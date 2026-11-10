'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageFlight, canRegisterFlightFor } from '@/lib/auth/permissions';
import { flightSchema, parseFlightFormData } from '@/lib/validation/flight.schema';
import { notifyDroneFlightCreated } from '@/lib/drone/notify-flight-created';
import { isEligiblePilot, isActiveDrone } from '@/lib/drone/members';
import { resolveLinkableChecklist } from '@/lib/drone/checklist/queries';

export interface FlightFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export async function createFlight(
  droneGroupId: string,
  _prevState: FlightFormState,
  formData: FormData,
): Promise<FlightFormState> {
  const user = await requireUser();
  const droneGroup = await prisma.droneGroup.findUnique({ where: { id: droneGroupId } });
  if (!droneGroup || !canRegisterFlightFor(user, droneGroup)) {
    return { error: 'Keine Berechtigung, Flüge für diese Drohnengruppe zu registrieren.' };
  }

  const parsed = flightSchema.safeParse(parseFlightFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (!(await isEligiblePilot(data.pilotUserId, droneGroupId))) {
    return { fieldErrors: { pilotUserId: ['Ausgewählter Pilot ist kein aktives Mitglied der Drohnengruppe.'] } };
  }

  if (!(await isActiveDrone(data.droneId, droneGroupId))) {
    return { fieldErrors: { droneId: ['Ausgewählte Drohne ist nicht aktiv.'] } };
  }

  // Checkliste verknüpfen: nur wenn mitgeschickt (Funktionsschalter an) und für diesen Benutzer sichtbar -
  // die Id kommt vom Client und wird deshalb serverseitig neu geprüft.
  const checklistId = data.checklistId || null;
  if (checklistId && !(await resolveLinkableChecklist(user, droneGroupId, checklistId))) {
    return { fieldErrors: { checklistId: ['Die gewählte Checkliste ist nicht verfügbar.'] } };
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
      checklistId,
    },
    include: { drone: true, pilotUser: true, registeredBy: true },
  });

  await notifyDroneFlightCreated(flight, droneGroup.flightNotificationEmails);

  revalidatePath('/drohnen');
  redirect('/drohnen');
}

export async function updateFlight(
  flightId: string,
  _prevState: FlightFormState,
  formData: FormData,
): Promise<FlightFormState> {
  const user = await requireUser();

  const existing = await prisma.droneFlight.findUnique({
    where: { id: flightId },
    include: { drone: { include: { droneGroup: true } } },
  });
  if (!existing) {
    return { error: 'Flug wurde nicht gefunden.' };
  }
  assertPermission(
    canManageFlight(user, {
      registeredById: existing.registeredById,
      droneGroupId: existing.drone.droneGroupId,
      organizationId: existing.drone.droneGroup.organizationId,
    }),
  );
  // Gruppenzugehörigkeit des Flugs ist über seine (unveränderliche) ursprüngliche Drohne definiert -
  // bewusst nicht user.droneGroupId, da ein Flug beim Bearbeiten innerhalb seiner eigenen Gruppe
  // bleiben muss, unabhängig davon, wer ihn gerade bearbeitet (siehe canManageFlight, das Admin
  // Drohnengruppe unabhängig von der Gruppe zulässt).
  const droneGroupId = existing.drone.droneGroupId;

  const parsed = flightSchema.safeParse(parseFlightFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (!(await isEligiblePilot(data.pilotUserId, droneGroupId))) {
    return { fieldErrors: { pilotUserId: ['Ausgewählter Pilot ist kein aktives Mitglied der Drohnengruppe.'] } };
  }

  if (!(await isActiveDrone(data.droneId, droneGroupId))) {
    return { fieldErrors: { droneId: ['Ausgewählte Drohne ist nicht aktiv.'] } };
  }

  // Das Feld fehlt im Formular, wenn die Gruppe keine Checkliste nutzt - dann bleibt die Verknüpfung unverändert.
  const checklistId = data.checklistId === undefined ? undefined : data.checklistId || null;
  if (checklistId && !(await resolveLinkableChecklist(user, droneGroupId, checklistId))) {
    return { fieldErrors: { checklistId: ['Die gewählte Checkliste ist nicht verfügbar.'] } };
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
      ...(checklistId !== undefined ? { checklistId } : {}),
    },
  });

  revalidatePath('/drohnen');
  redirect('/drohnen');
}

export async function deleteFlight(flightId: string): Promise<void> {
  const user = await requireUser();

  const existing = await prisma.droneFlight.findUnique({
    where: { id: flightId },
    include: { drone: { include: { droneGroup: true } } },
  });
  if (!existing) {
    redirect('/drohnen');
  }
  assertPermission(
    canManageFlight(user, {
      registeredById: existing.registeredById,
      droneGroupId: existing.drone.droneGroupId,
      organizationId: existing.drone.droneGroup.organizationId,
    }),
  );

  await prisma.droneFlight.delete({ where: { id: flightId } });
  revalidatePath('/drohnen');
  redirect('/drohnen');
}
