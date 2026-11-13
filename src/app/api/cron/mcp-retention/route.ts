import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { purgeMcpData } from '@/lib/mcp/retention';

// Beide Seiten hashen, damit die Längen gleich sind (timingSafeEqual verlangt das) und nichts über das Secret verraten wird.
function secretMatches(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Räumt täglich das MCP-Prüfprotokoll (180 Tage), abgelaufene/widerrufene OAuth-Token (30 Tage), alte
 * Autorisierungscodes und ungenutzte Clients auf. Läuft unabhängig vom Funktionsschalter. Gleiches Secret-Muster wie jeder
 * andere Cron (`?secret=`).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const providedSecret = new URL(request.url).searchParams.get('secret');
  if (!secret || !secretMatches(providedSecret, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await purgeMcpData();
  return NextResponse.json({ ok: true, ...result });
}
