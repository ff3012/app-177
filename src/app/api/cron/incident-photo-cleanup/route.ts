import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { deletePhotoObjects } from '@/lib/storage/incident-photos-s3';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const providedSecret = new URL(request.url).searchParams.get('secret');
  const secret = process.env.CRON_SECRET;
  // Sicherheitshärtung gegenüber facebook-fetch/route.ts's Muster (`secret !== process.env.CRON_SECRET`,
  // siehe Security-Review S5): ein leerer/fehlender CRON_SECRET in der Umgebung würde bei jenem
  // Muster JEDE Anfrage ohne "secret"-Parameter durchlassen (undefined !== undefined ist false -
  // die Prüfung "besteht"). Dieses neue Route nutzt bewusst das stärkere Muster (`!secret ||
  // providedSecret !== secret`), das system-check/send-scheduled-news/atemschutz-warnung bereits
  // verwenden - kein bestehender Cron-Endpunkt wird dadurch verändert.
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const stale = await prisma.incidentPhoto.findMany({
    where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
    select: { id: true, storageKey: true },
  });

  for (const photo of stale) {
    try {
      await deletePhotoObjects([photo.storageKey]);
    } catch {
      // Ein einzelnes S3-Löschen darf die DB-Aufräumung nicht blockieren - gleiches Muster wie
      // fetchAndCacheFacebookPosts' Schleife (eigenes try/catch pro Eintrag).
    }
    await prisma.incidentPhoto.delete({ where: { id: photo.id } });
  }

  return NextResponse.json({ ok: true, count: stale.length });
}
