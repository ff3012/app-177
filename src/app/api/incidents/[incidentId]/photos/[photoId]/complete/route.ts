import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { parse as parseExif } from 'exifr';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewIncidentsFor } from '@/lib/auth/permissions';
import { ALLOWED_SHARP_PHOTO_FORMATS, MAX_INCIDENT_PHOTO_BYTES, buildIncidentPhotoStorageKeys } from '@/lib/validation/incident-photo';
import { headPhotoObject, getPhotoObjectBytes, putPreviewObject, deletePhotoObjects } from '@/lib/storage/incident-photos-s3';

async function failPhoto(photoId: string, storageKey: string): Promise<void> {
  await deletePhotoObjects([storageKey]);
  await prisma.incidentPhoto.update({ where: { id: photoId }, data: { status: 'FAILED' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ incidentId: string; photoId: string }> }) {
  const user = await requireUser();
  const { incidentId, photoId } = await params;

  const photo = await prisma.incidentPhoto.findUnique({ where: { id: photoId }, include: { incident: true } });
  if (!photo || photo.incidentId !== incidentId || !canViewIncidentsFor(user, photo.incident.fireDepartmentId)) {
    return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 404 });
  }

  // Atomarer Claim statt reinem Lesen+Schreiben - verhindert, dass zwei nahezu gleichzeitige
  // complete-Aufrufe für dasselbe Foto (z. B. ein Client-Retry) beide die PENDING-Prüfung bestehen und
  // beide Vorschauen hochladen/auf READY setzen. Gleiches Muster wie consumeToken() in
  // lib/auth/tokens.ts und die Fahrzeug-Reservierung-TOCTOU-Behebung: updateMany mit dem alten Status
  // in der where-Klausel, count === 0 heißt "wurde bereits von woanders beansprucht".
  const claimed = await prisma.incidentPhoto.updateMany({
    where: { id: photo.id, status: 'PENDING' },
    data: { status: 'UPLOADING' },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: 'Foto wurde bereits verarbeitet.' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as { publicRelease?: boolean };

  const head = await headPhotoObject(photo.storageKey);
  if (!head) {
    // Kein failPhoto (kein Objekt zum Löschen vorhanden) - stattdessen zurück auf PENDING statt bei
    // UPLOADING hängen zu bleiben, da dieser Fall "Client hat complete zu früh aufgerufen, Upload läuft
    // noch" bedeutet und ein späterer echter Retry sonst fälschlich den 409-Zweig oben träfe.
    await prisma.incidentPhoto.update({ where: { id: photo.id }, data: { status: 'PENDING' } });
    return NextResponse.json({ error: 'Objekt wurde nicht gefunden - Upload unvollständig.' }, { status: 400 });
  }
  if (head.contentLength > MAX_INCIDENT_PHOTO_BYTES) {
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

  const { previewKey, thumbnailKey } = buildIncidentPhotoStorageKeys(incidentId, photo.id, photo.mimeType);
  const rotated = sharp(originalBytes).rotate();
  const [viewBuffer, thumbBuffer] = await Promise.all([
    rotated.clone().resize(1600, undefined, { fit: 'inside', withoutEnlargement: true }).webp().toBuffer(),
    rotated.clone().resize(400, 400, { fit: 'cover' }).webp().toBuffer(),
  ]);
  await Promise.all([
    putPreviewObject(previewKey, viewBuffer, 'image/webp'),
    putPreviewObject(thumbnailKey, thumbBuffer, 'image/webp'),
  ]);

  const updated = await prisma.incidentPhoto.update({
    where: { id: photo.id },
    data: {
      status: 'READY',
      byteSize: head.contentLength,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      takenAt,
      previewKey,
      thumbnailKey,
      publicRelease: body.publicRelease === true,
    },
  });

  return NextResponse.json({ photo: updated });
}
