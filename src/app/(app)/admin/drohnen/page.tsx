import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { AddDroneForm } from './add-drone-form';
import { RenameDroneForm } from './rename-drone-form';
import { toggleDroneActive } from './actions';

export default async function DrohnenVerwaltungPage() {
  const user = await requireUser();
  if (!isSiteAdmin(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Abschnittskommando-Verwaltung sichtbar.</p>;
  }

  const drones = await prisma.drone.findMany({ orderBy: { sortOrder: 'asc' } });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Drohnen verwalten</h1>
        <div className="flex flex-wrap gap-4">
          <Link href="/admin/benutzer" className="text-sm text-brand hover:underline">
            Zur Benutzerverwaltung
          </Link>
          <Link href="/admin/email" className="text-sm text-brand hover:underline">
            E-Mail
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {drones.map((drone) => {
              const boundToggle = toggleDroneActive.bind(null, drone.id);
              return (
                <tr key={drone.id} className="border-b border-neutral-100">
                  <td className="px-4 py-2">
                    <RenameDroneForm droneId={drone.id} currentName={drone.name} />
                  </td>
                  <td className="px-4 py-2">{drone.isActive ? 'Aktiv' : 'Deaktiviert'}</td>
                  <td className="px-4 py-2 text-right">
                    <form action={boundToggle}>
                      <button type="submit" className="text-brand hover:underline">
                        {drone.isActive ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AddDroneForm />
    </div>
  );
}
