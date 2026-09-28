import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { reportPdfStorageKey } from '@/lib/heimatfeuerwehr/report-pdf';
import { deleteReportPdf } from '@/lib/storage/report-pdf-s3';

const RETENTION_DAYS = 14;

/**
 * Löscht Tätigkeitsberichte, die länger als 14 Tage in der App liegen - auf ausdrücklichen Wunsch,
 * um App/S3 nicht dauerhaft mit denselben Daten zu belasten, die für einen abgegebenen Bericht
 * ohnehin schon per E-Mail beim konfigurierten Empfänger liegen (siehe Report-Recipients-Karte in
 * admin/heimatfeuerwehr). Das widerspricht NICHT der ursprünglichen "Berichte sind offizielle
 * Dokumente, werden dauerhaft aufbewahrt"-Begründung für den eigenen S3_REPORTS_BUCKET (siehe
 * report-pdf-s3.ts) - jene Begründung galt gegenüber der 96h-Foto-Löschung und bedeutet "nicht
 * automatisch wie Fotos", nicht "unbegrenzt in der App vorhalten". Die dauerhafte Aufbewahrung
 * geschieht jetzt beim E-Mail-Empfänger, nicht mehr in der App selbst.
 *
 * Zwei unabhängige Fristen, je nach Status:
 * - SUBMITTED: 14 Tage ab submittedAt (das Abgabedatum, ab dem die E-Mail-Kopie existiert) - inkl.
 *   Löschen des gespeicherten PDFs aus S3.
 * - DRAFT: 14 Tage ab createdAt, unabhängig vom Abgabedatum (das ein Entwurf ja noch nicht hat) -
 *   kein PDF vorhanden, nur die DB-Zeile.
 * Gleiches Secret-Muster wie jeder andere Cron in diesem Modul.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const providedSecret = new URL(request.url).searchParams.get('secret');
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const expiredSubmitted = await prisma.report.findMany({
    where: { status: 'SUBMITTED', submittedAt: { lt: cutoff } },
  });

  let deletedSubmitted = 0;
  for (const report of expiredSubmitted) {
    if (report.number !== null && report.submittedAt !== null) {
      const storageKey = reportPdfStorageKey(report.fireDepartmentId, report.number, report.submittedAt);
      try {
        await deleteReportPdf(storageKey);
      } catch (error) {
        // Best-effort wie überall bei S3 in diesem Modul - ein einzelner Fehler (z. B. S3 gerade
        // nicht erreichbar) darf weder diesen Bericht noch die übrigen Zeilen dieses Laufs blockieren.
        console.error(`PDF für Bericht ${report.id} konnte nicht gelöscht werden:`, error);
      }
    }
    await prisma.report.delete({ where: { id: report.id } });
    deletedSubmitted += 1;
  }

  const { count: deletedDrafts } = await prisma.report.deleteMany({
    where: { status: 'DRAFT', createdAt: { lt: cutoff } },
  });

  return NextResponse.json({ ok: true, deletedSubmitted, deletedDrafts, checkedAt: now.toISOString() });
}
