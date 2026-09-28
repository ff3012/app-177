'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import { loadReportForEdit, assertReportIsEditable } from '@/lib/heimatfeuerwehr/report-access';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import type { ReportType } from '@prisma/client';

/** Berichtsart-Sheet (Bericht-Brief.md §1b) -> "Neuer Bericht" ohne Reservierung. Legt sofort einen
 * leeren DRAFT an und leitet zu Schritt 1 weiter. Nur ACTIVITY ist heute wirklich anlegbar - die
 * UI-Sperre für EXERCISE/INCIDENT sitzt im Berichtsart-Sheet selbst (report-type-sheet.tsx), diese
 * Funktion erlaubt aber ausdrücklich alle drei type-Werte, damit das Datenmodell für später keine
 * Migration braucht. */
export async function createReportDraft(type: ReportType): Promise<never> {
  const user = await requireUser();
  assertPermission(canCreateReportFor(user, user.homeOrganizationId));

  const now = new Date();
  const report = await prisma.report.create({
    data: {
      type,
      fireDepartmentId: user.homeOrganizationId,
      filledById: user.id,
      createdById: user.id,
      startAt: now,
      endAt: now,
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
