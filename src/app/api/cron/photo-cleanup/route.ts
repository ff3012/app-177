import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { deletePhotoObjects } from '@/lib/storage/photo-uploads-s3';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 96 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const providedSecret = new URL(request.url).searchParams.get('secret');
  const secret = process.env.CRON_SECRET;
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Speicherbegrenzung (nicht Aufräumen fehlgeschlagener Uploads, siehe unten): ein kompletter
  // Foto Upload - samt allen Fotos, unabhängig vom Status - wird 96 Stunden nach seiner Erstellung
  // gelöscht, damit der Exoscale-S3-Bucket nicht unbegrenzt wächst. Diese Funktion ist als reine,
  // kurzlebige Foto-Sammlung gedacht, keine dauerhafte Einsatzdokumentation (siehe Design-Spec §0:
  // "Vereinfachung der Foto Uploads, keine Einsatz Erfassung"). Absichtlich an PhotoUpload.createdAt
  // gemessen, nicht am Upload-Zeitpunkt einzelner Fotos, damit ein Eintrag immer komplett und nie nur
  // teilweise verschwindet. S3-Objekte werden VOR dem DB-Delete entfernt (gleiche Reihenfolge wie
  // deletePhotoUpload in foto-uploads/actions.ts), sonst wären die Storage-Keys nach dem
  // kaskadierenden Löschen der Photo-Zeilen (onDelete: Cascade) unwiederbringlich verwaist.
  const expired = await prisma.photoUpload.findMany({
    where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
    select: { id: true, photos: { select: { storageKey: true, previewKey: true, thumbKey: true } } },
  });

  for (const photoUpload of expired) {
    const keys = photoUpload.photos
      .flatMap((photo) => [photo.storageKey, photo.previewKey, photo.thumbKey])
      .filter((key): key is string => key !== null);
    try {
      await deletePhotoObjects(keys);
    } catch {
      // Ein einzelnes S3-Löschen darf die DB-Aufräumung nicht blockieren.
    }
    await prisma.photoUpload.delete({ where: { id: photoUpload.id } });
  }

  // Erfasst PENDING (Upload nie zu Ende gebracht) UND UPLOADING (complete-Schritt abgestürzt,
  // bevor er den Status final auf READY/FAILED/zurück auf PENDING gesetzt hat - eine UPLOADING-Zeile
  // kann bereits eine oder beide Vorschauen erfolgreich hochgeladen haben, bevor sie abstürzte).
  // Läuft nach der 96h-Löschung oben: für Foto Uploads ab 96h hat die bereits alles entfernt, dieser
  // Pass fängt nur noch verwaiste Uploads zwischen 24h und 96h ab, deren Foto Upload selbst noch jünger
  // als 96h ist.
  const stale = await prisma.photo.findMany({
    where: { status: { in: ['PENDING', 'UPLOADING'] }, createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
    select: { id: true, storageKey: true, previewKey: true, thumbKey: true },
  });

  for (const photo of stale) {
    const keys = [photo.storageKey, photo.previewKey, photo.thumbKey].filter((key): key is string => key !== null);
    try {
      await deletePhotoObjects(keys);
    } catch {
      // Ein einzelnes S3-Löschen darf die DB-Aufräumung nicht blockieren.
    }
    await prisma.photo.delete({ where: { id: photo.id } });
  }

  return NextResponse.json({ ok: true, expiredPhotoUploads: expired.length, staleOrphanedPhotos: stale.length });
}
