import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManageDroneFlights, canViewDroneModule } from '@/lib/auth/permissions';

const PURPOSE_LABEL: Record<string, string> = {
  UEBUNG: 'Übung',
  EINSATZ: 'Einsatz',
};

export default async function DrohnenPage() {
  const user = await requireUser();

  if (!canViewDroneModule(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für Mitglieder der Drohnengruppe sichtbar.</p>;
  }

  const flights = await prisma.droneFlight.findMany({
    include: { drone: true },
    orderBy: { startsAt: 'desc' },
  });
  const canManage = canManageDroneFlights(user);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Flugbuch Drohnengruppe</h1>
        {canManage && (
          <Link href="/drohnen/neu" className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark">
            Flug registrieren
          </Link>
        )}
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
              {canManage && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {flights.map((flight) => (
              <tr key={flight.id} className="border-b border-neutral-100">
                <td className="px-4 py-2">{flight.startsAt.toLocaleString('de-AT')}</td>
                <td className="px-4 py-2">{flight.pilotName}</td>
                <td className="px-4 py-2">{flight.location}</td>
                <td className="px-4 py-2">{flight.drone.name}</td>
                <td className="px-4 py-2">{PURPOSE_LABEL[flight.purpose] ?? flight.purpose}</td>
                {canManage && (
                  <td className="px-4 py-2 text-right">
                    <Link href={`/drohnen/${flight.id}/bearbeiten`} className="text-brand hover:underline">
                      Bearbeiten
                    </Link>
                  </td>
                )}
              </tr>
            ))}
            {flights.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-4 py-6 text-center text-neutral-500">
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
