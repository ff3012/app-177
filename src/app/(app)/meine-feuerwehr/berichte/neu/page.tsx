import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { notFound } from 'next/navigation';
import { getEnabledReportTypes, pickReportType } from '@/lib/heimatfeuerwehr/report-type-settings';
import { getRecentActivityKindsForUser } from '@/lib/heimatfeuerwehr/recent-activity-kinds';
import { ReportWizard } from './report-wizard';

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
  // Nur eingeschaltete Arten: ein abgeschalteter oder unbekannter Wunsch fällt auf die erste eingeschaltete Art
  // zurück, ohne eingeschaltete Art gibt es das Formular nicht.
  const enabledTypes = await getEnabledReportTypes(user.homeOrganizationId);
  const type = pickReportType(typeParam, enabledTypes);
  if (!type) notFound();

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
    getRecentActivityKindsForUser(user.id, type),
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
