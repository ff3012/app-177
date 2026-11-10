'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { after } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { canManageChecklists } from '@/lib/auth/permissions';
import { createChecklistDraft, discardChecklist, saveChecklistDraft, submitChecklist } from '@/lib/drone/checklist/service';
import type { MissingItem } from '@/lib/drone/checklist/rules';
import { deliverChecklist } from '@/lib/drone/checklist/delivery';

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };
export type SubmitResult = { ok: true } | { ok: false; error: string; missing?: MissingItem[] };

/** Legt einen Entwurf an und öffnet den Wizard (Formular-Action der Karte "Checkliste starten"). */
export async function startChecklist(droneGroupId: string): Promise<void> {
  const user = await requireUser();
  const result = await createChecklistDraft(user, droneGroupId);
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') notFound();
    redirect('/drohnen');
  }
  revalidatePath('/drohnen');
  redirect(`/drohnen/checkliste/${result.id}`);
}

/** Autosave / "Speichern" / Schrittwechsel - gibt den Speicherzeitpunkt zurück. */
export async function saveChecklistAction(id: string, step: number, data: unknown): Promise<SaveResult> {
  const user = await requireUser();
  const result = await saveChecklistDraft(user, { id, step, data });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, savedAt: result.savedAt.toISOString() };
}

/** Verwerfen (nie löschen) - Formular-Action der Entwurfsliste. */
export async function discardChecklistAction(id: string): Promise<void> {
  const user = await requireUser();
  const result = await discardChecklist(user, id);
  if (!result.ok && result.code === 'NOT_FOUND') notFound();
  revalidatePath('/drohnen');
}

/**
 * Speichert den letzten Stand und schließt die Checkliste ab. PDF und Mail laufen NACH der Antwort
 * (after) und können das Abschließen nie zurückrollen - ihr Ergebnis steht in mailedAt/mailError.
 */
export async function submitChecklistAction(id: string, data: unknown): Promise<SubmitResult> {
  const user = await requireUser();
  const saved = await saveChecklistDraft(user, { id, step: 8, data });
  if (!saved.ok) return { ok: false, error: saved.error };
  const result = await submitChecklist(user, id);
  if (!result.ok) return { ok: false, error: result.error, missing: result.missing };
  after(async () => {
    await deliverChecklist(id);
  });
  revalidatePath('/drohnen');
  return { ok: true };
}

/** Erneut senden an die AKTUELL hinterlegten Adressen - Admin der Gruppe. */
export async function resendChecklistMailAction(id: string): Promise<void> {
  const user = await requireUser();
  const checklist = await prisma.droneChecklist.findUnique({
    where: { id },
    include: { droneGroup: { select: { id: true, organizationId: true, featureChecklist: true } } },
  });
  if (!checklist || !checklist.droneGroup.featureChecklist || !canManageChecklists(user, checklist.droneGroup)) notFound();
  await deliverChecklist(id);
  revalidatePath('/admin/drohnen/checklisten');
}
