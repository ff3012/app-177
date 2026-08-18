import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewIncidentsFor, canManageIncidentsFor } from '@/lib/auth/permissions';
import { INCIDENT_KIND_LABELS } from '@/lib/validation/incident.schema';

export default async function EinsaetzeListePage() {
  const user = await requireUser();
  if (!canViewIncidentsFor(user, user.homeOrganizationId)) notFound();

  const incidents = await prisma.incident.findMany({
    where: { fireDepartmentId: user.homeOrganizationId },
    orderBy: { alarmedAt: 'desc' },
    include: { _count: { select: { photos: true } } },
  });

  const canManage = canManageIncidentsFor(user, user.homeOrganizationId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">Einsätze</h1>
        {canManage && (
          <Link href="/meine-feuerwehr/einsaetze/neu" className="text-sm font-medium text-brand">
            + Einsatz erfassen
          </Link>
        )}
      </div>

      {incidents.length === 0 ? (
        <p className="text-sm text-neutral-500">Noch keine Einsätze erfasst.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-lg bg-white shadow-sm">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <Link href={`/meine-feuerwehr/einsaetze/${incident.id}`} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                    {INCIDENT_KIND_LABELS[incident.kind]}
                  </span>
                  <div className="mt-1 truncate text-sm font-medium text-neutral-900">{incident.keyword}</div>
                  <div className="text-xs text-neutral-500">
                    {incident.alarmedAt.toLocaleString('de-AT')} · {incident.location}
                  </div>
                </div>
                <span className="flex-none text-xs text-neutral-500">{incident._count.photos} Foto{incident._count.photos === 1 ? '' : 's'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
