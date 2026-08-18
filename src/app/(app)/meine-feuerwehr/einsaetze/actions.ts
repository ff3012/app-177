'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageIncidentsFor, canDeleteIncidentPhoto, canTogglePhotoRelease } from '@/lib/auth/permissions';
import { incidentSchema, parseIncidentFormData } from '@/lib/validation/incident.schema';
import { deletePhotoObjects } from '@/lib/storage/incident-photos-s3';

export interface IncidentFormState {
  error?: string;
}

async function assertOwnFireDepartmentVehicles(fireDepartmentId: string, vehicleIds: string[]): Promise<void> {
  if (vehicleIds.length === 0) return;
  const count = await prisma.vehicle.count({ where: { id: { in: vehicleIds }, organizationId: fireDepartmentId } });
  if (count !== vehicleIds.length) throw new Error('Ungültige Fahrzeugauswahl.');
}

async function assertOwnFireDepartmentCrew(fireDepartmentId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const count = await prisma.user.count({ where: { id: { in: userIds }, homeOrganizationId: fireDepartmentId } });
  if (count !== userIds.length) throw new Error('Ungültige Mannschaftsauswahl.');
}

export async function createIncident(
  fireDepartmentId: string,
  _prevState: IncidentFormState,
  formData: FormData,
): Promise<IncidentFormState> {
  const user = await requireUser();
  if (!canManageIncidentsFor(user, fireDepartmentId)) return { error: 'Kein Zugriff.' };

  const parsed = incidentSchema.safeParse(parseIncidentFormData(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };
  const data = parsed.data;

  try {
    await assertOwnFireDepartmentVehicles(fireDepartmentId, data.vehicleIds);
    await assertOwnFireDepartmentCrew(fireDepartmentId, data.crewMemberIds);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Ungültige Auswahl.' };
  }

  const incident = await prisma.incident.create({
    data: {
      fireDepartmentId,
      kind: data.kind,
      keyword: data.keyword,
      location: data.location,
      alarmedAt: new Date(data.alarmedAt),
      endedAt: data.endedAt ? new Date(data.endedAt) : null,
      crewCount: data.crewCount ? Number(data.crewCount) : null,
      createdById: user.id,
      vehicles: { create: data.vehicleIds.map((vehicleId) => ({ vehicleId })) },
      crewMembers: { create: data.crewMemberIds.map((userId) => ({ userId })) },
    },
  });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/meine-feuerwehr/einsaetze');
  redirect(`/meine-feuerwehr/einsaetze/${incident.id}`);
}

export async function updateIncident(
  incidentId: string,
  _prevState: IncidentFormState,
  formData: FormData,
): Promise<IncidentFormState> {
  const user = await requireUser();
  const existing = await prisma.incident.findUnique({ where: { id: incidentId }, select: { fireDepartmentId: true } });
  if (!existing || !canManageIncidentsFor(user, existing.fireDepartmentId)) return { error: 'Kein Zugriff.' };

  const parsed = incidentSchema.safeParse(parseIncidentFormData(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };
  const data = parsed.data;

  try {
    await assertOwnFireDepartmentVehicles(existing.fireDepartmentId, data.vehicleIds);
    await assertOwnFireDepartmentCrew(existing.fireDepartmentId, data.crewMemberIds);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Ungültige Auswahl.' };
  }

  await prisma.$transaction([
    prisma.incidentVehicle.deleteMany({ where: { incidentId } }),
    prisma.incidentCrewMember.deleteMany({ where: { incidentId } }),
    prisma.incident.update({
      where: { id: incidentId },
      data: {
        kind: data.kind,
        keyword: data.keyword,
        location: data.location,
        alarmedAt: new Date(data.alarmedAt),
        endedAt: data.endedAt ? new Date(data.endedAt) : null,
        crewCount: data.crewCount ? Number(data.crewCount) : null,
        vehicles: { create: data.vehicleIds.map((vehicleId) => ({ vehicleId })) },
        crewMembers: { create: data.crewMemberIds.map((userId) => ({ userId })) },
      },
    }),
  ]);

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/meine-feuerwehr/einsaetze');
  redirect(`/meine-feuerwehr/einsaetze/${incidentId}`);
}

export async function deleteIncident(incidentId: string): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.incident.findUnique({ where: { id: incidentId }, select: { fireDepartmentId: true } });
  if (!existing || !canManageIncidentsFor(user, existing.fireDepartmentId)) throw new Error('Kein Zugriff.');

  // Findet I8 (Final-Review): dieser Kommentar beschrieb vormals ein bewusstes Auslassen der
  // S3-Aufräumung - das war ein echtes Datenschutz-Problem (Fotos können laut dem Upload-Sheet
  // "Personen und Kennzeichen" zeigen) und ist jetzt behoben, exakt nach demselben Muster wie
  // deleteIncidentPhoto oben: Storage-Keys ALLER Fotos dieses Einsatzes vor dem kaskadierenden
  // DB-Delete einsammeln (danach existieren die IncidentPhoto-Zeilen nicht mehr, aus denen sich die
  // verwaisten Keys sonst nie mehr rekonstruieren ließen) und in einem Aufruf löschen.
  const photos = await prisma.incidentPhoto.findMany({
    where: { incidentId },
    select: { storageKey: true, previewKey: true, thumbnailKey: true },
  });
  const keys = photos
    .flatMap((photo) => [photo.storageKey, photo.previewKey, photo.thumbnailKey])
    .filter((key): key is string => key !== null);
  await deletePhotoObjects(keys);

  await prisma.incident.delete({ where: { id: incidentId } });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/meine-feuerwehr/einsaetze');
  redirect('/meine-feuerwehr/einsaetze');
}

export async function deleteIncidentPhoto(photoId: string, incidentId: string): Promise<void> {
  const user = await requireUser();
  const photo = await prisma.incidentPhoto.findUnique({ where: { id: photoId }, include: { incident: true } });
  if (!photo || photo.incidentId !== incidentId) throw new Error('Foto wurde nicht gefunden.');
  if (!canDeleteIncidentPhoto(user, photo, photo.incident.fireDepartmentId)) throw new Error('Kein Zugriff.');

  const keys = [photo.storageKey, photo.previewKey, photo.thumbnailKey].filter((key): key is string => key !== null);
  await deletePhotoObjects(keys);
  await prisma.incidentPhoto.delete({ where: { id: photoId } });

  revalidatePath(`/meine-feuerwehr/einsaetze/${incidentId}`);
  revalidatePath('/meine-feuerwehr');
}

export async function setIncidentPhotoPublicRelease(photoId: string, incidentId: string, publicRelease: boolean): Promise<void> {
  const user = await requireUser();
  const photo = await prisma.incidentPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.incidentId !== incidentId) throw new Error('Foto wurde nicht gefunden.');
  if (!canTogglePhotoRelease(user, photo)) throw new Error('Kein Zugriff.');

  await prisma.incidentPhoto.update({ where: { id: photoId }, data: { publicRelease } });
  revalidatePath(`/meine-feuerwehr/einsaetze/${incidentId}`);
}
