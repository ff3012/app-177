'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';

export interface SwitchOrganizationState {
  error?: string;
}

/**
 * Selbstbedienung: tauscht die eigene aktive Heimat-Feuerwehr mit der zugewiesenen zweiten
 * Feuerwehr (siehe docs/superpowers/specs/2026-08-25-zweite-heimatfeuerwehr-design.md). Kein
 * eigenes Admin-Recht nötig - jeder eingeloggte User darf nur seinen eigenen Datensatz wechseln.
 * Tauscht homeOrganizationId/dienstgradId und secondaryOrganizationId/secondaryDienstgradId
 * atomar in einem einzigen prisma.user.update. Admin-Rechte (Membership-Tabelle) brauchen keine
 * eigene Prüfung hier - sie sind unabhängig von homeOrganizationId und werden bei jedem Request
 * ohnehin neu aus der Membership-Tabelle berechnet (build-session-user.ts).
 */
export async function switchHomeOrganization(): Promise<SwitchOrganizationState> {
  const currentUser = await requireUser();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: currentUser.id },
    select: {
      homeOrganizationId: true,
      dienstgradId: true,
      secondaryOrganizationId: true,
      secondaryDienstgradId: true,
    },
  });

  if (!user.secondaryOrganizationId) {
    return { error: 'Keine zweite Feuerwehr zugewiesen.' };
  }

  const target = await prisma.organization.findUnique({
    where: { id: user.secondaryOrganizationId },
    select: { isActive: true },
  });
  if (!target || !target.isActive) {
    return { error: 'Diese Feuerwehr ist aktuell deaktiviert und kann nicht aktive Heimat-Feuerwehr werden.' };
  }

  await prisma.user.update({
    where: { id: currentUser.id },
    data: {
      homeOrganizationId: user.secondaryOrganizationId,
      secondaryOrganizationId: user.homeOrganizationId,
      dienstgradId: user.secondaryDienstgradId,
      secondaryDienstgradId: user.dienstgradId,
    },
  });

  // Betrifft praktisch jede Seite (Kalender/Foto-Uploads/Fahrzeug-Reservierung/Kopfzeile lesen alle
  // homeOrganizationId) - '/' statt eines einzelnen Pfads revalidiert layout-weit, analog zu
  // anderen session-verändernden Aktionen in diesem Codebase.
  revalidatePath('/', 'layout');
  return {};
}
