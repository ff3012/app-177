const DEFAULT_MAX = 8;

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

/** Liest die zuletzt gemerkten Werte für `key`, neuester zuerst. Leeres Array bei fehlendem/
 * kaputtem Eintrag - nie ein Fehler nach oben, damit ein aufrufendes Formular nie deswegen
 * abstürzt. */
export function getRememberedValues(key: string): string[] {
  if (typeof window === 'undefined') return [];
  return readList(key);
}

/** Merkt `value` unter `key` (getrimmt, Duplikate entfernt, neuester zuerst, auf `max` gekappt).
 * Best-effort wie die bestehenden localStorage-Flags in dieser App (z. B.
 * NATIVE_PUSH_ENABLED_KEY) - ein Fehler (privater Modus o. ä.) blockiert nie die eigentliche
 * Formular-Aktion. */
export function rememberValue(key: string, value: string, max: number = DEFAULT_MAX): void {
  if (typeof window === 'undefined') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  try {
    const existing = readList(key).filter((entry) => entry !== trimmed);
    const next = [trimmed, ...existing].slice(0, max);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // best-effort - siehe Kommentar oben.
  }
}
