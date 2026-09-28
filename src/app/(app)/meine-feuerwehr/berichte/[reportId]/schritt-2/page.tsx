import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { loadReportForPage } from '@/lib/heimatfeuerwehr/report-access';
import { ReportWizardHeader } from '../report-wizard-header';
import { Schritt2Form } from './schritt-2-form';

export default async function ReportSchritt2Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const report = await loadReportForPage(reportId);
  // Abgegeben = unveränderlich, siehe schritt-1/page.tsx.
  if (report.status === 'SUBMITTED') {
    redirect(`/meine-feuerwehr/berichte/${reportId}/abgeschlossen`);
  }

  const [vehicles, members, existingMembers] = await Promise.all([
    prisma.vehicle.findMany({
      where: { organizationId: report.fireDepartmentId, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
    }),
    prisma.user.findMany({
      where: { homeOrganizationId: report.fireDepartmentId, ...NOT_DEACTIVATED_WHERE },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.reportMember.findMany({ where: { reportId }, select: { userId: true, funktion: true } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <ReportWizardHeader step={2} backHref={`/meine-feuerwehr/berichte/${reportId}/schritt-1`} backLabel="Zurück" />
      <Schritt2Form
        reportId={reportId}
        fromBooking={report.vehicleBookingId !== null}
        initialVehicleId={report.vehicleId}
        initialVehicleKm={report.vehicleKm}
        vehicles={vehicles}
        members={members}
        initialMembers={existingMembers.map((m) => ({ userId: m.userId, funktion: m.funktion }))}
        filledById={report.filledById}
      />
    </div>
  );
}
