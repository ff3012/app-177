/**
 * Einfache Mengenbegrenzung im Speicher (gleitendes Fenster je Schlüssel). Reicht für den einen App-Container;
 * ein Neustart setzt die Zähler zurück - akzeptiert, die Grenzen schützen vor Schleifen und Missbrauch, nicht
 * vor gezielten Angriffen (dafür gibt es die Anmeldung und die Rechteprüfung).
 */
const hits = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    const retryMs = windowMs - (now - recent[0]);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}
