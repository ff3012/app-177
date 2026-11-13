/**
 * Einfache Mengenbegrenzung im Speicher (gleitendes Fenster je Schlüssel). Reicht für den einen App-Container;
 * ein Neustart setzt die Zähler zurück - akzeptiert, die Grenzen schützen vor Schleifen und Missbrauch, nicht
 * vor gezielten Angriffen (dafür gibt es die Anmeldung und die Rechteprüfung).
 *
 * Speicherbegrenzung: Ein Schlüssel wird sonst nur beim erneuten Prüfen desselben Schlüssels bereinigt, Einmal-
 * Schlüssel (z. B. wechselnde IPv6-Adressen) blieben ewig. Darum speichert jeder Eintrag sein eigenes Fenster,
 * und sobald die Map SWEEP_THRESHOLD Schlüssel überschreitet, werden alle Schlüssel entfernt, deren neuester
 * Treffer älter als ihr eigenes Fenster ist (die Sperre wäre dann ohnehin abgelaufen - kein Verhalten ändert sich).
 * Die Bereinigung läuft höchstens einmal pro Minute, damit sie bei vielen noch aktiven Schlüsseln nicht bei
 * jedem Aufruf die ganze Map durchläuft.
 */
const SWEEP_THRESHOLD = 10_000;
const SWEEP_MIN_INTERVAL_MS = 60_000;

const hits = new Map<string, { times: number[]; windowMs: number }>();
let lastSweepAt = 0;

function sweepExpired(now: number): void {
  lastSweepAt = now;
  for (const [key, entry] of hits) {
    const newest = entry.times[entry.times.length - 1];
    if (newest === undefined || now - newest >= entry.windowMs) hits.delete(key);
  }
}

/** Anzahl der aktuell im Speicher gehaltenen Schlüssel (für Tests und Diagnose). */
export function rateLimitKeyCount(): number {
  return hits.size;
}

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  if (hits.size > SWEEP_THRESHOLD && Math.abs(now - lastSweepAt) >= SWEEP_MIN_INTERVAL_MS) sweepExpired(now);
  const recent = (hits.get(key)?.times ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, { times: recent, windowMs });
    const retryMs = windowMs - (now - recent[0]);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
  }
  recent.push(now);
  hits.set(key, { times: recent, windowMs });
  return { allowed: true, retryAfterSeconds: 0 };
}
