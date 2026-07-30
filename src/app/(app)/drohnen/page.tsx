import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageFlight, canRegisterFlight, canViewAllFlights, canViewDroneModule } from '@/lib/auth/permissions';
import { NINETY_DAY_REQUIRED_FLIGHTS, NINETY_DAY_WINDOW_DAYS, getNinetyDayCutoff, meetsNinetyDayRule } from '@/lib/drone/ninety-day-rule';
import { FlightTable, type FlightRow } from '@/components/drone/flight-table';

const PURPOSE_LABEL: Record<string, string> = {
  UEBUNG: 'Übung',
  EINSATZ: 'Einsatz',
};

export default async function DrohnenPage() {
  const user = await requireUser();

  if (!canViewDroneModule(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für Mitglieder der Drohnengruppe sichtbar.</p>;
  }

  const seeAll = canViewAllFlights(user);
  const [flights, ownFlightCount] = await Promise.all([
    prisma.droneFlight.findMany({
      where: seeAll ? {} : { OR: [{ registeredById: user.id }, { pilotUserId: user.id }] },
      include: { drone: true, registeredBy: true, pilotUser: true },
      orderBy: { startsAt: 'desc' },
    }),
    prisma.droneFlight.count({
      where: { pilotUserId: user.id, startsAt: { gte: getNinetyDayCutoff() } },
    }),
  ]);
  const ownRuleMet = meetsNinetyDayRule(ownFlightCount);

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
            <>
              <Link href="/drohnen/neu" className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark">
                Flug registrieren
              </Link>
              <span
                className={`rounded px-3 py-1.5 font-medium text-white ${ownRuleMet ? 'bg-green-600' : 'bg-red-600'}`}
                title={`90-Tage-Regel: ${ownFlightCount} von ${NINETY_DAY_REQUIRED_FLIGHTS} Flügen in den letzten ${NINETY_DAY_WINDOW_DAYS} Tagen`}
              >
                90-Tage-Regel
              </span>
            </>
          )}
        </div>
      </div>

      <FlightTable flights={flightRows} currentUserId={user.id} canToggle={seeAll} />
    </div>
  );
}
