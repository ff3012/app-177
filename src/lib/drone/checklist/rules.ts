import { OPERATION_CHECK_KEYS, PREFLIGHT_CHECK_KEYS, type ChecklistData } from './data';

export const MAX_FLIGHT_HEIGHT = 120;

const GATE_TEXT_PREFLIGHT = 'Alle Punkte Nr. 15–16 abhaken oder Kommentar eintragen';
const GATE_TEXT_OPERATION = 'Alle Punkte Nr. 17 abhaken oder Kommentar eintragen';

function openCount(d: ChecklistData, keys: readonly string[]): number {
  return keys.filter((key) => d.checks?.[key] !== true).length;
}

export const openPreflightCount = (d: ChecklistData) => openCount(d, PREFLIGHT_CHECK_KEYS);
export const openOperationCount = (d: ChecklistData) => openCount(d, OPERATION_CHECK_KEYS);

/** Sperrgrund für das Weiterschalten von Schritt `step` (0-8) oder null. Gemeinsam genutzt vom Client
 * (Anzeige) und der Server Action (Prüfung). */
export function stepGate(step: number, d: ChecklistData): string | null {
  if (step === 4 && openPreflightCount(d) > 0 && !d.kommentar15?.trim()) return GATE_TEXT_PREFLIGHT;
  if (step === 5 && openOperationCount(d) > 0 && !d.kommentar17?.trim()) return GATE_TEXT_OPERATION;
  return null;
}

export interface MissingItem {
  text: string;
  step: number;
}

/** Pflichtpunkte zum Absenden; jeder Eintrag nennt den Schritt, zu dem die Oberfläche springt. */
export function missingForSubmit(d: ChecklistData): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!d.art) missing.push({ text: 'Art des Fluges', step: 0 });
  if (!d.drohnen || d.drohnen.length < 1) missing.push({ text: 'Eingesetztes Fluggerät', step: 0 });
  if (!d.grundlage) missing.push({ text: 'Grundlage des Fluges', step: 1 });
  if (d.hoehe === undefined || !(d.hoehe > 0)) missing.push({ text: 'Geplante Flughöhe', step: 1 });
  else if (d.hoehe > MAX_FLIGHT_HEIGHT) missing.push({ text: 'Flughöhe über 120 m', step: 1 });
  if (!d.pilot) missing.push({ text: 'Pilot', step: 2 });
  if (stepGate(4, d)) missing.push({ text: 'Vorflugkontrolle Nr. 15–16: offene Punkte ohne Kommentar', step: 4 });
  if (stepGate(5, d)) missing.push({ text: 'Betriebskontrolle Nr. 17: offene Punkte ohne Kommentar', step: 5 });
  if (!d.bestaetigt) missing.push({ text: 'Bestätigung des Piloten', step: 8 });
  return missing;
}
