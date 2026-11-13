import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/types/next-auth';
import {
  canConfirmChecklist,
  canCreateChecklist,
  canDeleteChecklist,
  canDiscardChecklist,
  canEditChecklist,
  canViewChecklist,
} from '@/lib/auth/permissions';
import { isActiveDrone, isEligiblePilot } from '@/lib/drone/members';
import { deriveChecklistColumns, viennaDateParts } from './columns';
import { checklistDataSchema, type ChecklistData } from './data';
import { missingForSubmit, type MissingItem } from './rules';

export interface ServiceFailure {
  ok: false;
  /** NOT_FOUND: gibt es nicht oder darf der Benutzer nicht sehen (die Seite antwortet 404);
   * FORBIDDEN: sichtbar, aber die Aktion ist nicht erlaubt; INVALID: Eingabe/Zustand passt nicht. */
  code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID';
  error: string;
  missing?: MissingItem[];
}
export type ServiceResult<T extends object = object> = ({ ok: true } & T) | ServiceFailure;

const fail = (code: ServiceFailure['code'], error: string, missing?: MissingItem[]): ServiceFailure => ({
  ok: false,
  code,
  error,
  ...(missing ? { missing } : {}),
});
const notFound = () => fail('NOT_FOUND', 'Checkliste wurde nicht gefunden.');
const notDraft = () => fail('INVALID', 'Nur Entwürfe können bearbeitet werden.');

/** BOS1-Pilot DIESER Gruppe: Mitgliedschaft mit gesetztem bos1AusbildungAm. */
export async function isBos1PilotOf(userId: string, droneGroupId: string): Promise<boolean> {
  const membership = await prisma.drohnengruppeMembership.findUnique({
    where: { userId },
    select: { droneGroupId: true, bos1AusbildungAm: true },
  });
  return membership?.droneGroupId === droneGroupId && membership.bos1AusbildungAm !== null;
}

/** Lädt die Checkliste samt Gruppe - null, wenn sie fehlt, der Funktionsschalter der Gruppe aus ist oder
 * der Benutzer sie nicht sehen darf (alle drei Fälle sehen von außen gleich aus). */
async function loadVisible(user: SessionUser, id: string) {
  const checklist = await prisma.droneChecklist.findUnique({
    where: { id },
    include: { droneGroup: { select: { id: true, organizationId: true, featureChecklist: true } } },
  });
  if (!checklist || !checklist.droneGroup.featureChecklist) return null;
  if (!canViewChecklist(user, checklist, checklist.droneGroup)) return null;
  return checklist;
}

/** Pilot und Drohnen müssen zur Gruppe der Checkliste gehören - die Ids kommen vom Client. */
async function invalidReference(droneGroupId: string, data: ChecklistData): Promise<string | null> {
  if (data.pilot && !(await isEligiblePilot(data.pilot, droneGroupId))) {
    return 'Der gewählte Pilot ist kein Mitglied dieser Drohnengruppe.';
  }
  for (const wechsel of data.pilotWechsel ?? []) {
    if (wechsel.pilot && !(await isEligiblePilot(wechsel.pilot, droneGroupId))) {
      return 'Ein Pilot des Pilotenwechsels ist kein Mitglied dieser Drohnengruppe.';
    }
  }
  const droneIds = [...new Set(data.drohnen ?? [])];
  const valid = await Promise.all(droneIds.map((droneId) => isActiveDrone(droneId, droneGroupId)));
  if (valid.some((ok) => !ok)) return 'Eine gewählte Drohne gehört nicht zu dieser Gruppe oder ist deaktiviert.';
  return null;
}

export async function createChecklistDraft(user: SessionUser, droneGroupId: string): Promise<ServiceResult<{ id: string }>> {
  const droneGroup = await prisma.droneGroup.findUnique({
    where: { id: droneGroupId },
    select: { id: true, organizationId: true, featureChecklist: true },
  });
  if (!droneGroup || !droneGroup.featureChecklist) return fail('NOT_FOUND', 'Drohnengruppe wurde nicht gefunden.');
  if (!canCreateChecklist(user, droneGroup)) return fail('FORBIDDEN', 'Keine Berechtigung für diese Drohnengruppe.');

  const now = viennaDateParts(new Date());
  const pilotIsMember = await isEligiblePilot(user.id, droneGroup.id);
  const data: ChecklistData = {
    datum: now.datum,
    zeit: now.zeit,
    sicht: 'VLOS',
    auftragAm: now.datum,
    hoehenlimit: 120,
    checks: {},
    fluege: [{}],
    ...(pilotIsMember ? { pilot: user.id } : {}),
  };
  const columns = deriveChecklistColumns(data);
  const created = await prisma.droneChecklist.create({
    data: {
      droneGroupId: droneGroup.id,
      createdById: user.id,
      pilotId: columns.pilotId,
      flightAt: columns.flightAt ?? new Date(),
      purpose: columns.purpose,
      area: columns.area,
      data: data as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

export async function saveChecklistDraft(
  user: SessionUser,
  input: { id: string; step: number; data: unknown },
): Promise<ServiceResult<{ savedAt: Date }>> {
  const checklist = await loadVisible(user, input.id);
  if (!checklist) return notFound();
  if (checklist.status !== 'DRAFT') return notDraft();
  const bos1 = await isBos1PilotOf(user.id, checklist.droneGroupId);
  if (!canEditChecklist(user, checklist, checklist.droneGroup, bos1)) {
    return fail('FORBIDDEN', 'Du darfst diesen Entwurf nicht bearbeiten.');
  }
  if (!Number.isInteger(input.step) || input.step < 0 || input.step > 8) return fail('INVALID', 'Ungültiger Schritt.');
  const parsed = checklistDataSchema.safeParse(input.data);
  if (!parsed.success) return fail('INVALID', 'Die Eingaben sind ungültig.');
  const referenceError = await invalidReference(checklist.droneGroupId, parsed.data);
  if (referenceError) return fail('INVALID', referenceError);

  const columns = deriveChecklistColumns(parsed.data);
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.droneChecklist.updateMany({
      where: { id: checklist.id, status: 'DRAFT' },
      data: {
        step: input.step,
        flightAt: columns.flightAt,
        purpose: columns.purpose,
        area: columns.area,
        pilotId: columns.pilotId,
        data: parsed.data as Prisma.InputJsonValue,
      },
    });
    if (updated.count === 0) return false;
    await tx.droneChecklistDrone.deleteMany({ where: { checklistId: checklist.id } });
    await tx.droneChecklistDrone.createMany({
      data: columns.droneIds.map((droneId) => ({ checklistId: checklist.id, droneId })),
    });
    return true;
  });
  if (!saved) return notDraft();
  return { ok: true, savedAt: new Date() };
}

/** Verwerfen löscht nicht: status DISCARDED, die Zeile bleibt in der Drohnenverwaltung sichtbar. */
export async function discardChecklist(user: SessionUser, id: string): Promise<ServiceResult> {
  const checklist = await loadVisible(user, id);
  if (!checklist) return notFound();
  if (checklist.status !== 'DRAFT') return notDraft();
  if (!canDiscardChecklist(user, checklist, checklist.droneGroup)) {
    return fail('FORBIDDEN', 'Nur der Ersteller oder ein Admin der Drohnengruppe kann den Entwurf verwerfen.');
  }
  const updated = await prisma.droneChecklist.updateMany({
    where: { id: checklist.id, status: 'DRAFT' },
    data: { status: 'DISCARDED', discardedAt: new Date() },
  });
  if (updated.count === 0) return notDraft();
  return { ok: true };
}

/** Löscht einen Entwurf endgültig (anders als Verwerfen bleibt keine Zeile zurück). Nur nicht abgeschlossene
 * Entwürfe, nur Ersteller/Admin der Gruppe, und nur solange KEIN Flug mit dem Entwurf verknüpft ist (die
 * Flugdaten behalten ihren Bezug zur Checkliste). Das Löschen selbst ist atomar an beide Bedingungen
 * gebunden, damit ein gleichzeitig registrierter Flug oder ein paralleles Abschließen nicht überrollt wird;
 * die Zuordnung der Drohnen (DroneChecklistDrone) fällt per Cascade mit. */
export async function deleteChecklist(user: SessionUser, id: string): Promise<ServiceResult> {
  const checklist = await loadVisible(user, id);
  if (!checklist) return notFound();
  if (checklist.status !== 'DRAFT') return fail('INVALID', 'Nur Entwürfe können gelöscht werden.');
  if (!canDeleteChecklist(user, checklist, checklist.droneGroup)) {
    return fail('FORBIDDEN', 'Nur der Ersteller oder ein Admin der Drohnengruppe kann den Entwurf löschen.');
  }
  const linked = 'Mit diesem Entwurf ist bereits ein Flug verknüpft. Lösche zuerst den Flug oder verwirf den Entwurf stattdessen.';
  if ((await prisma.droneFlight.count({ where: { checklistId: checklist.id } })) > 0) return fail('INVALID', linked);
  try {
    const deleted = await prisma.droneChecklist.deleteMany({ where: { id: checklist.id, status: 'DRAFT', flights: { none: {} } } });
    if (deleted.count === 0) {
      // Zwischen Prüfung und Löschen verändert: entweder schon weg/abgeschlossen oder jetzt mit einem Flug verknüpft.
      const current = await prisma.droneChecklist.findUnique({ where: { id: checklist.id }, select: { status: true } });
      if (!current) return notFound();
      return current.status === 'DRAFT' ? fail('INVALID', linked) : fail('INVALID', 'Nur Entwürfe können gelöscht werden.');
    }
  } catch (error) {
    // Ein Flug wurde im selben Augenblick angelegt (Fremdschlüssel greift): wie "verknüpft" behandeln.
    if ((error as { code?: string }).code === 'P2003') return fail('INVALID', linked);
    throw error;
  }
  return { ok: true };
}

/** Schließt einen Entwurf ab. Prüft ALLES serverseitig neu (Pflichtpunkte, Bestätigung, Pilot/Drohnen),
 * unabhängig davon, was die Oberfläche angezeigt hat. Legt keinen Flug an. PDF und E-Mail folgen im
 * Aufrufer nach dem Commit, damit ein Fehler dort das Abschließen nie zurückrollt. */
export async function submitChecklist(user: SessionUser, id: string): Promise<ServiceResult<{ id: string }>> {
  const checklist = await loadVisible(user, id);
  if (!checklist) return notFound();
  if (checklist.status !== 'DRAFT') return fail('INVALID', 'Diese Checkliste ist bereits abgeschlossen oder verworfen.');
  const bos1 = await isBos1PilotOf(user.id, checklist.droneGroupId);
  if (!canEditChecklist(user, checklist, checklist.droneGroup, bos1)) {
    return fail('FORBIDDEN', 'Du darfst diese Checkliste nicht abschließen.');
  }

  const parsed = checklistDataSchema.safeParse(checklist.data);
  if (!parsed.success) return fail('INVALID', 'Die gespeicherten Eingaben sind ungültig.');
  const missing = missingForSubmit(parsed.data);
  if (missing.length > 0) return fail('INVALID', 'Es fehlen noch Angaben.', missing);

  if (!canConfirmChecklist(user, checklist.droneGroup, parsed.data.pilot ?? null, bos1)) {
    return fail('FORBIDDEN', 'Die Bestätigung kann nur der gewählte Pilot, ein Admin oder ein BOS1-Pilot der Gruppe setzen.');
  }
  const referenceError = await invalidReference(checklist.droneGroupId, parsed.data);
  if (referenceError) return fail('INVALID', referenceError);

  const now = new Date();
  const updated = await prisma.droneChecklist.updateMany({
    where: { id: checklist.id, status: 'DRAFT' },
    data: { status: 'SUBMITTED', submittedAt: now, confirmedAt: now, submittedById: user.id },
  });
  if (updated.count === 0) return fail('INVALID', 'Diese Checkliste ist bereits abgeschlossen oder verworfen.');
  return { ok: true, id: checklist.id };
}
