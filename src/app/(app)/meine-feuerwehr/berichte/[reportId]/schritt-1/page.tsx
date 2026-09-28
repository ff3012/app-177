import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { loadReportForPage } from '@/lib/heimatfeuerwehr/report-access';
import { ReportWizardHeader } from '../report-wizard-header';
import { Schritt1Form } from './schritt-1-form';

// Zeigt "Zuletzt verwendet" (die 3 zuletzt vom Benutzer gewählten Tätigkeitsarten, Bericht-Brief.md §5) -
// über alle bereits ABGEGEBENEN eigenen Berichte hinweg, neueste zuerst, ohne Duplikate.
async function getRecentActivityKinds(userId: string): Promise<string[]> {
  const recent = await prisma.report.findMany({
    where: { filledById: userId, status: 'SUBMITTED' },
    orderBy: { submittedAt: 'desc' },
    take: 10,
    select: { activityKinds: true },
  });
  const seen = new Set<string>();
  for (const report of recent) {
    for (const code of report.activityKinds) {
      seen.add(code);
      if (seen.size >= 3) return [...seen];
    }
  }
  return [...seen];
}

export default async function ReportSchritt1Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const report = await loadReportForPage(reportId);
  // Ein abgegebener Bericht ist unveränderlich (assertReportIsEditable blockiert jeden Schreibzugriff) -
  // statt eines scheinbar bearbeitbaren Formulars, das stillschweigend nichts speichert, direkt zur
  // Bestätigungsseite.
  if (report.status === 'SUBMITTED') {
    redirect(`/meine-feuerwehr/berichte/${reportId}/abgeschlossen`);
  }
  const user = await requireUser();

  const [members, recentActivityKinds] = await Promise.all([
    prisma.user.findMany({
      where: { homeOrganizationId: report.fireDepartmentId, ...NOT_DEACTIVATED_WHERE },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    }),
    getRecentActivityKinds(user.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <ReportWizardHeader step={1} backHref="/meine-feuerwehr" backLabel="Abbrechen" />
      <Schritt1Form
        report={{
          id: report.id,
          filledById: report.filledById,
          startAt: report.startAt.toISOString(),
          endAt: report.endAt.toISOString(),
          ownActivity: report.ownActivity,
          activityKinds: report.activityKinds,
          activityOther: report.activityOther,
        }}
        members={members}
        recentActivityKinds={recentActivityKinds}
        vehicleBooking={
          report.vehicleBooking
            ? { startsAt: report.vehicleBooking.startsAt.toISOString(), endsAt: report.vehicleBooking.endsAt.toISOString() }
            : null
        }
      />
    </div>
  );
}
