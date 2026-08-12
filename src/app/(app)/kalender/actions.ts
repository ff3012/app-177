'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateSectionWideEvent, canManageEvent, canManageEventsFor } from '@/lib/auth/permissions';
import { eventSchema, parseEventFormData } from '@/lib/validation/event.schema';
import { deleteEventFromGoogleCalendar, pushEventToGoogleCalendar } from '@/lib/calendar/google-calendar-push';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';

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

/** Lädt die Drohnengruppe für eine (ggf. null) droneGroupId - null bleibt null (bezirksweit),
 * eine gesetzte id, die nicht mehr existiert, wird ebenfalls zu null (canManageEvent lehnt das dann
 * über den droneGroup===null-Zweig ab, statt mit einem ungefangenen Fehler abzubrechen). */
async function loadDroneGroup(droneGroupId: string | null) {
  if (!droneGroupId) return null;
  return prisma.droneGroup.findUnique({ where: { id: droneGroupId }, select: { id: true, organizationId: true } });
}

export async function createEvent(_prevState: EventFormState, formData: FormData): Promise<EventFormState> {
  const user = await requireUser();
  const parsed = eventSchema.safeParse(parseEventFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.category === 'DROHNENGRUPPE') {
    const droneGroup = await loadDroneGroup(data.droneGroupId);
    if (!canManageEvent(user, data, droneGroup)) {
      return { error: 'Keine Berechtigung, für diese Drohnengruppe Termine anzulegen.' };
    }

    // organizationId/isSectionWide sind für diese Kategorie keine Formularfelder mehr (siehe
    // event-form.tsx) - serverseitig abgeleitet: die Organisation der Gruppe, oder bei bezirksweit
    // (droneGroupId null) der Abschnitt des anlegenden Nutzers, rein als technischer FK-Wert, nicht
    // als Sichtbarkeitskriterium (siehe canViewEvent, das für DROHNENGRUPPE beide Felder ignoriert).
    const organizationId = droneGroup ? droneGroup.organizationId : user.homeAbschnittOrganizationId;

    const created = await prisma.event.create({
      data: {
        title: data.title,
        description: data.description || null,
        location: data.location || null,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        allDay: data.allDay,
        organizationId,
        isSectionWide: false,
        category: data.category,
        droneGroupId: data.droneGroupId,
        createdById: user.id,
      },
    });
    await pushEventToGoogleCalendar(created);

    revalidateCalendars();
    redirect('/kalender');
  }

  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide) {
    const abschnittOrganizationId = await resolveAbschnittOrganizationId(data.organizationId);
    if (!canCreateSectionWideEvent(user, abschnittOrganizationId)) {
      return { error: 'Keine Berechtigung für Abschnitt-weite Termine in diesem Abschnitt.' };
    }
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
      droneGroupId: null,
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

  if (existing.category === 'DROHNENGRUPPE') {
    const existingDroneGroup = await loadDroneGroup(existing.droneGroupId);
    assertPermission(canManageEvent(user, existing, existingDroneGroup));
  } else {
    assertPermission(canManageEventsFor(user, existing.organizationId));
    if (existing.isSectionWide) {
      const existingAbschnittOrganizationId = await resolveAbschnittOrganizationId(existing.organizationId);
      if (!canCreateSectionWideEvent(user, existingAbschnittOrganizationId)) {
        return { error: 'Keine Berechtigung, diesen Abschnitt-weiten Termin zu bearbeiten.' };
      }
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

  if (data.category === 'DROHNENGRUPPE') {
    const droneGroup = await loadDroneGroup(data.droneGroupId);
    if (!canManageEvent(user, data, droneGroup)) {
      return { error: 'Keine Berechtigung, für diese Drohnengruppe Termine anzulegen.' };
    }

    // Bewusst NICHT user.homeAbschnittOrganizationId wie bei createEvent: bei einer Bearbeitung gibt
    // es bereits einen bestehenden Datensatz (existing), dessen organizationId beibehalten werden muss
    // - sonst würde jede Bearbeitung eines bezirksweiten Termins durch einen ANDEREN Bezirksadmin/
    // Bezirks-Drohnenadmin dessen Anker-Abschnitt auf den des jeweils speichernden Nutzers verschieben.
    const organizationId = droneGroup ? droneGroup.organizationId : existing.organizationId;
    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        title: data.title,
        description: data.description || null,
        location: data.location || null,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        allDay: data.allDay,
        organizationId,
        isSectionWide: false,
        category: data.category,
        droneGroupId: data.droneGroupId,
      },
    });
    await pushEventToGoogleCalendar(updated);

    revalidateCalendars();
    redirect('/kalender');
  }

  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide) {
    const abschnittOrganizationId = await resolveAbschnittOrganizationId(data.organizationId);
    if (!canCreateSectionWideEvent(user, abschnittOrganizationId)) {
      return { error: 'Keine Berechtigung für Abschnitt-weite Termine in diesem Abschnitt.' };
    }
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
      droneGroupId: null,
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

  if (existing.category === 'DROHNENGRUPPE') {
    const droneGroup = await loadDroneGroup(existing.droneGroupId);
    assertPermission(canManageEvent(user, existing, droneGroup));
  } else {
    assertPermission(canManageEventsFor(user, existing.organizationId));
    if (existing.isSectionWide) {
      const abschnittOrganizationId = await resolveAbschnittOrganizationId(existing.organizationId);
      assertPermission(canCreateSectionWideEvent(user, abschnittOrganizationId));
    }
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
