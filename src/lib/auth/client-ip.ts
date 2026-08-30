import { headers } from 'next/headers';

/**
 * Liest die Client-IP aus dem von Caddy weitergereichten x-forwarded-for-Header - den LETZTEN
 * Eintrag, nicht den ersten. `docker/Caddyfile`'s reverse_proxy ist ein einzelner, ungetrusteter Hop
 * (kein `trusted_proxies`) und HÄNGT die echte Client-IP an einen bereits vorhandenen Header an,
 * statt ihn zu ersetzen - ein Client kann also einen beliebigen ersten Eintrag selbst mitschicken
 * (`X-Forwarded-For: 1.2.3.4`), wodurch nur der von Caddy selbst angehängte LETZTE Eintrag
 * vertrauenswürdig ist. Der erste Eintrag zu lesen (ursprüngliche, fehlerhafte Version dieser
 * Funktion) machte die gesamte IP-Sperre wirkungslos, da jede Anfrage sich einen neuen Sperr-Bucket
 * aussuchen konnte. Fällt auf 'unknown' zurück, falls kein Header gesetzt ist (z. B. lokale
 * Entwicklung ohne vorgeschalteten Reverse-Proxy) - alle solchen Anfragen teilen sich dann einen
 * gemeinsamen Sperr-Bucket, ein akzeptierter Kompromiss für einen Fall, der in Produktion nicht
 * auftritt. `x-real-ip` wird bewusst nicht mehr als Fallback gelesen - Caddy setzt diesen Header in
 * dieser Deployment-Konfiguration nicht, und er wäre ebenso clientseitig fälschbar wie der erste
 * x-forwarded-for-Eintrag.
 */
export async function getClientIp(): Promise<string> {
  const headersList = await headers();
  const forwardedFor = headersList.get('x-forwarded-for');
  if (!forwardedFor) {
    return 'unknown';
  }
  const entries = forwardedFor.split(',').map((entry) => entry.trim());
  return entries[entries.length - 1];
}
