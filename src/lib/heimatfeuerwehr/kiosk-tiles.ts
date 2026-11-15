import type { ReportType } from '@prisma/client';
import { ACTIVE_REPORT_TYPES } from './report-constants';

export type KioskTileState = 'active' | 'off' | 'soon';

export interface KioskTile {
  key: 'ACTIVITY' | 'EXERCISE' | 'INCIDENT' | 'DRINKS' | 'DAMAGE';
  title: string;
  subtitle: string;
  state: KioskTileState;
  /** Berichtsart der Kachel; null bei Formularen, die keine Berichte sind (Getränkeautomat, Schadensmeldung). */
  type: ReportType | null;
}

export const KIOSK_TILE_HINT = { off: 'Nicht aktiviert', soon: 'Bald verfügbar' } as const;

const TILE_DEFINITIONS: { key: KioskTile['key']; title: string; subtitle: string; type: ReportType | null }[] = [
  { key: 'ACTIVITY', title: 'Tätigkeitsbericht', subtitle: 'Dienste, Versammlungen, Wartung', type: 'ACTIVITY' },
  { key: 'EXERCISE', title: 'Übungsbericht', subtitle: 'Geplante Übungen, Schulungen', type: 'EXERCISE' },
  { key: 'INCIDENT', title: 'Einsatzbericht', subtitle: 'Alarmierungen, Einsätze', type: 'INCIDENT' },
  { key: 'DRINKS', title: 'Getränkeautomat', subtitle: 'Meldung an Getränkewart', type: null },
  { key: 'DAMAGE', title: 'Schadensmeldung', subtitle: 'Defekte Ausrüstung melden', type: null },
];

/**
 * Kacheln des Startbildschirms. Aktiv ist eine Berichts-Kachel nur, wenn die Art in der App freigeschaltet
 * (`ACTIVE_REPORT_TYPES`) UND für die Feuerwehr eingeschaltet ist; eine freigeschaltete, aber abgeschaltete Art
 * ist "off", alles Übrige "soon" (noch nicht verfügbar).
 */
export function getKioskTiles(enabledTypes: readonly string[]): KioskTile[] {
  return TILE_DEFINITIONS.map((definition) => {
    let state: KioskTileState = 'soon';
    if (definition.type && ACTIVE_REPORT_TYPES.includes(definition.type)) {
      state = enabledTypes.includes(definition.type) ? 'active' : 'off';
    }
    return { ...definition, state };
  });
}
