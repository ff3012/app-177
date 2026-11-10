export interface Buffers {
  cv: number;
  grb: number;
  abstandMenschenansammlungen: number;
}

/** Sicherheitsabstände aus der Flughöhe `h` (m): CV = 0,1·h, GRB = h + CV, Abstand zu
 * Menschenansammlungen = GRB + CV + 120. Wird nie gespeichert, immer live berechnet. */
export function calcBuffers(h: number): Buffers {
  const cv = h * 0.1;
  const grb = h + cv;
  return { cv, grb, abstandMenschenansammlungen: grb + cv + 120 };
}

/** Eine Nachkommastelle, Dezimalkomma. */
export function formatMeters(value: number): string {
  return value.toFixed(1).replace('.', ',');
}
