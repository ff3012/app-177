import Link from 'next/link';
import { loadReportForPage } from '@/lib/heimatfeuerwehr/report-access';
import { REPORT_TYPE_LABEL } from '@/lib/heimatfeuerwehr/report-constants';
import { presignReportPdfDownload } from '@/lib/storage/report-pdf-s3';
import { reportPdfFileName } from '@/lib/heimatfeuerwehr/report-pdf';

export default async function ReportAbgeschlossenPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const report = await loadReportForPage(reportId);

  const pdfFileName = reportPdfFileName(report.number!, report.submittedAt!);
  const pdfStorageKey = `${report.fireDepartmentId}/${pdfFileName}`;
  // PDF/S3 sind best-effort (submitReport, Task 9) - ein Bericht kann korrekt SUBMITTED sein, ohne dass
  // je ein PDF in S3 gelandet ist (z. B. S3 nicht konfiguriert). Diese App hat kein error.tsx, ein roher
  // Fehler hier würde also die ganze Bestätigungsseite abstürzen lassen, obwohl die Abgabe selbst
  // erfolgreich war - gleiches "abfangen und degradieren" Muster wie loadReportForPage
  // (report-access.ts) für genau denselben Grund.
  let pdfUrl: string | null = null;
  try {
    pdfUrl = await presignReportPdfDownload(pdfStorageKey);
  } catch (error) {
    console.error(`PDF-Download-Link für Bericht ${reportId} konnte nicht erzeugt werden:`, error);
  }

  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <h1 className="text-[22px] font-bold text-[#1c1c1e]">Bericht abgegeben</h1>
      <p className="text-sm text-neutral-500">
        {REPORT_TYPE_LABEL[report.type]} Nr. {report.number} / {report.year}
      </p>
      <Link href="/meine-feuerwehr" className="mt-4 rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white">
        Zur Startseite
      </Link>
      {pdfUrl && (
        <a href={pdfUrl} className="rounded-lg border border-brand px-6 py-3 text-sm font-semibold text-brand">
          Als PDF öffnen
        </a>
      )}
    </div>
  );
}
