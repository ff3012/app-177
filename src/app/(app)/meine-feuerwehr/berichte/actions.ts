'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import { loadReportForEdit, assertReportIsEditable } from '@/lib/heimatfeuerwehr/report-access';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { ACTIVITY_KINDS, MATERIALS, EQUIPMENT } from '@/lib/heimatfeuerwehr/report-constants';
import type { ReportType } from '@prisma/client';

const ACTIVITY_KIND_CODES = new Set(ACTIVITY_KINDS.map((k) => k.code));
const MATERIAL_CODES = new Set(MATERIALS.map((m) => m.code));
const EQUIPMENT_CODES = new Set(EQUIPMENT.map((e) => e.code));
const REPORT_MEMBER_FUNKTIONEN = new Set<string>(['KOMMANDANT', 'FAHRER', 'MANNSCHAFT']);

/** Berichtsart-Sheet (Bericht-Brief.md §1b) -> "Neuer Bericht" ohne Reservierung. Legt sofort einen
 * leeren DRAFT an und leitet zu Schritt 1 weiter. Nur ACTIVITY ist heute wirklich anlegbar - die
 * UI-Sperre für EXERCISE/INCIDENT sitzt im Berichtsart-Sheet selbst (report-type-sheet.tsx), diese
 * Funktion erlaubt aber ausdrücklich alle drei type-Werte, damit das Datenmodell für später keine
 * Migration braucht. */
export async function createReportDraft(type: ReportType): Promise<never> {
  const user = await requireUser();
  assertPermission(canCreateReportFor(user, user.homeOrganizationId));

  // endAt bewusst eine Stunde NACH startAt: updateReportDraft lehnt `endAt <= startAt` ab, und Schritt 1s
  // Autospeichern schickt beide Zeitpunkte schon beim ersten Mount mit - bei identischen Werten würde
  // dadurch der allererste Speichervorgang (samt allen anderen Feldern im selben Patch) immer scheitern.
  const now = new Date();
  const endAt = new Date(now.getTime() + 60 * 60 * 1000);
  const report = await prisma.report.create({
    data: {
      type,
      fireDepartmentId: user.homeOrganizationId,
      filledById: user.id,
      createdById: user.id,
      startAt: now,
      endAt,
    },
  });

  redirect(`/meine-feuerwehr/berichte/${report.id}/schritt-1`);
}

export interface ReportDraftPatch {
  filledById?: string;
  startAt?: string;
  endAt?: string;
  ownActivity?: boolean;
  activityKinds?: string[];
  activityOther?: string | null;
  vehicleId?: string | null;
  vehicleKm?: number | null;
  remark?: string;
}

/** Debounced Autospeichern für jeden Formular-Schritt (Bericht-Brief.md §5: "Jede Änderung speichert den
 * Entwurf, kein eigener Speichern-Button") - ein einziger, generischer Patch-Endpunkt statt einer
 * Server Action pro Feld, da alle drei Schritte denselben Report bearbeiten. Nimmt nur die Felder an, die
 * sich geändert haben (partial patch), schreibt sie 1:1 durch. */
export async function updateReportDraft(
  reportId: string,
  patch: ReportDraftPatch,
): Promise<{ error?: string }> {
  const report = await loadReportForEdit(reportId);
  assertReportIsEditable(report);

  // Sicherheits-Check: die UI bietet "Ausgefüllt von" nur über MemberSearchSelect an (nur Mitglieder
  // dieser Feuerwehr), aber diese Server Action ist ein direkt aufrufbares Endpunkt, kein Formular-only
  // Pfad - ein manipulierter Aufruf könnte sonst filledById auf jeden beliebigen User setzen. Gleiches
  // Muster wie createVehicleBooking's "Stellvertretende Buchung"-Check in meine-feuerwehr/actions.ts.
  if (patch.filledById !== undefined) {
    const filledByUser = await prisma.user.findFirst({
      where: { id: patch.filledById, homeOrganizationId: report.fireDepartmentId, ...NOT_DEACTIVATED_WHERE },
      select: { id: true },
    });
    if (!filledByUser) {
      return { error: 'Das ausgewählte Mitglied gehört nicht zu dieser Feuerwehr.' };
    }
  }

  // Gleiches Defense-in-depth-Prinzip für das Fahrzeug: nur ein aktives Fahrzeug DIESER Feuerwehr. Ein
  // bereits gespeichertes Fahrzeug (z. B. vom Cron aus einer Reservierung übernommen, inzwischen
  // deaktiviert) bleibt zulässig - sonst würde jeder weitere Autospeicher-Vorgang von Schritt 2 für
  // diesen Entwurf scheitern, obwohl der Benutzer gar nichts Neues zugewiesen hat.
  if (patch.vehicleId !== undefined && patch.vehicleId !== null && patch.vehicleId !== report.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: patch.vehicleId, organizationId: report.fireDepartmentId, isActive: true },
      select: { id: true },
    });
    if (!vehicle) {
      return { error: 'Das ausgewählte Fahrzeug gehört nicht zu dieser Feuerwehr.' };
    }
  }

  if (patch.vehicleKm !== undefined && patch.vehicleKm !== null) {
    if (!Number.isInteger(patch.vehicleKm) || patch.vehicleKm < 0) {
      return { error: 'Die Kilometer müssen eine ganze Zahl ab 0 sein.' };
    }
  }

  if (patch.activityKinds !== undefined) {
    const unknownKind = patch.activityKinds.find((code) => !ACTIVITY_KIND_CODES.has(code));
    if (unknownKind !== undefined) {
      return { error: 'Unbekannte Tätigkeitsart.' };
    }
  }

  const data: Record<string, unknown> = {};
  if (patch.filledById !== undefined) data.filledById = patch.filledById;
  if (patch.startAt !== undefined) data.startAt = new Date(patch.startAt);
  if (patch.endAt !== undefined) data.endAt = new Date(patch.endAt);
  if (patch.ownActivity !== undefined) data.ownActivity = patch.ownActivity;
  if (patch.activityKinds !== undefined) data.activityKinds = patch.activityKinds;
  if (patch.activityOther !== undefined) data.activityOther = patch.activityOther;
  if (patch.vehicleId !== undefined) data.vehicleId = patch.vehicleId;
  if (patch.vehicleKm !== undefined) data.vehicleKm = patch.vehicleKm;
  if (patch.remark !== undefined) data.remark = patch.remark;

  if (data.startAt && data.endAt && data.endAt <= data.startAt) {
    return { error: 'Das Ende muss nach dem Beginn liegen.' };
  }

  await prisma.report.update({ where: { id: reportId }, data });
  revalidatePath(`/meine-feuerwehr/berichte/${reportId}`);
  return {};
}

export interface ReportMemberPatchEntry {
  userId: string;
  funktion: 'KOMMANDANT' | 'FAHRER' | 'MANNSCHAFT';
}

/** Schritt 2 "Eingesetzte Mitglieder" - vollständiger Ersatz der ReportMember-Zeilen bei jedem Speichern,
 * einfacher und race-sicherer als ein Diff gegen den vorherigen Stand (die Liste ist klein, typischerweise
 * < 10 Einträge). */
export async function updateReportMembers(
  reportId: string,
  members: ReportMemberPatchEntry[],
): Promise<{ error?: string }> {
  const report = await loadReportForEdit(reportId);
  assertReportIsEditable(report);

  const userIds = members.map((member) => member.userId);
  if (new Set(userIds).size !== userIds.length) {
    return { error: 'Ein Mitglied ist mehrfach eingetragen.' };
  }
  if (members.some((member) => !REPORT_MEMBER_FUNKTIONEN.has(member.funktion))) {
    return { error: 'Unbekannte Funktion.' };
  }

  // Defense in depth (gleiches Muster wie der filledById-Check in updateReportDraft): jedes Mitglied muss
  // ein nicht deaktiviertes Mitglied DIESER Feuerwehr sein. Bereits gespeicherte Einträge bleiben
  // zulässig - ein inzwischen deaktiviertes/übersiedeltes Mitglied, das schon im Entwurf steht, darf
  // nicht jeden weiteren Speichervorgang der ganzen Liste blockieren.
  if (userIds.length > 0) {
    const [validUsers, existingMembers] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds }, homeOrganizationId: report.fireDepartmentId, ...NOT_DEACTIVATED_WHERE },
        select: { id: true },
      }),
      prisma.reportMember.findMany({ where: { reportId }, select: { userId: true } }),
    ]);
    const allowed = new Set([...validUsers.map((u) => u.id), ...existingMembers.map((m) => m.userId)]);
    if (userIds.some((id) => !allowed.has(id))) {
      return { error: 'Mindestens ein ausgewähltes Mitglied gehört nicht zu dieser Feuerwehr.' };
    }
  }

  await prisma.$transaction([
    prisma.reportMember.deleteMany({ where: { reportId } }),
    prisma.reportMember.createMany({
      data: members.map((member) => ({ reportId, userId: member.userId, funktion: member.funktion })),
    }),
  ]);
  revalidatePath(`/meine-feuerwehr/berichte/${reportId}`);
  return {};
}

export interface ReportQuantityPatchEntry {
  kind: 'MATERIAL' | 'EQUIPMENT';
  code: string;
  value: number;
}

/** Schritt 3 "Verbrauchsmaterial"/"Eingesetzte Geräte" - vollständiger Ersatz je Kind (MATERIAL/EQUIPMENT),
 * nur Zeilen mit value > 0 werden tatsächlich gespeichert (Bericht-Brief.md §5: "Nur befüllte Positionen"). */
export async function updateReportQuantities(
  reportId: string,
  quantities: ReportQuantityPatchEntry[],
): Promise<{ error?: string }> {
  const report = await loadReportForEdit(reportId);
  assertReportIsEditable(report);

  // Nur Codes aus der festen Liste der jeweiligen Art (MATERIAL -> MATERIALS, EQUIPMENT -> EQUIPMENT) -
  // ein manipulierter Aufruf könnte sonst beliebige Codes in einen offiziellen Bericht schreiben.
  for (const q of quantities) {
    const validCodes = q.kind === 'MATERIAL' ? MATERIAL_CODES : q.kind === 'EQUIPMENT' ? EQUIPMENT_CODES : null;
    if (!validCodes || !validCodes.has(q.code)) {
      return { error: 'Unbekannte Position in Material/Geräte.' };
    }
    if (typeof q.value !== 'number' || !Number.isFinite(q.value) || q.value < 0) {
      return { error: 'Mengen müssen eine Zahl ab 0 sein.' };
    }
  }

  const kinds = [...new Set(quantities.map((q) => q.kind))];
  const toKeep = quantities.filter((q) => q.value > 0);

  await prisma.$transaction([
    prisma.reportQuantity.deleteMany({ where: { reportId, kind: { in: kinds } } }),
    prisma.reportQuantity.createMany({
      data: toKeep.map((q) => ({ reportId, kind: q.kind, code: q.code, value: q.value })),
    }),
  ]);
  revalidatePath(`/meine-feuerwehr/berichte/${reportId}`);
  return {};
}
