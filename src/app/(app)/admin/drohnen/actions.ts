'use server';

import { randomBytes } from 'crypto';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageDroneGroupFor } from '@/lib/auth/permissions';

async function requireDroneGroupAccess(droneGroupId: string) {
  const user = await requireUser();
  const droneGroup = await prisma.droneGroup.findUniqueOrThrow({ where: { id: droneGroupId } });
  assertPermission(canManageDroneGroupFor(user, droneGroup));
  return { user, droneGroup };
}

export interface DroneFormState {
  error?: string;
}

export async function createDrone(
  droneGroupId: string,
  _prevState: DroneFormState,
  formData: FormData,
): Promise<DroneFormState> {
  await requireDroneGroupAccess(droneGroupId);

  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    return { error: 'Name ist erforderlich.' };
  }

  // Eindeutigkeit ist PRO Gruppe (Drone.@@unique([droneGroupId, name]), Task 9 Review-Fix) - eine
  // globale Suche wäre nicht nur falsch (zwei Gruppen dürfen dieselbe Drohnenbezeichnung haben),
  // sondern hätte einer fremden Gruppe gegenüber auch verraten, dass sie bereits eine Drohne mit
  // diesem Namen hat (Existence-Oracle).
  const existing = await prisma.drone.findUnique({ where: { droneGroupId_name: { droneGroupId, name } } });
  if (existing) {
    return { error: 'Eine Drohne mit diesem Namen existiert bereits.' };
  }

  const count = await prisma.drone.count({ where: { droneGroupId } });
  await prisma.drone.create({ data: { name, sortOrder: count, droneGroupId } });

  revalidatePath('/admin/drohnen');
  return {};
}

export async function renameDrone(
  droneId: string,
  _prevState: DroneFormState,
  formData: FormData,
): Promise<DroneFormState> {
  const drone = await prisma.drone.findUniqueOrThrow({ where: { id: droneId } });
  await requireDroneGroupAccess(drone.droneGroupId);

  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    return { error: 'Name ist erforderlich.' };
  }

  // Siehe Kommentar in createDrone oben - Eindeutigkeit ist PRO Gruppe, nicht global.
  const existing = await prisma.drone.findUnique({
    where: { droneGroupId_name: { droneGroupId: drone.droneGroupId, name } },
  });
  if (existing && existing.id !== droneId) {
    return { error: 'Eine Drohne mit diesem Namen existiert bereits.' };
  }

  await prisma.drone.update({ where: { id: droneId }, data: { name } });
  revalidatePath('/admin/drohnen');
  return {};
}

export async function toggleDroneActive(droneId: string): Promise<void> {
  const drone = await prisma.drone.findUniqueOrThrow({ where: { id: droneId } });
  await requireDroneGroupAccess(drone.droneGroupId);

  await prisma.drone.update({ where: { id: droneId }, data: { isActive: !drone.isActive } });
  revalidatePath('/admin/drohnen');
}

export interface DeleteDroneState {
  error?: string;
}

/** Löschen ist nur möglich, wenn keine DroneFlight-Zeile auf diese Drohne verweist (auch keine
 * vergangenen) - derselbe proaktive Count-Check statt eines rohen FK-Fehlers wie bei deleteVehicle
 * in admin/heimatfeuerwehr/actions.ts. Gibt eine konkrete, count-spezifische Fehlermeldung zurück,
 * die stattdessen zum Deaktivieren rät. */
export async function deleteDrone(droneId: string): Promise<DeleteDroneState> {
  const drone = await prisma.drone.findUniqueOrThrow({ where: { id: droneId } });
  await requireDroneGroupAccess(drone.droneGroupId);

  const flightCount = await prisma.droneFlight.count({ where: { droneId } });
  if (flightCount > 0) {
    return {
      error: `Diese Drohne hat ${flightCount} ${flightCount === 1 ? 'Flug' : 'Flüge'} und kann nicht gelöscht werden - stattdessen deaktivieren.`,
    };
  }

  await prisma.drone.delete({ where: { id: droneId } });
  revalidatePath('/admin/drohnen');
  return {};
}

export async function regenerateQuickRegisterLink(droneGroupId: string): Promise<void> {
  await requireDroneGroupAccess(droneGroupId);

  const token = randomBytes(24).toString('hex');
  await prisma.droneGroup.update({ where: { id: droneGroupId }, data: { qrToken: token } });
  revalidatePath('/admin/drohnen');
}

export interface DroneGroupEmailState {
  success?: boolean;
  error?: string;
}

const flightNotificationEmailSchema = z.union([z.literal(''), z.string().trim().email('Ungültige E-Mail-Adresse.')]);

/**
 * Ersetzt die frühere singleton-weite `saveDroneFlightEmail` (admin/email) - jede Drohnengruppe hat
 * jetzt ihre eigene Benachrichtigungsadresse (DroneGroup.flightNotificationEmail). Leere Eingabe ist
 * gültig (= keine Benachrichtigung für diese Gruppe), gleiches Muster wie
 * setAtemschutzSachbearbeiter/setFahrzeugReservierungEmail in admin/heimatfeuerwehr/actions.ts.
 */
export async function setFlightNotificationEmail(
  droneGroupId: string,
  _prevState: DroneGroupEmailState,
  formData: FormData,
): Promise<DroneGroupEmailState> {
  await requireDroneGroupAccess(droneGroupId);

  const parsed = flightNotificationEmailSchema.safeParse(formData.get('email'));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige E-Mail-Adresse.' };
  }

  await prisma.droneGroup.update({
    where: { id: droneGroupId },
    data: { flightNotificationEmail: parsed.data || null },
  });

  revalidatePath('/admin/drohnen');
  return { success: true };
}

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export interface DroneDocumentFormState {
  error?: string;
}

export async function uploadDroneDocument(
  droneGroupId: string,
  _prevState: DroneDocumentFormState,
  formData: FormData,
): Promise<DroneDocumentFormState> {
  const { user } = await requireDroneGroupAccess(droneGroupId);

  const title = String(formData.get('title') ?? '').trim();
  const file = formData.get('file');

  if (!title) {
    return { error: 'Titel ist erforderlich.' };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Bitte eine PDF-Datei auswählen.' };
  }
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return { error: 'Nur PDF-Dateien sind erlaubt.' };
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return { error: 'Die Datei ist zu groß (maximal 10 MB).' };
  }

  const data = Buffer.from(await file.arrayBuffer());
  await prisma.droneDocument.create({
    data: {
      title,
      filename: file.name,
      sizeBytes: file.size,
      data,
      uploadedById: user.id,
      droneGroupId,
    },
  });

  revalidatePath('/admin/drohnen');
  revalidatePath('/drohnen/unterlagen');
  return {};
}

export async function deleteDroneDocument(documentId: string): Promise<void> {
  const doc = await prisma.droneDocument.findUniqueOrThrow({ where: { id: documentId } });
  await requireDroneGroupAccess(doc.droneGroupId);

  await prisma.droneDocument.delete({ where: { id: documentId } });
  revalidatePath('/admin/drohnen');
  revalidatePath('/drohnen/unterlagen');
}
