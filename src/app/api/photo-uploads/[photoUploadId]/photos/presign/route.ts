import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewPhotoUploadsFor } from '@/lib/auth/permissions';
import { ALLOWED_PHOTO_MIME_TYPES, MAX_PHOTO_BYTES, buildPhotoStorageKeys } from '@/lib/validation/photo';
import { presignPhotoUpload } from '@/lib/storage/photo-uploads-s3';

export async function POST(request: Request, { params }: { params: Promise<{ photoUploadId: string }> }) {
  const user = await requireUser();
  const { photoUploadId } = await params;

  const photoUpload = await prisma.photoUpload.findUnique({ where: { id: photoUploadId }, select: { fireDepartmentId: true } });
  if (!photoUpload || !canViewPhotoUploadsFor(user, photoUpload.fireDepartmentId)) {
    return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { fileName?: string; mimeType?: string; byteSize?: number } | null;
  if (!body?.fileName || !body.mimeType || typeof body.byteSize !== 'number') {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });
  }
  if (!ALLOWED_PHOTO_MIME_TYPES.includes(body.mimeType)) {
    return NextResponse.json({ error: 'Dateityp nicht erlaubt.' }, { status: 400 });
  }
  if (body.byteSize <= 0 || body.byteSize > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: 'Datei zu groß (maximal 50 MB).' }, { status: 400 });
  }

  const photo = await prisma.photo.create({
    data: {
      photoUploadId,
      uploadedById: user.id,
      storageKey: '',
      originalName: body.fileName,
      mimeType: body.mimeType,
      byteSize: body.byteSize,
      status: 'PENDING',
    },
  });

  const { storageKey } = buildPhotoStorageKeys(photoUploadId, photo.id, body.mimeType);
  await prisma.photo.update({ where: { id: photo.id }, data: { storageKey } });

  const uploadUrl = await presignPhotoUpload(storageKey, body.mimeType);
  return NextResponse.json({ photoId: photo.id, uploadUrl, storageKey });
}
