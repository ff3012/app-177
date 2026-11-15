import type { NotificationForm, ReportType } from '@prisma/client';
import type { NotificationFormState } from './notification-form-constants';
import { ACTIVE_REPORT_TYPES } from './report-constants';

export type KioskTileState = 'active' | 'off' | 'soon' | 'norecipient';

export interface KioskTile {
  key: 'ACTIVITY' | 'EXERCISE' | 'INCIDENT' | 'DRINKS' | 'DAMAGE';
  title: string;
  subtitle: string;
  state: KioskTileState;
  /** Berichtsart der Kachel; null bei den Meldeformularen (Getränkeautomat, Schadensmeldung). */
  type: ReportType | null;
  /** Meldeformular der Kachel; null bei den Berichts-Kacheln. */
  form: NotificationForm | null;
}

export const KIOSK_TILE_HINT = {
  off: 'Nicht aktiviert',
  soon: 'Bald verfügbar',
  norecipient: 'Kein Empfänger hinterlegt',
} as const;

const TILE_DEFINITIONS: {
  key: KioskTile['key'];
  title: string;
  subtitle: string;
  type: ReportType | null;
  form: NotificationForm | null;
}[] = [
  { key: 'ACTIVITY', title: 'Tätigkeitsbericht', subtitle: 'Dienste, Versammlungen, Wartung', type: 'ACTIVITY', form: null },
  { key: 'EXERCISE', title: 'Übungsbericht', subtitle: 'Geplante Übungen, Schulungen', type: 'EXERCISE', form: null },
  { key: 'INCIDENT', title: 'Einsatzbericht', subtitle: 'Alarmierungen, Einsätze', type: 'INCIDENT', form: null },
  { key: 'DRINKS', title: 'Getränkeautomat', subtitle: 'Meldung an Getränkewart', type: null, form: 'DRINKS' },
  { key: 'DAMAGE', title: 'Schadensmeldung', subtitle: 'Defekte Ausrüstung melden', type: null, form: 'DAMAGE' },
];

/**
 * Kacheln des Startbildschirms. Eine Berichts-Kachel ist nur aktiv, wenn die Art in der App freigeschaltet
 * (`ACTIVE_REPORT_TYPES`) UND für die Feuerwehr eingeschaltet ist; eine freigeschaltete, aber abgeschaltete Art ist
 * "off". Eine Meldekachel ist aktiv, wenn das Formular verfügbar ist (eingeschaltet UND mindestens ein Empfänger),
 * "norecipient" bei eingeschaltet ohne Empfänger, "off" bei abgeschaltet; ohne Angabe zum Formular bleibt sie "soon".
 * Alles Übrige (Einsatzbericht) ist "soon" (noch nicht verfügbar).
 */
export function getKioskTiles(
  enabledTypes: readonly string[],
  notificationStates: Partial<Record<string, NotificationFormState>> = {},
): KioskTile[] {
  return TILE_DEFINITIONS.map((definition) => {
    let state: KioskTileState = 'soon';
    if (definition.type && ACTIVE_REPORT_TYPES.includes(definition.type)) {
      state = enabledTypes.includes(definition.type) ? 'active' : 'off';
    } else if (definition.form) {
      const formState = notificationStates[definition.form];
      if (formState === 'available') state = 'active';
      else if (formState === 'norecipient') state = 'norecipient';
      else if (formState === 'off') state = 'off';
    }
    return { ...definition, state };
  });
}
