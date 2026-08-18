import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManagePhotoUploadsFor } from '@/lib/auth/permissions';
import { PhotoUploadForm } from '@/components/photo-uploads/photo-upload-form';
import { DeletePhotoUploadButton } from '@/components/photo-uploads/delete-photo-upload-button';
import { updatePhotoUpload } from '../../actions';

export default async function FotoUploadBearbeitenPage({ params }: { params: Promise<{ photoUploadId: string }> }) {
  const { photoUploadId } = await params;
  const user = await requireUser();

  const photoUpload = await prisma.photoUpload.findUnique({
    where: { id: photoUploadId },
    include: { fireDepartment: { select: { shortName: true, name: true } } },
  });
  if (!photoUpload || !canManagePhotoUploadsFor(user, photoUpload.fireDepartmentId)) notFound();

  const boundUpdate = updatePhotoUpload.bind(null, photoUpload.id);
  const occurredOnValue = photoUpload.occurredOn.toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold text-neutral-900">Foto Upload bearbeiten</h1>
      <PhotoUploadForm
        fireDepartmentName={photoUpload.fireDepartment.shortName ?? photoUpload.fireDepartment.name}
        defaultValues={{ kind: photoUpload.kind, description: photoUpload.description, occurredOn: occurredOnValue }}
        action={boundUpdate}
        submitLabel="Änderungen speichern"
      />
      <div className="pb-44 sm:pb-0">
        <DeletePhotoUploadButton photoUploadId={photoUpload.id} />
      </div>
    </div>
  );
}
