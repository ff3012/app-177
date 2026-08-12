'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageDrohnengruppenBezirksweit, canManageFeuerwehrenBezirksweit } from '@/lib/auth/permissions';
import {
  createFeuerwehrSchema,
  renameFeuerwehrSchema,
  createDroneGroupSchema,
  renameDroneGroupSchema,
} from '@/lib/validation/bezirksverwaltung.schema';

export interface BezirksverwaltungFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

function revalidate() {
  revalidatePath('/admin/bezirksverwaltung');
}

export async function createFeuerwehr(
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageFeuerwehrenBezirksweit(user));

  const parsed = createFeuerwehrSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    shortName: String(formData.get('shortName') ?? ''),
    nummer: String(formData.get('nummer') ?? ''),
    parentId: String(formData.get('parentId') ?? ''),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const parent = await prisma.organization.findUnique({ where: { id: data.parentId }, select: { type: true } });
  if (!parent || parent.type !== 'ABSCHNITTSKOMMANDO') {
    return { fieldErrors: { parentId: ['Ungültiger Abschnitt.'] } };
  }

  const [existingName, existingNummer] = await Promise.all([
    prisma.organization.findUnique({ where: { name: data.name } }),
    prisma.organization.findUnique({ where: { nummer: data.nummer } }),
  ]);
  if (existingName) {
    return { fieldErrors: { name: ['Eine Feuerwehr mit diesem Namen existiert bereits.'] } };
  }
  if (existingNummer) {
    return { fieldErrors: { nummer: ['Eine Feuerwehr mit dieser Nummer existiert bereits.'] } };
  }

  await prisma.organization.create({
    data: {
      name: data.name,
      shortName: data.shortName || null,
      nummer: data.nummer,
      parentId: data.parentId,
      type: 'FEUERWEHR',
    },
  });
  revalidate();
  return {};
}

export async function renameFeuerwehr(
  organizationId: string,
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageFeuerwehrenBezirksweit(user));

  const existing = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!existing || existing.type !== 'FEUERWEHR') {
    return { error: 'Feuerwehr wurde nicht gefunden.' };
  }

  const parsed = renameFeuerwehrSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    shortName: String(formData.get('shortName') ?? ''),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existingName = await prisma.organization.findUnique({ where: { name: data.name } });
  if (existingName && existingName.id !== organizationId) {
    return { fieldErrors: { name: ['Eine Feuerwehr mit diesem Namen existiert bereits.'] } };
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { name: data.name, shortName: data.shortName || null },
  });
  revalidate();
  return {};
}

export async function toggleFeuerwehrActive(organizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageFeuerwehrenBezirksweit(user));

  const existing = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (existing.type !== 'FEUERWEHR') {
    throw new Error('Ungültige Organisation.');
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { isActive: !existing.isActive } });
  revalidate();
}

export async function createDroneGroup(
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageDrohnengruppenBezirksweit(user));

  const parsed = createDroneGroupSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    organizationId: String(formData.get('organizationId') ?? ''),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const anchor = await prisma.organization.findUnique({ where: { id: data.organizationId }, select: { type: true } });
  if (!anchor || anchor.type !== 'ABSCHNITTSKOMMANDO') {
    return { fieldErrors: { organizationId: ['Ungültiger Abschnitt.'] } };
  }

  const existingName = await prisma.droneGroup.findUnique({ where: { name: data.name } });
  if (existingName) {
    return { fieldErrors: { name: ['Eine Drohnengruppe mit diesem Namen existiert bereits.'] } };
  }

  await prisma.droneGroup.create({ data: { name: data.name, organizationId: data.organizationId } });
  revalidate();
  return {};
}

export async function renameDroneGroup(
  droneGroupId: string,
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageDrohnengruppenBezirksweit(user));

  const existing = await prisma.droneGroup.findUnique({ where: { id: droneGroupId } });
  if (!existing) {
    return { error: 'Drohnengruppe wurde nicht gefunden.' };
  }

  const parsed = renameDroneGroupSchema.safeParse({ name: String(formData.get('name') ?? '') });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existingName = await prisma.droneGroup.findUnique({ where: { name: data.name } });
  if (existingName && existingName.id !== droneGroupId) {
    return { fieldErrors: { name: ['Eine Drohnengruppe mit diesem Namen existiert bereits.'] } };
  }

  await prisma.droneGroup.update({ where: { id: droneGroupId }, data: { name: data.name } });
  revalidate();
  return {};
}

export async function toggleDroneGroupActive(droneGroupId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageDrohnengruppenBezirksweit(user));

  const existing = await prisma.droneGroup.findUniqueOrThrow({ where: { id: droneGroupId } });
  await prisma.droneGroup.update({ where: { id: droneGroupId }, data: { isActive: !existing.isActive } });
  revalidate();
}
