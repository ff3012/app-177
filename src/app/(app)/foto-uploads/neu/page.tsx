import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canManagePhotoUploadsFor } from '@/lib/auth/permissions';
import { PhotoUploadForm } from '@/components/photo-uploads/photo-upload-form';
import { createPhotoUpload } from '../actions';

export default async function NeuerFotoUploadPage() {
  const user = await requireUser();
  if (!canManagePhotoUploadsFor(user, user.homeOrganizationId)) notFound();

  const fireDepartment = await prisma.organization.findUniqueOrThrow({
    where: { id: user.homeOrganizationId },
    select: { shortName: true, name: true },
  });

  const boundCreate = createPhotoUpload.bind(null, user.homeOrganizationId);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold text-neutral-900">Foto Upload</h1>
      <PhotoUploadForm fireDepartmentName={fireDepartment.shortName ?? fireDepartment.name} action={boundCreate} submitLabel="Speichern und Fotos wählen" />
    </div>
  );
}
