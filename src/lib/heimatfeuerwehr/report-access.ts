import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canViewReport, ForbiddenError } from '@/lib/auth/permissions';

/** Lädt einen bereits abgegebenen Bericht und prüft canViewReport - einzige Ladefunktion für jede
 * Stelle, die einen existierenden Bericht anzeigt (Bestätigungsseite, PDF-Routen), damit die
 * Sichtbarkeitsregel nicht an mehreren Stellen dupliziert wird. Es gibt kein Entwurf-Konzept mehr
 * (ein Report entsteht erst mit der Abgabe, siehe submitReport) - "laden" heißt hier also immer
 * "einen bereits abgegebenen Bericht laden", nie "einen in Bearbeitung befindlichen". Wirft (via
 * assertPermission) einen rohen ForbiddenError - korrekt für Server Actions/Routen, die normal werfen
 * sollen, aber NICHT direkt aus einer Seite heraus aufrufen (siehe loadReportForPage unten). */
export async function loadReport(reportId: string) {
  const user = await requireUser();
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) {
    throw new ForbiddenError('Bericht wurde nicht gefunden.');
  }
  assertPermission(canViewReport(user, report));
  return report;
}

/** Wrapper von loadReport speziell für den Render-Pfad einer Seite: diese App hat kein
 * error.tsx/global-error.tsx, ein roher ForbiddenError während des Renderns einer Server Component
 * würde also bis zu Next's generischer Fehlerseite durchschlagen statt der üblichen
 * notFound()-Behandlung (siehe z. B. admin/heimatfeuerwehr/page.tsx). Fängt daher ForbiddenError
 * (nicht sichtbar/nicht gefunden) ab und ruft stattdessen notFound() - loadReport selbst bleibt
 * unverändert, weiterhin normal werfend, für Server Actions/Routen korrekt so. */
export async function loadReportForPage(reportId: string) {
  try {
    return await loadReport(reportId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      notFound();
    }
    throw error;
  }
}
