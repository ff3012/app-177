import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewPhotoUploadsFor, canManagePhotoUploadsFor } from '@/lib/auth/permissions';
import { PHOTO_UPLOAD_KIND_LABELS } from '@/lib/validation/photo-upload.schema';

export default async function FotoUploadsListePage() {
  const user = await requireUser();
  if (!canViewPhotoUploadsFor(user, user.homeOrganizationId)) notFound();

  const photoUploads = await prisma.photoUpload.findMany({
    where: { fireDepartmentId: user.homeOrganizationId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { photos: { where: { status: 'READY' } } } } },
  });

  const canManage = canManagePhotoUploadsFor(user, user.homeOrganizationId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">Foto Uploads</h1>
        {canManage && (
          <Link href="/foto-uploads/neu" className="text-sm font-medium text-brand">
            + Foto Upload
          </Link>
        )}
      </div>

      {photoUploads.length === 0 ? (
        <p className="text-sm text-neutral-500">Noch keine Foto Uploads erfasst.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-lg bg-white shadow-sm">
          {photoUploads.map((photoUpload) => (
            <li key={photoUpload.id}>
              <Link href={`/foto-uploads/${photoUpload.id}`} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                    {PHOTO_UPLOAD_KIND_LABELS[photoUpload.kind]}
                  </span>
                  <div className="mt-1 truncate text-sm font-medium text-neutral-900">{photoUpload.description}</div>
                  <div className="text-xs text-neutral-500">{photoUpload.occurredOn.toLocaleDateString('de-AT')}</div>
                </div>
                <span className="flex-none text-xs text-neutral-500">
                  {photoUpload._count.photos} Foto{photoUpload._count.photos === 1 ? '' : 's'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
