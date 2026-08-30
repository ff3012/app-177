import { headers } from 'next/headers';

/**
 * Liest die Client-IP aus dem von Caddy weitergereichten x-forwarded-for-Header (erster Eintrag,
 * falls mehrere Proxies durchlaufen wurden). Fällt auf x-real-ip, dann auf 'unknown' zurück, falls
 * kein Header gesetzt ist (z. B. lokale Entwicklung ohne vorgeschalteten Reverse-Proxy) - alle
 * solchen Anfragen teilen sich dann einen gemeinsamen Sperr-Bucket, ein akzeptierter Kompromiss für
 * einen Fall, der in Produktion nicht auftritt.
 */
export async function getClientIp(): Promise<string> {
  const headersList = await headers();
  const forwardedFor = headersList.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return headersList.get('x-real-ip') ?? 'unknown';
}
