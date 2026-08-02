'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateSectionWideEvent, canManageEventsFor } from '@/lib/auth/permissions';
import { eventSchema, parseEventFormData } from '@/lib/validation/event.schema';

export interface EventFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

function revalidateCalendars() {
  revalidatePath('/kalender');
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
  if (data.isSectionWide && !canCreateSectionWideEvent(user)) {
    return { error: 'Keine Berechtigung für Abschnitt-weite Termine.' };
  }

  await prisma.event.create({
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
      createdById: user.id,
    },
  });

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
  if (existing.isSectionWide && !canCreateSectionWideEvent(user)) {
    return { error: 'Keine Berechtigung, diesen Abschnitt-weiten Termin zu bearbeiten.' };
  }
  if (existing.vehicleBookingId) {
    return { error: 'Dieser Termin gehört zu einer Fahrzeug-Buchung und kann hier nicht bearbeitet werden.' };
  }

  const parsed = eventSchema.safeParse(parseEventFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (!canManageEventsFor(user, data.organizationId)) {
    return { error: 'Keine Berechtigung, für diese Organisation Termine anzulegen.' };
  }
  if (data.isSectionWide && !canCreateSectionWideEvent(user)) {
    return { error: 'Keine Berechtigung für Abschnitt-weite Termine.' };
  }

  await prisma.event.update({
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
    },
  });

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
    assertPermission(canCreateSectionWideEvent(user));
  }
  assertPermission(
    !existing.vehicleBookingId,
    'Dieser Termin gehört zu einer Fahrzeug-Buchung und kann hier nicht gelöscht werden.',
  );

  await prisma.event.delete({ where: { id: eventId } });
  revalidateCalendars();
  redirect('/kalender');
}
