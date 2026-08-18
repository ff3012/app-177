'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManagePhotoUploadsFor, canDeletePhoto } from '@/lib/auth/permissions';
import { photoUploadSchema, parsePhotoUploadFormData } from '@/lib/validation/photo-upload.schema';
import { deletePhotoObjects } from '@/lib/storage/photo-uploads-s3';

export interface PhotoUploadFormState {
  error?: string;
}

export async function createPhotoUpload(
  fireDepartmentId: string,
  _prevState: PhotoUploadFormState,
  formData: FormData,
): Promise<PhotoUploadFormState> {
  const user = await requireUser();
  if (!canManagePhotoUploadsFor(user, fireDepartmentId)) return { error: 'Kein Zugriff.' };

  const parsed = photoUploadSchema.safeParse(parsePhotoUploadFormData(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };

  const photoUpload = await prisma.photoUpload.create({
    data: {
      fireDepartmentId,
      kind: parsed.data.kind,
      description: parsed.data.description,
      occurredOn: new Date(parsed.data.occurredOn),
      createdById: user.id,
    },
  });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/foto-uploads');
  redirect(`/foto-uploads/${photoUpload.id}`);
}

export async function updatePhotoUpload(
  photoUploadId: string,
  _prevState: PhotoUploadFormState,
  formData: FormData,
): Promise<PhotoUploadFormState> {
  const user = await requireUser();
  const existing = await prisma.photoUpload.findUnique({ where: { id: photoUploadId }, select: { fireDepartmentId: true } });
  if (!existing || !canManagePhotoUploadsFor(user, existing.fireDepartmentId)) return { error: 'Kein Zugriff.' };

  const parsed = photoUploadSchema.safeParse(parsePhotoUploadFormData(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };

  await prisma.photoUpload.update({
    where: { id: photoUploadId },
    data: {
      kind: parsed.data.kind,
      description: parsed.data.description,
      occurredOn: new Date(parsed.data.occurredOn),
    },
  });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/foto-uploads');
  redirect(`/foto-uploads/${photoUploadId}`);
}

export async function deletePhotoUpload(photoUploadId: string): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.photoUpload.findUnique({ where: { id: photoUploadId }, select: { fireDepartmentId: true } });
  if (!existing || !canManagePhotoUploadsFor(user, existing.fireDepartmentId)) throw new Error('Kein Zugriff.');

  // Alle S3-Objekte der zugehörigen Fotos VOR dem DB-Delete entfernen, sonst wären die Storage-Keys
  // nach dem kaskadierenden Löschen der Photo-Zeilen unwiederbringlich verwaist - dieselbe Lehre wie
  // die entsprechende Behebung (Final-Review-Finding I8) in der Vorgängerversion dieser Funktion.
  const photos = await prisma.photo.findMany({
    where: { photoUploadId },
    select: { storageKey: true, previewKey: true, thumbKey: true },
  });
  const keys = photos.flatMap((photo) => [photo.storageKey, photo.previewKey, photo.thumbKey]).filter((key): key is string => key !== null);
  await deletePhotoObjects(keys);

  await prisma.photoUpload.delete({ where: { id: photoUploadId } });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/foto-uploads');
  redirect('/foto-uploads');
}

export async function deletePhoto(photoId: string, photoUploadId: string): Promise<void> {
  const user = await requireUser();
  const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { photoUpload: true } });
  if (!photo || photo.photoUploadId !== photoUploadId) throw new Error('Foto wurde nicht gefunden.');
  if (!canDeletePhoto(user, photo, photo.photoUpload.fireDepartmentId)) throw new Error('Kein Zugriff.');

  const keys = [photo.storageKey, photo.previewKey, photo.thumbKey].filter((key): key is string => key !== null);
  await deletePhotoObjects(keys);
  await prisma.photo.delete({ where: { id: photoId } });

  revalidatePath(`/foto-uploads/${photoUploadId}`);
  revalidatePath('/meine-feuerwehr');
}
