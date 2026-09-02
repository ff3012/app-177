'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';

/**
 * Persistiert die persönliche Sondergruppen-Filtereinstellung (welche Sondergruppen dieses Mitglied im
 * eigenen Kalender ausblendet) - direkt aufgerufen wie setRsvp, kein Formular-Submit nötig. Nimmt bewusst
 * das VOLLSTÄNDIGE, clientseitig bereits korrekt hergeleitete Set der aktuell ausgeblendeten Ids entgegen
 * (statt eines Toggle-Paars id+hidden gegen den rohen, ggf. noch leeren gespeicherten Wert) - der Client
 * kennt bereits die effektive Anzeige (inkl. des Opt-in-"leer heißt alle ausgeblendet"-Standardfalls aus
 * KalenderWithLayers), der Server muss diese Ambiguität nicht selbst auflösen. Reine Anzeige-Einstellung,
 * keine Sicherheitsprüfung nötig - jeder eingeloggte Nutzer darf seine eigene Einstellung jederzeit ändern.
 */
export async function setSondergruppenFilter(hiddenSondergruppenIds: string[]): Promise<void> {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { ausgeblendeteSondergruppenIds: hiddenSondergruppenIds },
  });
  revalidatePath('/kalender');
}
