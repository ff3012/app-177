import { prisma } from '@/lib/db/prisma';

export interface SondergruppeFormOption {
  id: string;
  name: string;
}

/**
 * Aktive Sondergruppen für die Auswahl im Termin-Formular - AUSSER currentSondergruppeId ist gesetzt
 * (Bearbeiten eines Termins mit bereits zugewiesener, inzwischen deaktivierter Sondergruppe): dann
 * bleibt genau diese eine Gruppe wählbar, auch wenn sie inzwischen deaktiviert wurde, sonst könnte
 * das Bearbeitungsformular den aktuellen Wert nicht mehr anzeigen (gleiches Muster wie
 * getManageableDroneGroupOptions in lib/calendar/drone-group-options.ts).
 */
export async function getSondergruppeOptions(
  currentSondergruppeId?: string | null,
): Promise<SondergruppeFormOption[]> {
  const groups = await prisma.sondergruppe.findMany({
    where: currentSondergruppeId ? { OR: [{ isActive: true }, { id: currentSondergruppeId }] } : { isActive: true },
    select: { id: true, name: true, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  return groups.map((g) => ({ id: g.id, name: g.isActive ? g.name : `${g.name} (deaktiviert)` }));
}
