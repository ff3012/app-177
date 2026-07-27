'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { DroneRole, MembershipRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, isSiteAdmin } from '@/lib/auth/permissions';
import { hashPassword } from '@/lib/password';
import { type DroneRoleOption, parseUserFormData, userSchema } from '@/lib/validation/user.schema';

export interface UserFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

async function syncAdminMemberships(userId: string, adminOrgIds: string[]) {
  await prisma.membership.deleteMany({
    where: { userId, role: MembershipRole.ADMIN, organizationId: { notIn: adminOrgIds } },
  });
  for (const organizationId of adminOrgIds) {
    await prisma.membership.upsert({
      where: { userId_organizationId_role: { userId, organizationId, role: MembershipRole.ADMIN } },
      update: {},
      create: { userId, organizationId, role: MembershipRole.ADMIN },
    });
  }
}

async function syncDroneMembership(userId: string, droneRole: DroneRoleOption) {
  if (droneRole === 'NONE') {
    await prisma.drohnengruppeMembership.deleteMany({ where: { userId } });
    return;
  }
  const role = droneRole === 'ADMIN' ? DroneRole.ADMIN : DroneRole.PILOT;
  await prisma.drohnengruppeMembership.upsert({
    where: { userId },
    update: { role },
    create: { userId, role },
  });
}

export async function createUser(_prevState: UserFormState, formData: FormData): Promise<UserFormState> {
  const currentUser = await requireUser();
  assertPermission(isSiteAdmin(currentUser));

  const raw = parseUserFormData(formData);
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  if (!data.password) {
    return { fieldErrors: { password: ['Passwort ist für einen neuen Benutzer erforderlich.'] } };
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) {
    return { error: 'Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.' };
  }

  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email.toLowerCase(),
      isActive: data.isActive,
      homeOrganizationId: data.homeOrganizationId,
      passwordHash,
    },
  });

  await syncAdminMemberships(user.id, data.adminOrgIds);
  await syncDroneMembership(user.id, data.droneRole);

  revalidatePath('/admin/benutzer');
  redirect('/admin/benutzer');
}

export async function updateUser(
  userId: string,
  _prevState: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const currentUser = await requireUser();
  assertPermission(isSiteAdmin(currentUser));

  const raw = parseUserFormData(formData);
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing && existing.id !== userId) {
    return { error: 'Ein anderer Benutzer verwendet diese E-Mail-Adresse bereits.' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email.toLowerCase(),
      isActive: data.isActive,
      homeOrganizationId: data.homeOrganizationId,
      ...(data.password ? { passwordHash: await hashPassword(data.password) } : {}),
    },
  });

  await syncAdminMemberships(userId, data.adminOrgIds);
  await syncDroneMembership(userId, data.droneRole);

  revalidatePath('/admin/benutzer');
  redirect('/admin/benutzer');
}
