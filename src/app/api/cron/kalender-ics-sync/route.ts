import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { syncIcsCalendarForOrganization } from '@/lib/calendar/ics-import';

export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const organizations = await prisma.organization.findMany({
    where: { icsImportUrl: { not: null } },
    select: { id: true, icsImportUrl: true },
  });

  let syncedCount = 0;
  for (const org of organizations) {
    try {
      await syncIcsCalendarForOrganization(org.id, org.icsImportUrl!);
      await prisma.organization.update({
        where: { id: org.id },
        data: { icsImportLastSyncAt: new Date(), icsImportLastSyncError: null },
      });
      syncedCount++;
    } catch (error) {
      // Eine Feuerwehr's fehlerhafter/nicht erreichbarer Feed darf die anderen nicht blockieren -
      // dasselbe Muster wie checkAndNotifyAtemschutzWarnungen()/fetchAndCacheFacebookPosts()
      // (eigenes try/catch pro Organisation). Der Fehler wird trotzdem sichtbar gemacht, damit
      // /admin/heimatfeuerwehr "Letzter Sync fehlgeschlagen" statt eines veralteten
      // Erfolgs-Zeitpunkts zeigt.
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler beim Synchronisieren.';
      await prisma.organization
        .update({ where: { id: org.id }, data: { icsImportLastSyncAt: new Date(), icsImportLastSyncError: message } })
        .catch(() => {});
      continue;
    }
  }

  return NextResponse.json({ ok: true, count: organizations.length, synced: syncedCount });
}
