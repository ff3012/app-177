import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canViewReport, ForbiddenError } from '@/lib/auth/permissions';

/** Lädt einen Bericht samt verknüpfter Reservierung und prüft canViewReport - einzige Ladefunktion für
 * jede Formular-Schritt-Seite (Task 3/4/5), damit die Sichtbarkeitsregel nicht an mehreren Stellen
 * dupliziert wird. Wirft (via assertPermission) einen rohen ForbiddenError - korrekt für Server
 * Actions, die normal werfen sollen, aber NICHT direkt aus einer Seite heraus aufrufen (siehe
 * loadReportForPage unten). */
export async function loadReportForEdit(reportId: string) {
  const user = await requireUser();
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { vehicleBooking: true },
  });
  if (!report) {
    throw new ForbiddenError('Bericht wurde nicht gefunden.');
  }
  assertPermission(canViewReport(user, report));
  return report;
}

/** Wrapper von loadReportForEdit speziell für den Render-Pfad einer Formular-Schritt-Seite (Task 3/4/5,
 * später auch schritt-2/schritt-3/abgeschlossen): diese App hat kein error.tsx/global-error.tsx, ein
 * roher ForbiddenError während des Renderns einer Server Component würde also bis zu Next's generischer
 * Fehlerseite durchschlagen statt der üblichen notFound()-Behandlung (siehe z. B.
 * admin/heimatfeuerwehr/page.tsx). Fängt daher ForbiddenError (nicht sichtbar/nicht gefunden) ab und
 * ruft stattdessen notFound() - loadReportForEdit selbst bleibt unverändert, weiterhin normal werfend,
 * für Server Actions korrekt so. */
export async function loadReportForPage(reportId: string) {
  try {
    return await loadReportForEdit(reportId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      notFound();
    }
    throw error;
  }
}

/** Jede Schreib-Server-Action auf einem Report muss dies zuerst aufrufen - ein abgegebener Bericht ist
 * nicht mehr bearbeitbar (Bericht-Brief.md §9). */
export function assertReportIsEditable(report: { status: string }): void {
  if (report.status === 'SUBMITTED') {
    throw new ForbiddenError('Dieser Bericht wurde bereits abgegeben und kann nicht mehr bearbeitet werden.');
  }
}
