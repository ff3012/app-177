'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import {
  assertPermission,
  canManageDrohnengruppenBezirksweit,
  canManageFeuerwehrenBezirksweit,
  canManageSondergruppenBezirksweit,
} from '@/lib/auth/permissions';
import {
  createFeuerwehrSchema,
  renameFeuerwehrSchema,
  createDroneGroupSchema,
  renameDroneGroupSchema,
  createSondergruppeSchema,
  renameSondergruppeSchema,
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

/** Freiwillige Feuerwehr <-> Betriebsfeuerwehr - nur die beiden Werte, daher ein einfacher
 * Toggle-Button statt eines Auswahlfelds, gleiches Muster wie toggleFeuerwehrActive oben. */
export async function toggleFeuerwehrKategorie(organizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageFeuerwehrenBezirksweit(user));

  const existing = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (existing.type !== 'FEUERWEHR') {
    throw new Error('Ungültige Organisation.');
  }
  const next = existing.feuerwehrKategorie === 'FREIWILLIGE_FEUERWEHR' ? 'BETRIEBSFEUERWEHR' : 'FREIWILLIGE_FEUERWEHR';
  await prisma.organization.update({ where: { id: organizationId }, data: { feuerwehrKategorie: next } });
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

/**
 * Löscht eine Drohnengruppe endgültig - blockiert mit einer zählenden Fehlermeldung, solange noch
 * irgendwelche Daten daran hängen (Drohnen/Mitgliedschaften/Dokumente/Termine/News-Beiträge), statt
 * sie stillschweigend mitzureißen. Gleiches "erst zählen, dann blockieren statt kaskadieren"-Muster
 * wie deleteVehicle (admin/heimatfeuerwehr/actions.ts) - keiner der DroneGroup-Relationen im Schema
 * hat ein explizites onDelete, Prisma/Postgres würde ein `delete` mit noch vorhandenen verknüpften
 * Zeilen ohnehin nur mit einem rohen Foreign-Key-Fehler ablehnen; diese Prüfung liefert stattdessen
 * eine verständliche, zählende Meldung.
 */
export async function deleteDroneGroup(droneGroupId: string): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageDrohnengruppenBezirksweit(user));

  const existing = await prisma.droneGroup.findUnique({ where: { id: droneGroupId } });
  if (!existing) {
    return {};
  }

  const [droneCount, memberCount, documentCount, eventCount, newsPostCount] = await Promise.all([
    prisma.drone.count({ where: { droneGroupId } }),
    prisma.drohnengruppeMembership.count({ where: { droneGroupId } }),
    prisma.droneDocument.count({ where: { droneGroupId } }),
    prisma.event.count({ where: { droneGroupId } }),
    prisma.newsPost.count({ where: { droneGroupId } }),
  ]);

  const blockers: string[] = [];
  if (droneCount > 0) blockers.push(`${droneCount} Drohne${droneCount === 1 ? '' : 'n'}`);
  if (memberCount > 0) blockers.push(`${memberCount} Mitglied${memberCount === 1 ? '' : 'er'}`);
  if (documentCount > 0) blockers.push(`${documentCount} Dokument${documentCount === 1 ? '' : 'e'}`);
  if (eventCount > 0) blockers.push(`${eventCount} Termin${eventCount === 1 ? '' : 'e'}`);
  if (newsPostCount > 0) blockers.push(`${newsPostCount} ${newsPostCount === 1 ? 'News-Beitrag' : 'News-Beiträge'}`);

  if (blockers.length > 0) {
    return {
      error: `Diese Drohnengruppe hat noch ${blockers.join(', ')} und kann nicht gelöscht werden - erst entfernen oder einer anderen Gruppe zuordnen.`,
    };
  }

  await prisma.droneGroup.delete({ where: { id: droneGroupId } });
  revalidate();
  return {};
}

export async function createSondergruppe(
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageSondergruppenBezirksweit(user));

  const parsed = createSondergruppeSchema.safeParse({ name: String(formData.get('name') ?? '') });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existingName = await prisma.sondergruppe.findUnique({ where: { name: data.name } });
  if (existingName) {
    return { fieldErrors: { name: ['Eine Sondergruppe mit diesem Namen existiert bereits.'] } };
  }

  const maxSortOrder = await prisma.sondergruppe.aggregate({ _max: { sortOrder: true } });
  const sortOrder = (maxSortOrder._max.sortOrder ?? 0) + 10;

  await prisma.sondergruppe.create({ data: { name: data.name, sortOrder } });
  revalidate();
  return {};
}

export async function renameSondergruppe(
  sondergruppeId: string,
  _prevState: BezirksverwaltungFormState,
  formData: FormData,
): Promise<BezirksverwaltungFormState> {
  const user = await requireUser();
  assertPermission(canManageSondergruppenBezirksweit(user));

  const existing = await prisma.sondergruppe.findUnique({ where: { id: sondergruppeId } });
  if (!existing) {
    return { error: 'Sondergruppe wurde nicht gefunden.' };
  }

  const parsed = renameSondergruppeSchema.safeParse({ name: String(formData.get('name') ?? '') });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existingName = await prisma.sondergruppe.findUnique({ where: { name: data.name } });
  if (existingName && existingName.id !== sondergruppeId) {
    return { fieldErrors: { name: ['Eine Sondergruppe mit diesem Namen existiert bereits.'] } };
  }

  await prisma.sondergruppe.update({ where: { id: sondergruppeId }, data: { name: data.name } });
  revalidate();
  return {};
}

export async function toggleSondergruppeActive(sondergruppeId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageSondergruppenBezirksweit(user));

  const existing = await prisma.sondergruppe.findUniqueOrThrow({ where: { id: sondergruppeId } });
  await prisma.sondergruppe.update({ where: { id: sondergruppeId }, data: { isActive: !existing.isActive } });
  revalidate();
}
