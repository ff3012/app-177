'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, isSiteAdmin } from '@/lib/auth/permissions';
import { generateDroneQuickRegisterToken } from '@/lib/settings';

export interface DroneFormState {
  error?: string;
}

export async function createDrone(_prevState: DroneFormState, formData: FormData): Promise<DroneFormState> {
  const user = await requireUser();
  assertPermission(isSiteAdmin(user));

  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    return { error: 'Name ist erforderlich.' };
  }

  const existing = await prisma.drone.findUnique({ where: { name } });
  if (existing) {
    return { error: 'Eine Drohne mit diesem Namen existiert bereits.' };
  }

  const count = await prisma.drone.count();
  // Vorläufig: bis Task 9 dieses Modul auf echtes Gruppen-Scoping umstellt, gibt es genau eine
  // Drohnengruppe im ganzen System (siehe Task 2 Backfill) - jede neu angelegte Drohne gehört dazu.
  const droneGroup = await prisma.droneGroup.findFirstOrThrow();
  await prisma.drone.create({ data: { name, sortOrder: count, droneGroupId: droneGroup.id } });

  revalidatePath('/admin/drohnen');
  return {};
}

export async function renameDrone(
  droneId: string,
  _prevState: DroneFormState,
  formData: FormData,
): Promise<DroneFormState> {
  const user = await requireUser();
  assertPermission(isSiteAdmin(user));

  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    return { error: 'Name ist erforderlich.' };
  }

  const existing = await prisma.drone.findUnique({ where: { name } });
  if (existing && existing.id !== droneId) {
    return { error: 'Eine Drohne mit diesem Namen existiert bereits.' };
  }

  await prisma.drone.update({ where: { id: droneId }, data: { name } });
  revalidatePath('/admin/drohnen');
  return {};
}

export async function toggleDroneActive(droneId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(isSiteAdmin(user));

  const drone = await prisma.drone.findUnique({ where: { id: droneId } });
  if (!drone) return;

  await prisma.drone.update({ where: { id: droneId }, data: { isActive: !drone.isActive } });
  revalidatePath('/admin/drohnen');
}

export async function regenerateQuickRegisterLink(): Promise<void> {
  const user = await requireUser();
  assertPermission(isSiteAdmin(user));

  await generateDroneQuickRegisterToken();
  revalidatePath('/admin/drohnen');
}

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export interface DroneDocumentFormState {
  error?: string;
}

export async function uploadDroneDocument(
  _prevState: DroneDocumentFormState,
  formData: FormData,
): Promise<DroneDocumentFormState> {
  const user = await requireUser();
  assertPermission(isSiteAdmin(user));

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
  // Vorläufig, siehe Kommentar in createDrone oben - genau eine Drohnengruppe existiert bis Task 9.
  const droneGroup = await prisma.droneGroup.findFirstOrThrow();
  await prisma.droneDocument.create({
    data: {
      title,
      filename: file.name,
      sizeBytes: file.size,
      data,
      uploadedById: user.id,
      droneGroupId: droneGroup.id,
    },
  });

  revalidatePath('/admin/drohnen');
  revalidatePath('/drohnen/unterlagen');
  return {};
}

export async function deleteDroneDocument(documentId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(isSiteAdmin(user));

  await prisma.droneDocument.delete({ where: { id: documentId } });
  revalidatePath('/admin/drohnen');
  revalidatePath('/drohnen/unterlagen');
}
