import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { loadReportForPage } from '@/lib/heimatfeuerwehr/report-access';
import { ReportWizardHeader } from '../report-wizard-header';
import { Schritt3Form } from './schritt-3-form';

export default async function ReportSchritt3Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const report = await loadReportForPage(reportId);
  // Abgegeben = unveränderlich, siehe schritt-1/page.tsx.
  if (report.status === 'SUBMITTED') {
    redirect(`/meine-feuerwehr/berichte/${reportId}/abgeschlossen`);
  }
  const quantities = await prisma.reportQuantity.findMany({ where: { reportId } });

  return (
    <div className="flex flex-col gap-4">
      <ReportWizardHeader step={3} backHref={`/meine-feuerwehr/berichte/${reportId}/schritt-2`} backLabel="Zurück" />
      <Schritt3Form
        reportId={reportId}
        initialRemark={report.remark ?? ''}
        initialQuantities={quantities.map((q) => ({ kind: q.kind, code: q.code, value: Number(q.value) }))}
      />
    </div>
  );
}
