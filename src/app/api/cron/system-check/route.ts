import { NextResponse } from 'next/server';
import { getSystemCheckResult } from '@/lib/system/system-check';
import { notifySystemCheckResult } from '@/lib/system/notify-system-check';

// Kein Login möglich für einen Cronjob - stattdessen ein geteiltes Secret als Query-Parameter,
// analog zu /api/cron/send-scheduled-news.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const providedSecret = new URL(request.url).searchParams.get('secret');
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await getSystemCheckResult();
  // notifySystemCheckResult no-opt selbst, wenn keine Empfänger-Adresse in AppSettings konfiguriert
  // ist, und fängt Versandfehler intern ab - daher hier kein try/catch nötig.
  await notifySystemCheckResult(result);

  return NextResponse.json({ ok: true, checkedAt: result.checkedAt });
}
