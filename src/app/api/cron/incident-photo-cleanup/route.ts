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

  // Findet I7 (Final-Review): ursprünglich nur status:'PENDING' - ein Absturz/Timeout zwischen der
  // atomaren UPLOADING-Übernahme in der complete-Route und deren terminaler Auflösung (READY/FAILED/
  // zurück auf PENDING) - das größte Zeitfenster im ganzen Feature (S3-Download + zwei sharp-Durchläufe +
  // zwei Vorschau-Uploads) - ließ eine solche Zeile für immer bei UPLOADING hängen: unsichtbar in jeder
  // UI-Query (alle filtern auf READY), nie von diesem Cron erfasst, mit verwaisten Original- UND
  // Vorschau-Objekten im Bucket. Jetzt werden beide Status erfasst und alle drei möglichen Storage-Keys
  // eingesammelt, da eine hängengebliebene UPLOADING-Zeile (anders als PENDING) bereits eine oder beide
  // Vorschauen hochgeladen haben kann, bevor sie abgestürzt ist.
  const stale = await prisma.incidentPhoto.findMany({
    where: { status: { in: ['PENDING', 'UPLOADING'] }, createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
    select: { id: true, storageKey: true, previewKey: true, thumbnailKey: true },
  });

  for (const photo of stale) {
    try {
      const keys = [photo.storageKey, photo.previewKey, photo.thumbnailKey].filter(
        (key): key is string => key !== null,
      );
      await deletePhotoObjects(keys);
    } catch {
      // Ein einzelnes S3-Löschen darf die DB-Aufräumung nicht blockieren - gleiches Muster wie
      // fetchAndCacheFacebookPosts' Schleife (eigenes try/catch pro Eintrag).
    }
    await prisma.incidentPhoto.delete({ where: { id: photo.id } });
  }

  return NextResponse.json({ ok: true, count: stale.length });
}
