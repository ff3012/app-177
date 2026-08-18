import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { deletePhotoObjects } from '@/lib/storage/photo-uploads-s3';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const providedSecret = new URL(request.url).searchParams.get('secret');
  const secret = process.env.CRON_SECRET;
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Erfasst PENDING (Upload nie zu Ende gebracht) UND UPLOADING (complete-Schritt abgestürzt,
  // bevor er den Status final auf READY/FAILED/zurück auf PENDING gesetzt hat - eine UPLOADING-Zeile
  // kann bereits eine oder beide Vorschauen erfolgreich hochgeladen haben, bevor sie abstürzte).
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

  return NextResponse.json({ ok: true, count: stale.length });
}
