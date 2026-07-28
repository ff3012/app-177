import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageFlight, canRegisterFlight, canViewAllFlights, canViewDroneModule } from '@/lib/auth/permissions';

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
  const flights = await prisma.droneFlight.findMany({
    where: seeAll ? {} : { registeredById: user.id },
    include: { drone: true, registeredBy: true, pilotUser: true },
    orderBy: { startsAt: 'desc' },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Flugbuch Drohnengruppe</h1>
          <p className="text-sm text-neutral-500">
            {seeAll ? 'Alle Einträge (Admin-Ansicht).' : 'Nur deine eigenen Einträge.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
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

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              <th className="px-4 py-2">Datum/Uhrzeit</th>
              <th className="px-4 py-2">Pilot</th>
              <th className="px-4 py-2">Ort</th>
              <th className="px-4 py-2">Drohne</th>
              <th className="px-4 py-2">Zweck</th>
              <th className="px-4 py-2">Erstellt von</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {flights.map((flight) => {
              const editable = canManageFlight(user, flight);
              return (
                <tr key={flight.id} className="border-b border-neutral-100">
                  <td className="px-4 py-2">{flight.startsAt.toLocaleString('de-AT')}</td>
                  <td className="px-4 py-2">
                    {flight.pilotUser.firstName} {flight.pilotUser.lastName}
                  </td>
                  <td className="px-4 py-2">{flight.location}</td>
                  <td className="px-4 py-2">{flight.drone.name}</td>
                  <td className="px-4 py-2">{PURPOSE_LABEL[flight.purpose] ?? flight.purpose}</td>
                  <td className="px-4 py-2">
                    {flight.registeredBy.firstName} {flight.registeredBy.lastName}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {editable && (
                      <Link href={`/drohnen/${flight.id}/bearbeiten`} className="text-brand hover:underline">
                        Bearbeiten
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {flights.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-500">
                  Noch keine Flüge erfasst.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
