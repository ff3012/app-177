import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewIncidentsFor, canManageIncidentsFor, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { INCIDENT_KIND_LABELS } from '@/lib/validation/incident.schema';
import { IncidentDetailClient } from './incident-detail-client';

export default async function EinsatzDetailPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const user = await requireUser();

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      photos: {
        where: { status: 'READY' },
        orderBy: { createdAt: 'asc' },
        include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      },
      vehicles: { include: { vehicle: { select: { taktischeBezeichnung: true } } } },
    },
  });
  if (!incident || !canViewIncidentsFor(user, incident.fireDepartmentId)) notFound();

  const canManage = canManageIncidentsFor(user, incident.fireDepartmentId);
  // Eigener, echt admin-beschränkter Wert für die Foto-Lösch-Berechtigung in der Galerie -
  // canManage/canManageIncidentsFor ist laut Task 1 bewusst identisch zu canViewIncidentsFor ("jedes
  // Mitglied darf"), taugt also nicht als "ist Admin"-Gate für canDeleteIncidentPhoto (Uploader ODER
  // echter Feuerwehr-Admin, NICHT jedes Mitglied). canManageHeimatfeuerwehrFor ist die tatsächliche
  // Admin-Prüfung (Bezirksadmin ODER ADMIN-Membership dieser Feuerwehr).
  const isFeuerwehrAdmin = canManageHeimatfeuerwehrFor(user, incident.fireDepartmentId);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
            {INCIDENT_KIND_LABELS[incident.kind]}
          </span>
          <h1 className="mt-1 text-xl font-bold text-neutral-900">{incident.keyword}</h1>
          <p className="text-sm text-neutral-500">
            {incident.location} · {incident.alarmedAt.toLocaleString('de-AT')}
          </p>
        </div>
        {canManage && (
          <Link href={`/meine-feuerwehr/einsaetze/${incident.id}/bearbeiten`} className="text-sm text-brand hover:underline">
            Bearbeiten
          </Link>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 rounded-lg bg-white p-4 shadow-sm">
        <div>
          <div className="text-xs font-semibold uppercase text-neutral-500">Alarm</div>
          <div className="font-mono text-sm text-neutral-900">{incident.alarmedAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase text-neutral-500">Dauer</div>
          <div className="font-mono text-sm text-neutral-900">
            {incident.endedAt
              ? `${Math.round((incident.endedAt.getTime() - incident.alarmedAt.getTime()) / 60000)} min`
              : '–'}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase text-neutral-500">Mannschaft</div>
          <div className="font-mono text-sm text-neutral-900">{incident.crewCount ?? '–'}</div>
        </div>
      </div>

      {incident.vehicles.length > 0 && (
        <p className="text-sm text-neutral-600">
          Fahrzeuge: {incident.vehicles.map((v) => v.vehicle.taktischeBezeichnung).join(', ')}
        </p>
      )}

      <IncidentDetailClient
        incidentId={incident.id}
        canManage={canManage}
        isFeuerwehrAdmin={isFeuerwehrAdmin}
        currentUserId={user.id}
        photos={incident.photos.map((photo) => ({
          id: photo.id,
          uploadedById: photo.uploadedById,
          uploadedByName: `${photo.uploadedBy.firstName} ${photo.uploadedBy.lastName}`,
          takenAt: photo.takenAt?.toISOString() ?? null,
          byteSize: photo.byteSize,
          originalName: photo.originalName,
          publicRelease: photo.publicRelease,
        }))}
      />
    </div>
  );
}
