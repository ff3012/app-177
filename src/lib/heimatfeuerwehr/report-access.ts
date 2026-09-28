import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canViewReport, ForbiddenError } from '@/lib/auth/permissions';

/** Lädt einen Bericht samt verknüpfter Reservierung und prüft canViewReport - einzige Ladefunktion für
 * jede Formular-Schritt-Seite (Task 3/4/5), damit die Sichtbarkeitsregel nicht an mehreren Stellen
 * dupliziert wird. */
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

/** Jede Schreib-Server-Action auf einem Report muss dies zuerst aufrufen - ein abgegebener Bericht ist
 * nicht mehr bearbeitbar (Bericht-Brief.md §9). */
export function assertReportIsEditable(report: { status: string }): void {
  if (report.status === 'SUBMITTED') {
    throw new ForbiddenError('Dieser Bericht wurde bereits abgegeben und kann nicht mehr bearbeitet werden.');
  }
}
