import type { ChecklistStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/types/next-auth';
import {
  canConfirmChecklist,
  canDiscardChecklist,
  canEditChecklist,
  canViewChecklist,
} from '@/lib/auth/permissions';
import { checklistDataSchema, type ChecklistData } from './data';
import { isBos1PilotOf } from './service';
import { selectChecklistsForFlight } from './flight-selection';
import { checklistToFlightDefaults, type FlightDefaults } from './flight-defaults';

type GroupRef = { id: string; organizationId: string; featureChecklist: boolean };

const PURPOSE_TITLE = { EINSATZ: 'Einsatz', TRAINING: 'Training' } as const;

/** "{Einsatz|Training|Flug} · {Fluggebiet|ohne Fluggebiet}" - Titel in Listen und Auswahl. */
export function checklistTitle(c: { purpose: string | null; area: string | null }): string {
  const purpose = c.purpose === 'EINSATZ' || c.purpose === 'TRAINING' ? PURPOSE_TITLE[c.purpose] : 'Flug';
  return `${purpose} · ${c.area?.trim() || 'ohne Fluggebiet'}`;
}

function parseData(raw: unknown): ChecklistData {
  const parsed = checklistDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

const fullName = (u: { firstName: string; lastName: string } | null | undefined) => (u ? `${u.firstName} ${u.lastName}` : '-');

export interface DraftListItem {
  id: string;
  title: string;
  step: number;
  updatedAt: Date;
  isOwn: boolean;
  creatorName: string;
}

/** Alle Entwürfe der Gruppe, die der Benutzer sehen darf (jedes Mitglied sieht alle) - eigene zuerst, dann
 * neueste zuerst. Ohne Funktionsschalter der Gruppe: leer. */
export async function listGroupDrafts(user: SessionUser, droneGroupId: string): Promise<DraftListItem[]> {
  const group = await prisma.droneGroup.findUnique({ where: { id: droneGroupId }, select: { id: true, organizationId: true, featureChecklist: true } });
  if (!group || !group.featureChecklist) return [];
  const rows = await prisma.droneChecklist.findMany({
    where: { droneGroupId, status: 'DRAFT' },
    orderBy: { updatedAt: 'desc' },
    include: { createdBy: { select: { firstName: true, lastName: true } } },
  });
  return rows
    .filter((row) => canViewChecklist(user, row, group))
    .map((row) => ({
      id: row.id,
      title: checklistTitle(row),
      step: row.step,
      updatedAt: row.updatedAt,
      isOwn: row.createdById === user.id,
      creatorName: fullName(row.createdBy),
    }))
    .sort((a, b) => Number(b.isOwn) - Number(a.isOwn));
}

export interface FlightChecklistOption {
  id: string;
  title: string;
  status: ChecklistStatus;
  flightAt: Date;
  pilotName: string;
  linkedFlights: number;
  /** Vorbelegung des Flugformulars bei Auswahl dieser Checkliste. */
  defaults: FlightDefaults;
}

/** Auswahl für "Flug registrieren": die letzten 4 nicht verworfenen Checklisten, die der Benutzer sehen darf. */
export async function listChecklistsForFlight(user: SessionUser, droneGroup: GroupRef): Promise<FlightChecklistOption[]> {
  if (!droneGroup.featureChecklist) return [];
  // Großzügige Vorauswahl, die Sichtbarkeitsregel wendet selectChecklistsForFlight an.
  const rows = await prisma.droneChecklist.findMany({
    where: { droneGroupId: droneGroup.id, status: { not: 'DISCARDED' } },
    orderBy: { updatedAt: 'desc' },
    take: 60,
    include: { pilot: { select: { firstName: true, lastName: true } }, _count: { select: { flights: true } } },
  });
  return selectChecklistsForFlight(rows, user, droneGroup).map((row) => ({
    id: row.id,
    title: checklistTitle(row),
    status: row.status,
    flightAt: row.flightAt,
    pilotName: fullName(row.pilot),
    linkedFlights: row._count.flights,
    defaults: checklistToFlightDefaults({ flightAt: row.flightAt, data: parseData(row.data) }),
  }));
}

/** Darf der Benutzer einen Flug dieser Gruppe mit dieser Checkliste verknüpfen? (Client-Eingabe!) */
export async function resolveLinkableChecklist(user: SessionUser, droneGroupId: string, checklistId: string): Promise<boolean> {
  const checklist = await prisma.droneChecklist.findUnique({
    where: { id: checklistId },
    include: { droneGroup: { select: { id: true, organizationId: true, featureChecklist: true } } },
  });
  if (!checklist || checklist.droneGroupId !== droneGroupId || !checklist.droneGroup.featureChecklist) return false;
  if (checklist.status === 'DISCARDED') return false;
  return canViewChecklist(user, checklist, checklist.droneGroup);
}

export interface ChecklistCounts {
  drafts: number;
  submitted: number;
  discarded: number;
}

export async function checklistCounts(droneGroupId: string): Promise<ChecklistCounts> {
  const grouped = await prisma.droneChecklist.groupBy({ by: ['status'], where: { droneGroupId }, _count: { _all: true } });
  const count = (status: ChecklistStatus) => grouped.find((g) => g.status === status)?._count._all ?? 0;
  return { drafts: count('DRAFT'), submitted: count('SUBMITTED'), discarded: count('DISCARDED') };
}

export interface AdminChecklistItem {
  id: string;
  status: ChecklistStatus;
  flightAt: Date;
  title: string;
  pilotName: string;
  createdByName: string;
  step: number;
  updatedAt: Date;
  discardedAt: Date | null;
  mailedTo: string | null;
  mailedAt: Date | null;
  mailError: string | null;
  linkedFlights: number;
  createdById: string;
}

export async function listChecklistsAdmin(
  droneGroupId: string,
  opts: { status?: ChecklistStatus; page: number; pageSize: number },
): Promise<{ items: AdminChecklistItem[]; total: number }> {
  const where = { droneGroupId, ...(opts.status ? { status: opts.status } : {}) };
  const [total, rows] = await Promise.all([
    prisma.droneChecklist.count({ where }),
    prisma.droneChecklist.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (Math.max(1, opts.page) - 1) * opts.pageSize,
      take: opts.pageSize,
      include: {
        pilot: { select: { firstName: true, lastName: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        _count: { select: { flights: true } },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      flightAt: row.flightAt,
      title: checklistTitle(row),
      pilotName: fullName(row.pilot),
      createdByName: fullName(row.createdBy),
      step: row.step,
      updatedAt: row.updatedAt,
      discardedAt: row.discardedAt,
      mailedTo: row.mailedTo,
      mailedAt: row.mailedAt,
      mailError: row.mailError,
      linkedFlights: row._count.flights,
      createdById: row.createdById,
    })),
  };
}

export interface ChecklistView {
  checklist: {
    id: string;
    status: ChecklistStatus;
    step: number;
    flightAt: Date;
    purpose: string | null;
    area: string | null;
    data: ChecklistData;
    createdById: string;
    submittedById: string | null;
    updatedAt: Date;
    mailedTo: string | null;
    mailedAt: Date | null;
    mailError: string | null;
    pdfKey: string | null;
  };
  droneGroup: { id: string; name: string; organizationId: string };
  canEdit: boolean;
  canDiscard: boolean;
  canConfirm: boolean;
  /** Darf unabhängig vom gewählten Piloten bestätigen (Admin der Gruppe oder BOS1-Pilot) - der Wizard braucht
   * das, weil der Pilot dort noch geändert werden kann. */
  canConfirmAny: boolean;
}

/** Lädt eine Checkliste samt den Rechten des Benutzers - null, wenn sie fehlt, der Funktionsschalter der
 * Gruppe aus ist oder der Benutzer sie nicht sehen darf (Seiten antworten dann mit 404). */
export async function getChecklistView(user: SessionUser, id: string): Promise<ChecklistView | null> {
  const row = await prisma.droneChecklist.findUnique({
    where: { id },
    include: { droneGroup: { select: { id: true, name: true, organizationId: true, featureChecklist: true } } },
  });
  if (!row || !row.droneGroup.featureChecklist || !canViewChecklist(user, row, row.droneGroup)) return null;
  const parsed = checklistDataSchema.safeParse(row.data);
  const data: ChecklistData = parsed.success ? parsed.data : {};
  const bos1 = await isBos1PilotOf(user.id, row.droneGroupId);
  return {
    checklist: {
      id: row.id,
      status: row.status,
      step: row.step,
      flightAt: row.flightAt,
      purpose: row.purpose,
      area: row.area,
      data,
      createdById: row.createdById,
      submittedById: row.submittedById,
      updatedAt: row.updatedAt,
      mailedTo: row.mailedTo,
      mailedAt: row.mailedAt,
      mailError: row.mailError,
      pdfKey: row.pdfKey,
    },
    droneGroup: { id: row.droneGroup.id, name: row.droneGroup.name, organizationId: row.droneGroup.organizationId },
    canEdit: canEditChecklist(user, row, row.droneGroup, bos1),
    canDiscard: canDiscardChecklist(user, row, row.droneGroup),
    canConfirm: canConfirmChecklist(user, row.droneGroup, data.pilot ?? null, bos1),
    canConfirmAny: canConfirmChecklist(user, row.droneGroup, null, bos1),
  };
}
