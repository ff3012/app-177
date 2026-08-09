import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { listDrohnengruppeMembers } from '@/lib/drone/members';
import { QuickFlightForm } from './quick-flight-form';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DrohnenSchnellPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const droneGroup = await prisma.droneGroup.findUnique({ where: { qrToken: token } });

  let content: React.ReactNode = <p className="text-neutral-700">Dieser Link ist ungültig.</p>;

  if (droneGroup) {
    const [drones, pilots] = await Promise.all([
      prisma.drone.findMany({ where: { isActive: true, droneGroupId: droneGroup.id }, orderBy: { sortOrder: 'asc' } }),
      listDrohnengruppeMembers(droneGroup.id),
    ]);

    content =
      drones.length === 0 || pilots.length === 0 ? (
        <p className="text-neutral-700">Es sind noch keine Drohnen oder Mitglieder dieser Drohnengruppe hinterlegt.</p>
      ) : (
        <>
          <h1 className="mb-1 text-lg font-semibold text-neutral-900">Flug registrieren</h1>
          <p className="mb-6 text-sm text-neutral-500">Drohnengruppe {droneGroup.name} – Schnellerfassung</p>
          <QuickFlightForm token={token} drones={drones} pilots={pilots} />
        </>
      );
  }

  return (
    <div className="pt-safe flex min-h-screen flex-col items-center bg-[#f6f6f7] px-4 py-10">
      <img src="/wappen-afkdo.png" alt="Wappen AFKDO Purkersdorf" className="mb-6 w-28" />
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow">{content}</div>
    </div>
  );
}
