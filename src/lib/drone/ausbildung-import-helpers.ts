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
  /** Stufen, die tatsächlich geschrieben werden sollen (Date-Wert aus der Datei) - überschreibt einen
   * eventuell bereits vorhandenen DB-Wert, siehe Funktionskommentar unten. */
  updates: Partial<Record<AusbildungStufe, Date>>;
  /** Stufen, die übersprungen wurden, weil eine Vorstufe (innerhalb der 4er-Kette) fehlt - je Eintrag
   * die betroffene Stufe und die fehlende Vorstufe, für die Zeilen-Meldung. */
  skippedMissingPrereq: { stufe: AusbildungStufe; fehlendeVorstufe: AusbildungStufe }[];
}

/**
 * Reine Funktion, keine DB-Zugriffe: berechnet für eine Zeile, welche der 4 Stufen tatsächlich
 * geschrieben werden dürfen. `current` sind die JETZT in der DB stehenden Werte (null = leer),
 * `fileValues` die aus der Import-Datei gelesenen Werte für dieselben 4 Stufen (null = Zelle leer
 * oder Spalte nicht vorhanden).
 *
 * Ein in der Datei vorhandener Wert wird übernommen, auch wenn die Stufe in der DB bereits ein
 * (ggf. abweichendes) Datum trägt - jeder Import soll den aktuellen Stand aus der Datei widerspiegeln,
 * nicht nur Lücken auffüllen (reale Nutzerrückmeldung: ein erneuter Import mit einem aktualisierten
 * Datum wurde bisher stillschweigend übersprungen). Ist der Datei-Wert mit dem DB-Wert IDENTISCH, wird
 * nichts geschrieben (kein unnötiges Update, und die "N Felder aktualisiert"-Zusammenfassung zählt dann
 * korrekt nur echte Änderungen - zweite Nutzerrückmeldung: ein erneuter Import derselben, unveränderten
 * Datei zeigte fälschlich jedes Mal dieselbe hohe Zahl an "aktualisiert", obwohl nichts geändert wurde).
 * Eine leere Zelle in der Datei lässt den bestehenden DB-Wert ebenfalls unangetastet - "kein Wert in der
 * Datei" heißt nicht "löschen".
 *
 * Die Vorstufen-Prüfung bleibt bestehen: eine Stufe wird nur geschrieben, wenn die vorherige Stufe der
 * 4er-Kette entweder schon in der DB steht oder durch dieselbe Zeile ebenfalls gerade gesetzt wird -
 * verarbeitet die Kette deshalb in AUSBILDUNG_IMPORT_CHAIN-Reihenfolge, damit eine Vorstufe, die durch
 * dieselbe Zeile neu gesetzt wird, bereits als "erfüllt" zählt, wenn die nächste Stufe geprüft wird.
 */
export function resolveAusbildungUpdates(
  current: Record<AusbildungStufe, Date | null>,
  fileValues: Record<AusbildungStufe, Date | null>,
): AusbildungResolution {
  const updates: Partial<Record<AusbildungStufe, Date>> = {};
  const skippedMissingPrereq: { stufe: AusbildungStufe; fehlendeVorstufe: AusbildungStufe }[] = [];
  const resolved = new Map<AusbildungStufe, boolean>();

  for (let i = 0; i < AUSBILDUNG_IMPORT_CHAIN.length; i++) {
    const stufe = AUSBILDUNG_IMPORT_CHAIN[i];
    const currentValue = current[stufe];
    const fileValue = fileValues[stufe];

    if (fileValue === null) {
      // Datei liefert für diese Stufe nichts - bestehenden Wert nicht anfassen, aber für die
      // Vorstufen-Prüfung der nächsten Stufe berücksichtigen, ob die DB hier schon etwas stehen hat.
      resolved.set(stufe, currentValue !== null);
      continue;
    }

    const vorstufe = i > 0 ? AUSBILDUNG_IMPORT_CHAIN[i - 1] : null;
    if (vorstufe && !resolved.get(vorstufe)) {
      skippedMissingPrereq.push({ stufe, fehlendeVorstufe: vorstufe });
      resolved.set(stufe, currentValue !== null);
      continue;
    }

    if (currentValue !== null && currentValue.getTime() === fileValue.getTime()) {
      // Datei-Wert ist identisch mit dem bereits gespeicherten Datum - nichts zu tun.
      resolved.set(stufe, true);
      continue;
    }

    updates[stufe] = fileValue;
    resolved.set(stufe, true);
  }

  return { updates, skippedMissingPrereq };
}
