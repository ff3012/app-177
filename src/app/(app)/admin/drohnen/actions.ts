'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, isSiteAdmin } from '@/lib/auth/permissions';

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
  await prisma.drone.create({ data: { name, sortOrder: count } });

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
