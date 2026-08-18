import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { parse as parseExif } from 'exifr';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewPhotoUploadsFor } from '@/lib/auth/permissions';
import { ALLOWED_SHARP_PHOTO_FORMATS, MAX_PHOTO_BYTES, buildPhotoStorageKeys } from '@/lib/validation/photo';
import { headPhotoObject, getPhotoObjectBytes, putPreviewObject, deletePhotoObjects } from '@/lib/storage/photo-uploads-s3';

async function failPhoto(photoId: string, storageKey: string): Promise<void> {
  await deletePhotoObjects([storageKey]);
  await prisma.photo.update({ where: { id: photoId }, data: { status: 'FAILED' } });
}

export async function POST(_request: Request, { params }: { params: Promise<{ photoUploadId: string; photoId: string }> }) {
  const user = await requireUser();
  const { photoUploadId, photoId } = await params;

  const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { photoUpload: true } });
  if (!photo || photo.photoUploadId !== photoUploadId || !canViewPhotoUploadsFor(user, photo.photoUpload.fireDepartmentId)) {
    return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 404 });
  }

  // Atomarer Claim gegen einen doppelten complete-Aufruf (z. B. ein Client-Retry) - dieselbe
  // updateMany/count-Guard-Technik wie consumeToken() (lib/auth/tokens.ts).
  const claimed = await prisma.photo.updateMany({ where: { id: photo.id, status: 'PENDING' }, data: { status: 'UPLOADING' } });
  if (claimed.count === 0) {
    return NextResponse.json({ error: 'Foto wurde bereits verarbeitet.' }, { status: 409 });
  }

  const head = await headPhotoObject(photo.storageKey);
  if (!head) {
    await prisma.photo.update({ where: { id: photo.id }, data: { status: 'PENDING' } });
    return NextResponse.json({ error: 'Objekt wurde nicht gefunden - Upload unvollständig.' }, { status: 400 });
  }
  if (head.contentLength > MAX_PHOTO_BYTES) {
    await failPhoto(photo.id, photo.storageKey);
    return NextResponse.json({ error: 'Datei zu groß (maximal 50 MB).' }, { status: 400 });
  }

  const originalBytes = await getPhotoObjectBytes(photo.storageKey);

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(originalBytes).metadata();
  } catch {
    await failPhoto(photo.id, photo.storageKey);
    return NextResponse.json({ error: 'Datei konnte nicht als Bild gelesen werden.' }, { status: 400 });
  }
  if (!metadata.format || !ALLOWED_SHARP_PHOTO_FORMATS.includes(metadata.format)) {
    await failPhoto(photo.id, photo.storageKey);
    return NextResponse.json({ error: 'Dateiformat nicht erlaubt.' }, { status: 400 });
  }

  let takenAt: Date | null = null;
  try {
    const exif = await parseExif(originalBytes, ['DateTimeOriginal']);
    if (exif?.DateTimeOriginal instanceof Date) takenAt = exif.DateTimeOriginal;
  } catch {
    takenAt = null;
  }

  const { previewKey, thumbKey } = buildPhotoStorageKeys(photoUploadId, photo.id, photo.mimeType);
  const rotated = sharp(originalBytes).rotate();
  const [viewBuffer, thumbBuffer] = await Promise.all([
    rotated.clone().resize(1600, undefined, { fit: 'inside', withoutEnlargement: true }).webp().toBuffer(),
    rotated.clone().resize(400, 400, { fit: 'cover' }).webp().toBuffer(),
  ]);
  await Promise.all([putPreviewObject(previewKey, viewBuffer, 'image/webp'), putPreviewObject(thumbKey, thumbBuffer, 'image/webp')]);

  const updated = await prisma.photo.update({
    where: { id: photo.id },
    data: { status: 'READY', byteSize: head.contentLength, width: metadata.width ?? null, height: metadata.height ?? null, takenAt, previewKey, thumbKey },
  });

  return NextResponse.json({ photo: updated });
}
