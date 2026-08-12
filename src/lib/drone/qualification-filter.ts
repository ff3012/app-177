import { AUSBILDUNGSSTUFEN, type Ausbildungsstufe } from '@/lib/validation/user.schema';

export const QUALIFICATION_NONE = 'NONE';

const QUALIFICATION_LABELS: Record<Ausbildungsstufe, string> = {
  a1a3LizenzAm: 'A1/A3 Pilotenlizenz',
  a2LizenzAm: 'A2 Pilotenlizenz',
  stuetzpunktausbildungAm: 'Stützpunktausbildung',
  bos1AusbildungAm: 'BOS1 Ausbildung',
  bos2AusbildungAm: 'BOS2 Ausbildung',
};

/** Nur die fünf echten Stufen als Checkboxen - "Ohne Ausbildung" hat seit der Vereinfachung keine
 * eigene Checkbox mehr, siehe resolveSelectedQualifications: der Zustand "keine Checkbox aktiv"
 * bedeutet jetzt direkt "Ohne Ausbildung", statt "kein Filter". */
export const QUALIFICATION_OPTIONS: { key: Ausbildungsstufe; label: string }[] = AUSBILDUNGSSTUFEN.map((key) => ({
  key,
  label: QUALIFICATION_LABELS[key],
}));

export const QUALIFICATION_DEFAULT_KEY: Ausbildungsstufe = 'bos1AusbildungAm';

/** Diese drei Stufen zeigen beim Ankreuzen NUR Mitglieder, die GENAU hier stehen geblieben sind
 * (Stufe gesetzt, nächste Stufe nicht) - gedacht, um Ausbildungslücken zu finden ("wer muss noch
 * ausgebildet werden, um BOS1 zu erreichen"). BOS1/BOS2 bleiben bewusst außen vor und zeigen weiterhin
 * "hat diese Stufe erreicht" inklusive höherer Stufen - BOS1 ist das Ausbildungsziel, der Filter soll
 * dort also weiterhin jeden zeigen, der es erreicht hat (auch wer zusätzlich schon BOS2 hat), nicht nur
 * die, die exakt auf BOS1 stehen geblieben sind. */
const EXACT_STAGE_KEYS: ReadonlySet<Ausbildungsstufe> = new Set(['a1a3LizenzAm', 'a2LizenzAm', 'stuetzpunktausbildungAm']);

type MembershipDates = Record<Ausbildungsstufe, Date | null>;

/**
 * Höchste tatsächlich erreichte Ausbildungsstufe eines Mitglieds - null, wenn noch keine gesetzt
 * ist. Verlässt sich auf dieselbe Präfix-Invariante wie userSchema's .superRefine() (eine Stufe ist
 * nur gesetzt, wenn jede vorangehende es auch ist), daher reicht ein Abbruch beim ersten
 * ungesetzten Feld statt jede Stufe einzeln zu prüfen. Geteilt zwischen diesem Filter (Einzelvergleich
 * pro Stufe) und der Einsatzbereitschaft-Auswertung (Verteilung aller Mitglieder über die Stufen),
 * damit beide nie auseinanderlaufen können.
 */
export function getExactStage(membership: MembershipDates): Ausbildungsstufe | null {
  let current: Ausbildungsstufe | null = null;
  for (const key of AUSBILDUNGSSTUFEN) {
    if (membership[key] === null) break;
    current = key;
  }
  return current;
}

function matchesSingleQualification(membership: MembershipDates, key: string): boolean {
  if (key === QUALIFICATION_NONE) return membership.a1a3LizenzAm === null;
  const stufe = key as Ausbildungsstufe;
  if (membership[stufe] === null) return false;
  if (!EXACT_STAGE_KEYS.has(stufe)) return true;
  const nextStufe = AUSBILDUNGSSTUFEN[AUSBILDUNGSSTUFEN.indexOf(stufe) + 1];
  return membership[nextStufe] === null;
}

/**
 * Löst den rohen ?qualifikation=-Parameter zur tatsächlichen Auswahl auf - gemeinsame Stelle für
 * page.tsx (Serverseite, wird direkt an matchesQualification weitergegeben) und
 * flight-sidebar.tsx (Client-Anfangszustand für die Checkboxen), damit beide nie auseinanderlaufen
 * können. Drei Fälle:
 * - Parameter fehlt ganz (noch nie angefasst) -> Standardauswahl BOS1.
 * - Parameter ist exakt das 'NONE'-Sentinel (geschrieben, wenn der Nutzer die letzte Checkbox
 *   deaktiviert hat, siehe flight-sidebar.tsx's toggleQualification) -> "Ohne Ausbildung". Bewusst
 *   [QUALIFICATION_NONE] statt eines leeren Arrays: da keine der fünf echten Stufen-Keys je 'NONE'
 *   ist, verhält sich `selectedQualifications.includes(irgendeineStufe)` für die Checkbox-Anzeige
 *   automatisch korrekt (immer false) - kein zweiter, gesondert zu pflegender "leerer" Zustand
 *   nötig, ein einziges Array deckt beide Verwendungen (Checkbox-Haken UND Filter-Eingabe) ab.
 * - Sonst: kommagetrennte Liste echter Stufen-Keys, unbekannte/fremde Keys werden stillschweigend
 *   verworfen statt einen Fehler zu verursachen.
 */
export function resolveSelectedQualifications(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [QUALIFICATION_DEFAULT_KEY];
  if (raw === QUALIFICATION_NONE) return [QUALIFICATION_NONE];
  return raw.split(',').filter((key) => QUALIFICATION_OPTIONS.some((o) => o.key === key));
}

/**
 * ODER-Verknüpfung (Folgeänderung: war ursprünglich UND, siehe Git-Historie) - ein Mitglied wird
 * gezeigt, wenn es AUCH NUR EINE der ausgewählten Bedingungen erfüllt. Für A1/A3, A2 und
 * Stützpunktausbildung bedeutet "erfüllt" jetzt "genau hier stehen geblieben" (siehe
 * matchesSingleQualification/EXACT_STAGE_KEYS oben), für BOS1/BOS2 weiterhin "diese Stufe erreicht".
 * Eine UND-Verknüpfung würde bei den drei "genau hier"-Stufen nie mehr als eine gleichzeitig
 * erfüllen können (niemand steht an zwei verschiedenen Stufen zugleich), ODER ist daher die einzig
 * sinnvolle Kombination, sobald mehr als eine dieser drei Checkboxen gleichzeitig aktiv ist -
 * z. B. "A1/A3 + A2" zeigt dann alle, die entweder bei A1/A3 oder bei A2 stehen geblieben sind.
 * `selectedQualifications` enthält laut toggleQualification (flight-sidebar.tsx) nie 'NONE' UND eine
 * echte Stufe gleichzeitig (die UI räumt 'NONE' automatisch aus dem Array, sobald eine echte
 * Checkbox aktiviert wird) - der Fall wird deshalb nicht gesondert behandelt.
 */
export function matchesQualification(membership: MembershipDates, selected: string[]): boolean {
  return selected.some((key) => matchesSingleQualification(membership, key));
}
