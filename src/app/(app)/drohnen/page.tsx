import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageFlight, canRegisterFlight, canViewAllFlights, canViewDroneModule } from '@/lib/auth/permissions';
import {
  NINETY_DAY_REQUIRED_FLIGHTS,
  getComplianceUntilDate,
  getNinetyDayCutoff,
  meetsNinetyDayRule,
} from '@/lib/drone/ninety-day-rule';
import { listDrohnengruppeMembers } from '@/lib/drone/members';
import { FlightTable, type FlightRow } from '@/components/drone/flight-table';
import { NinetyDayRing } from '@/components/drone/ninety-day-ring';
import { GroupStatusChart, type PilotStatus } from '@/components/drone/group-status-chart';

const PURPOSE_LABEL: Record<string, string> = {
  UEBUNG: 'Übung',
  EINSATZ: 'Einsatz',
};

function formatDaysAgo(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Letzter Flug heute';
  if (days === 1) return 'Letzter Flug vor 1 Tag';
  return `Letzter Flug vor ${days} Tagen`;
}

export default async function DrohnenPage() {
  const user = await requireUser();

  if (!canViewDroneModule(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für Mitglieder der Drohnengruppe sichtbar.</p>;
  }

  const seeAll = canViewAllFlights(user);
  const cutoff = getNinetyDayCutoff();

  const [flights, ownFlightsInWindow, lastOwnFlight, groupMembers, groupCounts] = await Promise.all([
    prisma.droneFlight.findMany({
      where: seeAll ? {} : { OR: [{ registeredById: user.id }, { pilotUserId: user.id }] },
      include: { drone: true, registeredBy: true, pilotUser: true },
      orderBy: { startsAt: 'desc' },
    }),
    prisma.droneFlight.findMany({
      where: { pilotUserId: user.id, startsAt: { gte: cutoff } },
      orderBy: { startsAt: 'desc' },
      select: { startsAt: true },
    }),
    prisma.droneFlight.findFirst({
      where: { pilotUserId: user.id },
      orderBy: { startsAt: 'desc' },
      select: { startsAt: true },
    }),
    seeAll ? listDrohnengruppeMembers() : Promise.resolve([]),
    seeAll
      ? prisma.droneFlight.groupBy({ by: ['pilotUserId'], where: { startsAt: { gte: cutoff } }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);

  const ownFlightCount = ownFlightsInWindow.length;
  const ownRuleMet = meetsNinetyDayRule(ownFlightCount);
  const complianceUntil = getComplianceUntilDate(ownFlightsInWindow.map((f) => f.startsAt));

  const countByPilot = new Map(groupCounts.map((c) => [c.pilotUserId, c._count._all]));
  const pilotStatuses: PilotStatus[] = groupMembers.map((member) => {
    const count = countByPilot.get(member.id) ?? 0;
    return { id: member.id, name: `${member.lastName} ${member.firstName.charAt(0)}.`, count, met: meetsNinetyDayRule(count) };
  });

  const flightRows: FlightRow[] = flights.map((flight) => ({
    id: flight.id,
    startsAtLabel: flight.startsAt.toLocaleString('de-AT'),
    pilotName: `${flight.pilotUser.firstName} ${flight.pilotUser.lastName}`,
    pilotUserId: flight.pilotUserId,
    location: flight.location,
    droneName: flight.drone.name,
    purposeLabel: PURPOSE_LABEL[flight.purpose] ?? flight.purpose,
    registeredByName: `${flight.registeredBy.firstName} ${flight.registeredBy.lastName}`,
    registeredById: flight.registeredById,
    editable: canManageFlight(user, flight),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Flugbuch Drohnengruppe</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/drohnen/unterlagen"
            className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Unterlagen
          </Link>
          {seeAll && (
            <Link
              href="/drohnen/90-tage"
              className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100"
            >
              90 Tage Flüge
            </Link>
          )}
          {seeAll && (
            <a
              href="/drohnen/export"
              className="rounded border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Export Drohnenflüge
            </a>
          )}
          {canRegisterFlight(user) && (
            <Link href="/drohnen/neu" className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark">
              Flug registrieren
            </Link>
          )}
        </div>
      </div>

      {/* canRegisterFlight === canViewDroneModule, already the page-level gate above - every
          viewer here is a drone group member, so the own-status ring is unconditional. */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <NinetyDayRing
          count={ownFlightCount}
          required={NINETY_DAY_REQUIRED_FLIGHTS}
          met={ownRuleMet}
          complianceUntilLabel={complianceUntil ? complianceUntil.toLocaleDateString('de-AT') : null}
          lastFlightAgoLabel={lastOwnFlight ? formatDaysAgo(lastOwnFlight.startsAt) : null}
        />
        {seeAll && <GroupStatusChart pilots={pilotStatuses} />}
      </div>

      <FlightTable flights={flightRows} currentUserId={user.id} canToggle={seeAll} />
    </div>
  );
}
