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
 * keine Berechtigungsprüfung nötig - jeder eingeloggte Nutzer darf seine eigene Einstellung jederzeit
 * ändern. Die eingehende Liste wird trotzdem gegen die tatsächlich existierenden Sondergruppen-Ids
 * geschnitten, bevor sie geschrieben wird - ohne das könnte jeder eingeloggte Nutzer ein beliebig
 * großes/unsinniges Array in User.ausgeblendeteSondergruppenIds schreiben; das Filtern begrenzt die
 * Array-Größe dabei automatisch auf höchstens die Gesamtzahl der Sondergruppen, ein separates
 * Längenlimit ist deshalb nicht nötig.
 */
export async function setSondergruppenFilter(hiddenSondergruppenIds: string[]): Promise<void> {
  const user = await requireUser();
  const validIds = new Set((await prisma.sondergruppe.findMany({ select: { id: true } })).map((gruppe) => gruppe.id));
  const filtered = hiddenSondergruppenIds.filter((id) => validIds.has(id));
  await prisma.user.update({
    where: { id: user.id },
    data: { ausgeblendeteSondergruppenIds: filtered },
  });
  // Beibehalten (nicht entfernt): ohne diese Revalidierung würde eine spätere frische Navigation zu
  // /kalender (neuer Tab, harter Reload) den Server-Query-Cache noch mit dem alten, gecachten
  // ausgeblendeteSondergruppenIds-Wert sehen, bis Next.js ohnehin neu revalidiert - für eine rein
  // client-seitige Kosmetik-Einstellung ein akzeptables, aber unnötiges Risiko. Die Kosten (ein
  // erneuter Server-Query bei jedem Toggle) sind hier gering genug, dass der defensive Charakter
  // überwiegt.
  revalidatePath('/kalender');
}
