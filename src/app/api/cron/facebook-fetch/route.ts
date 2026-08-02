import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { fetchAndCacheFacebookPosts } from '@/lib/facebook/fetch-posts';

export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const organizations = await prisma.organization.findMany({
    where: { type: 'FEUERWEHR', facebookPageId: { not: null } },
    select: { id: true },
  });

  for (const org of organizations) {
    try {
      await fetchAndCacheFacebookPosts(org.id);
    } catch {
      // Eine Feuerwehr's Graph-API-Fehler darf die anderen nicht blockieren - dasselbe Muster wie
      // checkAndNotifyAtemschutzWarnungen() (eigenes try/catch pro Organisation).
      continue;
    }
  }

  return NextResponse.json({ ok: true, count: organizations.length });
}
