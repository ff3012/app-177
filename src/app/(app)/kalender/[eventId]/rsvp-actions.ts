'use server';

import { revalidatePath } from 'next/cache';
import { ZusageStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageEventsFor, canViewEvent } from '@/lib/auth/permissions';
import { rsvpSchema } from '@/lib/validation/rsvp.schema';
import { sendEventPushNow } from '@/lib/push/send-event-push';

export interface RsvpActionState {
  error?: string;
  success?: boolean;
}

/** Setzt (bzw. aktualisiert) die eigene Zusage zu einem Termin. Direkt aus Client-Code aufrufbar, kein FormData nötig. */
export async function setRsvp(eventId: string, status: ZusageStatus, note?: string): Promise<RsvpActionState> {
  const user = await requireUser();
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return { error: 'Termin wurde nicht gefunden.' };
  }
  assertPermission(canViewEvent(user, event));
  // Verteidigung in der Tiefe: die UI (kalender/[eventId]/page.tsx, home-todo-list.tsx) bietet für
  // Fahrzeug-Reservierungs-Termine schon gar keine Zusage-Buttons an, aber diese Aktion selbst
  // prüfte das bislang nicht - derselbe "jede Aktion prüft selbst"-Grundsatz wie bei
  // updateEvent/deleteEvent (kalender/actions.ts).
  assertPermission(
    !event.vehicleBookingId,
    'Für Fahrzeug-Reservierungs-Termine gibt es keine Zusage.',
  );

  const parsed = rsvpSchema.safeParse({ status, note });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };
  }

  // note bewusst nur anfassen, wenn explizit übergeben - ein schneller Status-Klick aus der
  // Kalenderübersicht (ohne Notizfeld) soll eine bereits über die Detailseite gespeicherte Notiz
  // nicht stillschweigend löschen.
  const noteProvided = note !== undefined;

  await prisma.terminZusage.upsert({
    where: { eventId_userId: { eventId, userId: user.id } },
    create: { eventId, userId: user.id, status: parsed.data.status, note: noteProvided ? parsed.data.note || null : null },
    update: { status: parsed.data.status, ...(noteProvided ? { note: parsed.data.note || null } : {}) },
  });

  revalidatePath('/kalender');
  revalidatePath(`/kalender/${eventId}`);
  return { success: true };
}

export interface EventPushActionState {
  error?: string;
  success?: boolean;
  sent?: number;
  recipients?: number;
}

/**
 * Löst sofort eine Push-Benachrichtigung mit Termindetails aus. Berechtigung wie beim
 * Bearbeiten/Löschen des Termins selbst (canManageEventsFor) - jeder Admin der besitzenden
 * Organisation kann also für seine eigenen Termine Push auslösen, nicht nur der
 * Abschnittskommando-Admin (bewusst anders als canManageNews im News-Modul).
 */
export async function triggerEventPushNotification(eventId: string): Promise<EventPushActionState> {
  const user = await requireUser();

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return { error: 'Termin wurde nicht gefunden.' };
  }
  assertPermission(canManageEventsFor(user, event.organizationId));

  try {
    const { sent, recipients } = await sendEventPushNow(event);
    return { success: true, sent, recipients };
  } catch (error) {
    console.error('Push-Benachrichtigung für Termin fehlgeschlagen:', error);
    return { error: 'Push-Benachrichtigung konnte nicht gesendet werden. Bitte VAPID-Konfiguration prüfen.' };
  }
}
