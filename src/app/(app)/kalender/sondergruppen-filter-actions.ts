'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';

/**
 * Persistiert die persönliche Sondergruppen-Filtereinstellung (welche Sondergruppen dieses Mitglied im
 * eigenen Kalender ausblendet) - direkt aufgerufen wie setRsvp, kein Formular-Submit nötig. Lädt den
 * aktuellen Stand vor dem Schreiben und schreibt das komplette Array neu, statt eines reinen Prisma-
 * `push`, der bei hidden=true bei einem schnellen Doppelklick sonst dieselbe Id mehrfach anhängen
 * könnte. Reine Anzeige-Einstellung, keine Sicherheitsprüfung nötig (siehe Design-Spec) - jeder
 * eingeloggte Nutzer darf seine eigene Einstellung jederzeit ändern.
 */
export async function setSondergruppenFilter(sondergruppeId: string, hidden: boolean): Promise<void> {
  const user = await requireUser();
  const current = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { ausgeblendeteSondergruppenIds: true },
  });
  const withoutId = current.ausgeblendeteSondergruppenIds.filter((id) => id !== sondergruppeId);
  const next = hidden ? [...withoutId, sondergruppeId] : withoutId;
  await prisma.user.update({
    where: { id: user.id },
    data: { ausgeblendeteSondergruppenIds: next },
  });
  revalidatePath('/kalender');
}
