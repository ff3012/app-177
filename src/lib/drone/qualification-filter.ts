import { AUSBILDUNGSSTUFEN, type Ausbildungsstufe } from '@/lib/validation/user.schema';

export const QUALIFICATION_NONE = 'NONE';

const QUALIFICATION_LABELS: Record<Ausbildungsstufe, string> = {
  a1a3LizenzAm: 'A1/A3 Pilotenlizenz',
  a2LizenzAm: 'A2 Pilotenlizenz',
  stuetzpunktausbildungAm: 'Stützpunktausbildung',
  bos1AusbildungAm: 'BOS1 Ausbildung',
  bos2AusbildungAm: 'BOS2 Ausbildung',
};

export const QUALIFICATION_OPTIONS: { key: Ausbildungsstufe | typeof QUALIFICATION_NONE; label: string }[] = [
  ...AUSBILDUNGSSTUFEN.map((key) => ({ key, label: QUALIFICATION_LABELS[key] })),
  { key: QUALIFICATION_NONE, label: 'Ohne Ausbildung' },
];

type MembershipDates = Record<Ausbildungsstufe, Date | null>;

/**
 * UND-Verknüpfung: ein Mitglied muss ALLE ausgewählten Bedingungen gleichzeitig erfüllen.
 * 'NONE' prüft, dass die erste Stufe (a1a3LizenzAm) NICHT gesetzt ist - da die Stufen sequenziell
 * aufeinander aufbauen (A1/A3 -> A2 -> Stützpunktausbildung -> BOS1 -> BOS2), bedeutet ein
 * ungesetztes a1a3LizenzAm automatisch, dass keine der fünf Stufen erreicht ist. Kombinationen wie
 * "BOS1 + A2" kollabieren dadurch praktisch auf "BOS1" (wer BOS1 hat, hat automatisch A2) - keine
 * Sonderbehandlung nötig, nur eine Konsequenz der UND-Logik. Ebenso liefert 'NONE' zusammen mit
 * einer echten Stufe konsequent immer false (widersprüchlich) - auch das bewusst nicht abgefangen.
 */
export function matchesQualification(membership: MembershipDates, selected: string[]): boolean {
  return selected.every((key) =>
    key === QUALIFICATION_NONE ? membership.a1a3LizenzAm === null : membership[key as Ausbildungsstufe] !== null,
  );
}
