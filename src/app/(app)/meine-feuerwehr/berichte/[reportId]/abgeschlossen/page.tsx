import Link from 'next/link';
import { loadReportForPage } from '@/lib/heimatfeuerwehr/report-access';
import { REPORT_TYPE_LABEL } from '@/lib/heimatfeuerwehr/report-constants';

export default async function ReportAbgeschlossenPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  // Kein Entwurf-Konzept mehr - jeder existierende Bericht ist bereits abgegeben (number/submittedAt
  // sind nicht mehr nullable), daher hier kein Status-Zweig/notFound-Fall mehr nötig.
  const report = await loadReportForPage(reportId);

  // "Als PDF öffnen" zeigt bewusst auf die eigene, sitzungsgeprüfte Redirect-Route statt auf eine hier
  // beim Rendern vorab signierte S3-URL - die wäre nach 60 Sekunden abgelaufen, wenn der Tab länger offen
  // bleibt. Die Route signiert bei jedem Klick neu (gleiches Muster wie die Verwaltungs-Ansicht) und
  // übernimmt auch die 404-/Berechtigungslogik.
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <h1 className="text-[22px] font-bold text-[#1c1c1e]">Bericht abgegeben</h1>
      <p className="text-sm text-neutral-500">
        {REPORT_TYPE_LABEL[report.type]} Nr. {report.number} / {report.year}
      </p>
      <Link href="/meine-feuerwehr" className="mt-4 rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white">
        Zur Startseite
      </Link>
      <a
        href={`/meine-feuerwehr/berichte/${report.id}/pdf`}
        className="rounded-lg border border-brand px-6 py-3 text-sm font-semibold text-brand"
      >
        Als PDF öffnen
      </a>
    </div>
  );
}
