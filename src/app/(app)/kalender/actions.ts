'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import {
  assertPermission,
  canCreateSectionWideEvent,
  canManageDroneGroupFor,
  canManageEventsFor,
} from '@/lib/auth/permissions';
import { eventSchema, parseEventFormData } from '@/lib/validation/event.schema';
import { deleteEventFromGoogleCalendar, pushEventToGoogleCalendar } from '@/lib/calendar/google-calendar-push';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';
import type { SessionUser } from '@/types/next-auth';

export interface EventFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

function revalidateCalendars() {
  revalidatePath('/kalender');
}

/** Der Abschnitt, in dem ein Termin dieser besitzenden Organisation abschnittsweit sichtbar wäre. */
async function resolveAbschnittOrganizationId(organizationId: string): Promise<string> {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { id: true, type: true, parentId: true },
  });
  return getAbschnittOrganizationId(organization);
}

/**
 * Die Drohnengruppe eines Termins kam bislang ungeprüft aus dem Formular (eventSchema hatte dafür nur
 * ein nacktes z.string().nullable()). Da resolveEventAudienceUserIds die Push-Zielgruppe ausschließlich
 * aus event.droneGroupId ableitet, hätte ein direkter Server-Action-Aufruf damit einen beliebigen Text
 * an sämtliche Mitglieder einer fremden Drohnengruppe pushen können. Erlaubt ist die eigene Gruppe
 * (auch als reines Mitglied) oder eine Gruppe, die der Nutzer ohnehin verwalten darf.
 */
async function assertMayUseDroneGroup(user: SessionUser, droneGroupId: string): Promise<void> {
  const group = await prisma.droneGroup.findUnique({
    where: { id: droneGroupId },
    select: { id: true, organizationId: true },
  });
  assertPermission(
    group !== null && (user.droneGroupId === group.id || canManageDroneGroupFor(user, group)),
    'Keine Berechtigung für diese Drohnengruppe.',
  );
}

export async function createEvent(_prevState: EventFormState, formData: FormData): Promise<EventFormState> {
  const user = await requireUser();
  const parsed = eventSchema.safeParse(parseEventFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide) {
    const abschnittOrganizationId = await resolveAbschnittOrganizationId(data.organizationId);
    if (!canCreateSectionWideEvent(user, abschnittOrganizationId)) {
      return { error: 'Keine Berechtigung für Abschnitt-weite Termine in diesem Abschnitt.' };
    }
  }
  if (data.category === 'DROHNENGRUPPE' && data.droneGroupId) {
    await assertMayUseDroneGroup(user, data.droneGroupId);
  }

  const created = await prisma.event.create({
    data: {
      title: data.title,
      description: data.description || null,
      location: data.location || null,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      allDay: data.allDay,
      organizationId: data.organizationId,
      isSectionWide: data.isSectionWide,
      category: data.category,
      droneGroupId: data.category === 'DROHNENGRUPPE' ? data.droneGroupId : null,
      createdById: user.id,
    },
  });
  await pushEventToGoogleCalendar(created);

  revalidateCalendars();
  redirect('/kalender');
}

export async function updateEvent(
  eventId: string,
  _prevState: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const user = await requireUser();
  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) {
    return { error: 'Termin wurde nicht gefunden.' };
  }
  assertPermission(canManageEventsFor(user, existing.organizationId));
  if (existing.isSectionWide) {
    const existingAbschnittOrganizationId = await resolveAbschnittOrganizationId(existing.organizationId);
    if (!canCreateSectionWideEvent(user, existingAbschnittOrganizationId)) {
      return { error: 'Keine Berechtigung, diesen Abschnitt-weiten Termin zu bearbeiten.' };
    }
  }
  if (existing.vehicleBookingId) {
    return { error: 'Dieser Termin gehört zu einer Fahrzeug-Reservierung und kann hier nicht bearbeitet werden.' };
  }
  if (existing.icsUid) {
    return { error: 'Dieser Termin stammt aus einem importierten Kalender und kann hier nicht bearbeitet werden.' };
  }

  const parsed = eventSchema.safeParse(parseEventFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide) {
    const abschnittOrganizationId = await resolveAbschnittOrganizationId(data.organizationId);
    if (!canCreateSectionWideEvent(user, abschnittOrganizationId)) {
      return { error: 'Keine Berechtigung für Abschnitt-weite Termine in diesem Abschnitt.' };
    }
  }
  if (data.category === 'DROHNENGRUPPE' && data.droneGroupId) {
    await assertMayUseDroneGroup(user, data.droneGroupId);
  }

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: {
      title: data.title,
      description: data.description || null,
      location: data.location || null,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      allDay: data.allDay,
      organizationId: data.organizationId,
      isSectionWide: data.isSectionWide,
      category: data.category,
      droneGroupId: data.category === 'DROHNENGRUPPE' ? data.droneGroupId : null,
    },
  });
  await pushEventToGoogleCalendar(updated);

  revalidateCalendars();
  redirect('/kalender');
}

export async function deleteEvent(eventId: string): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.event.findUnique({ where: { id: eventId } });
  if (!existing) {
    redirect('/kalender');
  }
  assertPermission(canManageEventsFor(user, existing.organizationId));
  if (existing.isSectionWide) {
    const abschnittOrganizationId = await resolveAbschnittOrganizationId(existing.organizationId);
    assertPermission(canCreateSectionWideEvent(user, abschnittOrganizationId));
  }
  assertPermission(
    !existing.vehicleBookingId,
    'Dieser Termin gehört zu einer Fahrzeug-Reservierung und kann hier nicht gelöscht werden.',
  );
  assertPermission(
    !existing.icsUid,
    'Dieser Termin stammt aus einem importierten Kalender und kann hier nicht gelöscht werden.',
  );

  await deleteEventFromGoogleCalendar(existing);
  await prisma.event.delete({ where: { id: eventId } });
  revalidateCalendars();
  redirect('/kalender');
}
