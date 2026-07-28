import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { dispatchNewsMessage } from '@/lib/news/send-news';
import { recordNewsCronRun } from '@/lib/settings';

// Kein Login möglich für einen Cronjob - stattdessen ein geteiltes Secret als Query-Parameter,
// analog zum icsToken/QR-Schnellerfassungstoken-Muster (Capability statt Session).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const providedSecret = new URL(request.url).searchParams.get('secret');
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Wird bei jedem Lauf aktualisiert, auch wenn nichts fällig war - Status-Seite erkennt daran,
  // ob der Cronjob überhaupt noch regelmäßig aufgerufen wird.
  await recordNewsCronRun();

  const due = await prisma.newsMessage.findMany({
    where: { sentAt: null, scheduledAt: { lte: new Date() } },
    select: { id: true },
  });

  const results = await Promise.allSettled(due.map((news) => dispatchNewsMessage(news.id)));
  const sent = results.filter((result) => result.status === 'fulfilled').length;
  const failed = results.length - sent;

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Geplanter News-Versand fehlgeschlagen (${due[index].id}):`, result.reason);
    }
  });

  return NextResponse.json({ checked: due.length, sent, failed });
}
