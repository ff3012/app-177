export type AusbildungStufe = 'a1a3LizenzAm' | 'a2LizenzAm' | 'bos1AusbildungAm' | 'bos2AusbildungAm';

/** Reihenfolge der Kette für DIESEN Import - bewusst nur 4 Stufen, OHNE stuetzpunktausbildungAm
 * (siehe Design-Spec Abschnitt 2.3: Stützpunktausbildung ist eine eigene, pro Drohnengruppe
 * unterschiedliche Schulung, keine Voraussetzung für BOS1/BOS2 - anders als in userSchema's
 * app-weiter 5-stufiger Kette, die davon unberührt bleibt). */
export const AUSBILDUNG_IMPORT_CHAIN: readonly AusbildungStufe[] = [
  'a1a3LizenzAm',
  'a2LizenzAm',
  'bos1AusbildungAm',
  'bos2AusbildungAm',
];

export interface AusbildungResolution {
  /** Stufen, die tatsächlich geschrieben werden sollen (Date-Wert aus der Datei). */
  updates: Partial<Record<AusbildungStufe, Date>>;
  /** Stufen, die übersprungen wurden, weil in der DB bereits ein Wert steht. */
  skippedAlreadySet: AusbildungStufe[];
  /** Stufen, die übersprungen wurden, weil eine Vorstufe (innerhalb der 4er-Kette) fehlt - je Eintrag
   * die betroffene Stufe und die fehlende Vorstufe, für die Zeilen-Meldung. */
  skippedMissingPrereq: { stufe: AusbildungStufe; fehlendeVorstufe: AusbildungStufe }[];
}

/**
 * Reine Funktion, keine DB-Zugriffe: berechnet für eine Zeile, welche der 4 Stufen tatsächlich
 * geschrieben werden dürfen. `current` sind die JETZT in der DB stehenden Werte (null = leer),
 * `fileValues` die aus der Import-Datei gelesenen Werte für dieselben 4 Stufen (null = Zelle leer
 * oder Spalte nicht vorhanden). Verarbeitet die Kette in AUSBILDUNG_IMPORT_CHAIN-Reihenfolge, damit
 * eine Vorstufe, die durch dieselbe Zeile neu gesetzt wird, bereits als "erfüllt" zählt, wenn die
 * nächste Stufe geprüft wird.
 */
export function resolveAusbildungUpdates(
  current: Record<AusbildungStufe, Date | null>,
  fileValues: Record<AusbildungStufe, Date | null>,
): AusbildungResolution {
  const updates: Partial<Record<AusbildungStufe, Date>> = {};
  const skippedAlreadySet: AusbildungStufe[] = [];
  const skippedMissingPrereq: { stufe: AusbildungStufe; fehlendeVorstufe: AusbildungStufe }[] = [];
  const resolved = new Map<AusbildungStufe, boolean>();

  for (let i = 0; i < AUSBILDUNG_IMPORT_CHAIN.length; i++) {
    const stufe = AUSBILDUNG_IMPORT_CHAIN[i];
    const currentValue = current[stufe];
    const fileValue = fileValues[stufe];

    if (currentValue !== null) {
      resolved.set(stufe, true);
      if (fileValue !== null) skippedAlreadySet.push(stufe);
      continue;
    }

    if (fileValue === null) {
      resolved.set(stufe, false);
      continue;
    }

    const vorstufe = i > 0 ? AUSBILDUNG_IMPORT_CHAIN[i - 1] : null;
    if (vorstufe && !resolved.get(vorstufe)) {
      skippedMissingPrereq.push({ stufe, fehlendeVorstufe: vorstufe });
      resolved.set(stufe, false);
      continue;
    }

    updates[stufe] = fileValue;
    resolved.set(stufe, true);
  }

  return { updates, skippedAlreadySet, skippedMissingPrereq };
}
