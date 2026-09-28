import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { ACTIVE_REPORT_TYPES } from '@/lib/heimatfeuerwehr/report-constants';
import type { ReportType } from '@prisma/client';
import { ReportWizard } from './report-wizard';

// Zeigt "Zuletzt verwendet" (die 3 zuletzt vom Benutzer gewählten Tätigkeitsarten) - über alle
// bereits abgegebenen eigenen Berichte hinweg, neueste zuerst, ohne Duplikate. Kein Entwurf-Konzept
// mehr, also immer aus tatsächlich abgegebenen Berichten (jeder existierende Report ist abgegeben).
async function getRecentActivityKinds(userId: string): Promise<string[]> {
  const recent = await prisma.report.findMany({
    where: { filledById: userId },
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

/** Einzige Seite des Formulars - kein Entwurf-Konzept mehr, also keine [reportId]-Route und keine
 * serverseitige Autospeicherung: der Assistent (ReportWizard, Client Component) hält alle Eingaben
 * über alle 3 Schritte hinweg rein im Speicher (ein Schritt-Wechsel ist nur ein lokaler State-Wechsel,
 * keine Navigation), bis "Bericht abgeben" die Daten in EINEM Server-Action-Aufruf abschickt. Diese
 * Seite lädt einmalig alles, was der Assistent für alle 3 Schritte braucht (Mitgliederliste,
 * Fuhrpark, zuletzt verwendete Tätigkeitsarten). */
export default async function NeuerBerichtPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; vehicleId?: string; startAt?: string; endAt?: string }>;
}) {
  const user = await requireUser();
  assertPermission(canCreateReportFor(user, user.homeOrganizationId));

  const { type: typeParam, vehicleId: vehicleIdParam, startAt: startAtParam, endAt: endAtParam } = await searchParams;
  const type: ReportType = ACTIVE_REPORT_TYPES.includes(typeParam ?? '') ? (typeParam as ReportType) : 'ACTIVITY';

  const [members, vehicles, recentActivityKinds] = await Promise.all([
    prisma.user.findMany({
      where: { homeOrganizationId: user.homeOrganizationId, ...NOT_DEACTIVATED_WHERE },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.vehicle.findMany({
      where: { organizationId: user.homeOrganizationId, isActive: true },
      orderBy: { taktischeBezeichnung: 'asc' },
      select: { id: true, taktischeBezeichnung: true, kennzeichen: true },
    }),
    getRecentActivityKinds(user.id),
  ]);

  // Vorbefüllung aus einer "Zu erledigen"-Erinnerung (vehicle-report-reminder-card.tsx): vehicleId nur
  // übernehmen, wenn es tatsächlich zu einem Fahrzeug dieser (bereits geladenen) Liste gehört - ein
  // roher Query-Parameter wird nie ungeprüft übernommen, auch wenn submitReport selbst ohnehin
  // nochmals validiert. startAt/endAt nur bei gültigem, parsbarem Datum.
  const prefillVehicleId = vehicles.some((v) => v.id === vehicleIdParam) ? vehicleIdParam! : null;
  const prefillStartAt = startAtParam && !Number.isNaN(new Date(startAtParam).getTime()) ? startAtParam : null;
  const prefillEndAt = endAtParam && !Number.isNaN(new Date(endAtParam).getTime()) ? endAtParam : null;

  return (
    <ReportWizard
      type={type}
      filledById={user.id}
      members={members}
      vehicles={vehicles}
      recentActivityKinds={recentActivityKinds}
      prefillVehicleId={prefillVehicleId}
      prefillStartAt={prefillStartAt}
      prefillEndAt={prefillEndAt}
    />
  );
}
