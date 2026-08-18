import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewPhotoUploadsFor, canManagePhotoUploadsFor, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { PHOTO_UPLOAD_KIND_LABELS } from '@/lib/validation/photo-upload.schema';
import { PhotoUploadDetailClient } from './photo-upload-detail-client';

export default async function FotoUploadDetailPage({ params }: { params: Promise<{ photoUploadId: string }> }) {
  const { photoUploadId } = await params;
  const user = await requireUser();

  const photoUpload = await prisma.photoUpload.findUnique({
    where: { id: photoUploadId },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      photos: { where: { status: 'READY' }, orderBy: { createdAt: 'asc' }, include: { uploadedBy: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!photoUpload || !canViewPhotoUploadsFor(user, photoUpload.fireDepartmentId)) notFound();

  const canManage = canManagePhotoUploadsFor(user, photoUpload.fireDepartmentId);
  const isFeuerwehrAdmin = canManageHeimatfeuerwehrFor(user, photoUpload.fireDepartmentId);
  // Speicherbegrenzung: src/app/api/cron/photo-cleanup/route.ts löscht den ganzen Foto Upload
  // automatisch 96h nach createdAt - hier nur zur Anzeige dupliziert, nicht als eigene Berechnung
  // der Cron-Route zu verstehen (die einzige Stelle, die tatsächlich löscht, bleibt die Route selbst).
  const deletionAt = new Date(photoUpload.createdAt.getTime() + 96 * 60 * 60 * 1000);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
            {PHOTO_UPLOAD_KIND_LABELS[photoUpload.kind]}
          </span>
          <h1 className="mt-1 text-xl font-bold text-neutral-900">{photoUpload.description}</h1>
          <p className="text-sm text-neutral-500">
            {photoUpload.occurredOn.toLocaleDateString('de-AT')} · Angelegt von {photoUpload.createdBy.firstName} {photoUpload.createdBy.lastName}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Wird automatisch gelöscht am {deletionAt.toLocaleDateString('de-AT')} um{' '}
            {deletionAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} Uhr.
          </p>
        </div>
        {canManage && (
          <Link href={`/foto-uploads/${photoUpload.id}/bearbeiten`} className="text-sm text-brand hover:underline">
            Bearbeiten
          </Link>
        )}
      </div>

      <PhotoUploadDetailClient
        photoUploadId={photoUpload.id}
        currentUserId={user.id}
        isFeuerwehrAdmin={isFeuerwehrAdmin}
        photos={photoUpload.photos.map((photo) => ({
          id: photo.id,
          uploadedById: photo.uploadedById,
          uploadedByName: `${photo.uploadedBy.firstName} ${photo.uploadedBy.lastName}`,
          takenAt: photo.takenAt?.toISOString() ?? null,
          byteSize: photo.byteSize,
          originalName: photo.originalName,
        }))}
      />
    </div>
  );
}
