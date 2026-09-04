export type TauglichkeitAmpel = 'tauglich' | 'untauglich' | 'unbekannt';

/**
 * Leitet aus dem rohen Tauglichkeitsart-Text eine einfache Ampel ab - reine Anzeige-Vereinfachung, der
 * volle Text bleibt daneben immer sichtbar (siehe atemschutz-edit-dialog.tsx/admin/heimatfeuerwehr/
 * page.tsx). "untauglich"/"nicht bestanden" müssen VOR "tauglich"/"bestanden" geprüft werden, da
 * "untauglich" den Teilstring "tauglich" selbst enthält. Anhand aller 11 in der realen Beispieldatei
 * vorkommenden Tauglichkeitsart-Werte verifiziert (siehe docs/superpowers/specs/
 * 2026-09-04-atemschutz-import-design.md).
 */
export function getTauglichkeitAmpel(text: string | null): TauglichkeitAmpel {
  if (!text) return 'unbekannt';
  const lower = text.toLowerCase();
  if (lower.includes('untauglich') || lower.includes('nicht bestanden')) return 'untauglich';
  if (lower.includes('tauglich') || lower.includes('bestanden')) return 'tauglich';
  return 'unbekannt';
}

/**
 * Extrahiert eine Gültigkeitsdauer in Jahren aus einem Tauglichkeitsart-Text, z. B. "1X: uneingeschränkt
 * tauglich für 5 Jahre" -> 5. Liefert null, wenn kein solches Muster erkennbar ist (z. B. "tauglich (ab
 * 1.1.2017)", "untauglich") - dann bleibt atemschutzGueltigBis beim Import unverändert (siehe Design-Spec).
 */
export function parseGueltigkeitsdauerJahre(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/für\s+(\d+)\s+jahr/i);
  return match ? Number(match[1]) : null;
}

/**
 * Datum + N Jahre, als "YYYY-MM-DD" - dieselbe Darstellung, die new Date(...) im restlichen
 * Atemschutz-Modul überall erwartet (siehe atemschutz-edit-dialog.tsx's eigenes addYears). isoDate muss
 * bereits "YYYY-MM-DD" sein.
 */
export function addYearsToIsoDate(isoDate: string, years: number): string {
  const date = new Date(isoDate);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}
