/** Formats a Date as a value suitable for an <input type="datetime-local"> (local time, no seconds). */
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

const VIENNA_TIME_ZONE = 'Europe/Vienna';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole-day difference between two dates in Europe/Vienna, ignoring time-of-day - used to tell
 * "heute"/"gestern" apart from a same-24h-but-crossed-midnight case (e.g. 23:50 vs 00:10 next day
 * is 0 elapsed hours but a different calendar day). */
function viennaDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: VIENNA_TIME_ZONE }); // YYYY-MM-DD, sortable/diffable
}

export interface RelativeDateResult {
  /** Short label for display, e.g. "heute 08:14", "vor 3 Tagen", "noch nie angemeldet". */
  label: string;
  /** Full timestamp for a title/tooltip attribute (e.g. "14.03.2026, 08:14") - undefined when date is null. */
  title?: string;
}

/**
 * Deutschsprachiger Format-Helfer für Zeitstempel wie "zuletzt angemeldet"/"Passwort zuletzt
 * geändert" (Benutzerverwaltung-Brief.md §2) - immer serverseitig in Europe/Vienna berechnet und
 * als fertigen String übergeben, NIE clientseitig via toLocaleDateString, da das bei
 * unterschiedlichen Server-/Browser-Zeitzonen eine Hydration-Warnung erzeugen würde.
 *
 * heute 08:14
 * gestern 19:22
 * vor 3 Tagen
 * 14.03.2026            (älter als 7 Tage)
 * <fallback>             (date === null)
 */
export function formatRelativeDate(date: Date | null, options: { fallback: string }): RelativeDateResult {
  if (!date) {
    return { label: options.fallback };
  }

  const now = new Date();
  const time = date.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: VIENNA_TIME_ZONE });
  const title = `${date.toLocaleDateString('de-AT', { timeZone: VIENNA_TIME_ZONE })}, ${time}`;

  const todayKey = viennaDateKey(now);
  const dateKey = viennaDateKey(date);
  if (dateKey === todayKey) {
    return { label: `heute ${time}`, title };
  }

  const yesterday = new Date(now.getTime() - DAY_MS);
  if (dateKey === viennaDateKey(yesterday)) {
    return { label: `gestern ${time}`, title };
  }

  const daysAgo = Math.round((now.getTime() - date.getTime()) / DAY_MS);
  if (daysAgo >= 0 && daysAgo <= 7) {
    return { label: `vor ${daysAgo} Tagen`, title };
  }

  return { label: date.toLocaleDateString('de-AT', { timeZone: VIENNA_TIME_ZONE }), title };
}

/** True if date is null or more than 12 months in the past - used to mute stale "zuletzt aktiv"
 * table entries (Benutzerverwaltung-Brief.md §2, Tabellenspalte). */
export function isOlderThanMonths(date: Date | null, months: number): boolean {
  if (!date) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return date < cutoff;
}
