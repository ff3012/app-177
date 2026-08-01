import { NextResponse } from 'next/server';
import { checkAndNotifyAtemschutzWarnungen } from '@/lib/heimatfeuerwehr/notify-atemschutz-warnung';

// Kein Login möglich für einen Cronjob - stattdessen ein geteiltes Secret als Query-Parameter,
// analog zu /api/cron/system-check. checkAndNotifyAtemschutzWarnungen() fängt Versandfehler pro
// Feuerwehr selbst ab - daher hier kein try/catch nötig.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const providedSecret = new URL(request.url).searchParams.get('secret');
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await checkAndNotifyAtemschutzWarnungen();

  return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
}
