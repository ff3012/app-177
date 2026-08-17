'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageIncidentsFor } from '@/lib/auth/permissions';
import { incidentSchema, parseIncidentFormData } from '@/lib/validation/incident.schema';

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

  // Fotos werden HIER bewusst nicht aus S3 gelöscht - deleteIncidentPhoto (Task 4) ist der einzige
  // Ort, der S3-Objekte löscht. Ein gelöschter Einsatz lässt seine Foto-Objekte (aktuell) verwaist im
  // Bucket zurück; siehe Task 4's Abschlusskommentar für die bewusste Begründung, das nicht in dieser
  // Iteration zu lösen.
  await prisma.incident.delete({ where: { id: incidentId } });

  revalidatePath('/meine-feuerwehr');
  revalidatePath('/meine-feuerwehr/einsaetze');
  redirect('/meine-feuerwehr/einsaetze');
}
