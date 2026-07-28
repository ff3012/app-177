import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isSiteAdmin } from '@/lib/auth/permissions';
import { getDroneQuickRegisterToken } from '@/lib/settings';
import { AdminNav } from '@/components/layout/admin-nav';
import { AddDroneForm } from './add-drone-form';
import { RenameDroneForm } from './rename-drone-form';
import { toggleDroneActive, regenerateQuickRegisterLink } from './actions';

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

export default async function DrohnenVerwaltungPage() {
  const user = await requireUser();
  if (!isSiteAdmin(user)) {
    return <p className="text-neutral-700">Dieser Bereich ist nur für die Abschnittskommando-Verwaltung sichtbar.</p>;
  }

  const [drones, quickRegisterToken] = await Promise.all([
    prisma.drone.findMany({ orderBy: { sortOrder: 'asc' } }),
    getDroneQuickRegisterToken(),
  ]);
  const quickRegisterLink = quickRegisterToken ? `${baseUrl()}/drohnen-schnell/${quickRegisterToken}` : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-3 text-lg font-semibold text-neutral-900">Verwaltung</h1>
        <AdminNav />
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

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-neutral-900">QR-Code Schnellerfassung</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Dieser Link führt ohne Anmeldung direkt zum Formular „Flug registrieren“ – gedacht, um ihn als QR-Code
          auszudrucken. Wer den Link/QR-Code kennt, kann damit ausschließlich neue Flüge anlegen; andere Daten
          (bestehende Flüge, Benutzer, …) sind darüber nicht einsehbar. Ein neu erzeugter Link macht den alten QR-Code
          sofort ungültig.
        </p>

        {quickRegisterLink && (
          <p className="mb-3 break-all rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
            {quickRegisterLink}
          </p>
        )}

        <form action={regenerateQuickRegisterLink}>
          <button
            type="submit"
            className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark"
          >
            {quickRegisterLink ? 'Link neu erzeugen' : 'Link erzeugen'}
          </button>
        </form>
      </div>
    </div>
  );
}
