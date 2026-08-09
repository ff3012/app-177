import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewAllFlights } from '@/lib/auth/permissions';
import { listDrohnengruppeMembers } from '@/lib/drone/members';
import { NINETY_DAY_REQUIRED_FLIGHTS, NINETY_DAY_WINDOW_DAYS, getNinetyDayCutoff, meetsNinetyDayRule } from '@/lib/drone/ninety-day-rule';

export default async function NinetyDayFlightsPage() {
  const user = await requireUser();

  if (!canViewAllFlights(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für Admin Drohnengruppe sichtbar.</p>;
  }

  const cutoff = getNinetyDayCutoff();
  const droneGroupId = user.droneGroupId!;

  // Scoped auf die eigene Drohnengruppe (über die Drohne, siehe Kommentar in drohnen/page.tsx) -
  // dieser Bericht darf keine Compliance-Daten anderer Drohnengruppen zeigen.
  const [members, counts] = await Promise.all([
    listDrohnengruppeMembers(droneGroupId),
    prisma.droneFlight.groupBy({
      by: ['pilotUserId'],
      where: { startsAt: { gte: cutoff }, drone: { droneGroupId } },
      _count: { _all: true },
    }),
  ]);

  const countByPilot = new Map(counts.map((c) => [c.pilotUserId, c._count._all]));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">90 Tage Flüge</h1>
        <p className="text-sm text-neutral-500">
          Mindestens {NINETY_DAY_REQUIRED_FLIGHTS} Flüge in den letzten {NINETY_DAY_WINDOW_DAYS} Tagen (ab heute).
        </p>
        <Link href="/drohnen" className="text-sm text-brand hover:underline">
          Zurück zum Flugbuch
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Flüge (90 Tage)</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const count = countByPilot.get(member.id) ?? 0;
              const met = meetsNinetyDayRule(count);
              return (
                <tr key={member.id} className="border-b border-neutral-100">
                  <td className="px-4 py-2">
                    {member.firstName} {member.lastName}
                  </td>
                  <td className="px-4 py-2">{count}</td>
                  <td className={`px-4 py-2 font-medium ${met ? 'text-green-700' : 'text-red-700'}`}>
                    {met ? `✓ erfüllt` : `✗ nicht erfüllt`}
                  </td>
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-neutral-500">
                  Keine Mitglieder der Drohnengruppe hinterlegt.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
