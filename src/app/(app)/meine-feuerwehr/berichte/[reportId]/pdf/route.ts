import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { canViewReport } from '@/lib/auth/permissions';
import { presignReportPdfDownload } from '@/lib/storage/report-pdf-s3';
import { reportPdfStorageKey } from '@/lib/heimatfeuerwehr/report-pdf';

/** Mitglieder-Gegenstück zu admin/heimatfeuerwehr/berichte/[reportId]/pdf/route.ts: dünne,
 * sitzungsgeprüfte Redirect-Route, die bei JEDEM Klick eine frische (60 s gültige) presigned S3-URL
 * erzeugt - statt einer einmal beim Rendern der Bestätigungsseite signierten URL, die abläuft, sobald
 * der Tab länger als eine Minute offen bleibt. Gate ist canViewReport (Ersteller/Ausfüller bzw.
 * Heimatfeuerwehr-Admin für abgegebene Berichte), nicht canManageHeimatfeuerwehrFor, da dies die
 * eigene Ansicht des Berichtsinhabers ist. */
export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const user = await requireUser();

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  // Nicht sichtbar wird genauso beantwortet wie nicht vorhanden - verrät nicht, ob eine fremde ID
  // existiert. Kein Entwurf-Konzept mehr, jeder existierende Bericht hat number/submittedAt gesetzt.
  if (!report || !canViewReport(user, report)) {
    return NextResponse.json({ error: 'Bericht nicht gefunden.' }, { status: 404 });
  }

  const storageKey = reportPdfStorageKey(report.fireDepartmentId, report.number, report.submittedAt);
  // PDF/S3 sind best-effort (submitReport) - ohne S3-Konfiguration wirft presign. Die Bestätigungsseite
  // hat bis zu diesem Fix genau deshalb den Link ausgeblendet; jetzt zeigt sie ihn immer, daher hier
  // eine verständliche Antwort statt eines rohen 500.
  let url: string;
  try {
    url = await presignReportPdfDownload(storageKey);
  } catch (error) {
    console.error(`PDF-Download-Link für Bericht ${reportId} konnte nicht erzeugt werden:`, error);
    return NextResponse.json({ error: 'Das PDF ist derzeit nicht verfügbar.' }, { status: 503 });
  }
  return NextResponse.redirect(url);
}
