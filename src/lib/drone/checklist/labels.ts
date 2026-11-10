import type { ChecklistData } from './data';

/** Anzeigetexte der Checkliste - gemeinsam für Wizard, PDF und E-Mail, damit alle drei dieselben
 * Bezeichnungen nutzen. Quelle: BOS-Formular "Checkliste_Drohnenflug_v9" (Projektgruppe Einsatz-Drohnen). */

export const ART_LABEL = { Einsatz: 'Einsatzflug', Training: 'Trainings- / Checkflug' } as const;

export const GRUNDLAGE_LABEL = {
  acg: 'Bescheid Austro Control',
  open: 'Kategorie OPEN',
  specific: 'BOS SPECIFIC über nicht dicht besiedeltem Gebiet',
} as const;

/** Kurzform für Listen/E-Mail: bei OPEN inklusive Unterkategorie. */
export function grundlageText(d: Pick<ChecklistData, 'grundlage' | 'openKat' | 'bescheid'>): string {
  if (!d.grundlage) return '-';
  if (d.grundlage === 'open') return d.openKat ? `Kategorie OPEN ${d.openKat}` : 'Kategorie OPEN';
  const base = GRUNDLAGE_LABEL[d.grundlage];
  return d.bescheid?.trim() ? `${base} (${d.bescheid.trim()})` : base;
}

export interface CheckItem {
  key: string;
  /** Laufende Nummer auf dem Formular. */
  nr: string;
  label: string;
}

/** Nr. 15-16 Vorflugkontrolle. */
export const PREFLIGHT_ITEMS: CheckItem[] = [
  { key: 'p_gesund', nr: '15.1', label: 'Pilot und Team sind gesund und einsatzfähig' },
  { key: 'p_fs', nr: '15.2', label: 'Fernsteuerung: Akku geladen, Antennen ausgerichtet' },
  { key: 'p_drohne', nr: '15.3', label: 'Drohne: Rahmen, Propeller und Motoren ohne Schäden' },
  { key: 'p_licht', nr: '15.4', label: 'Beleuchtung funktioniert' },
  { key: 'p_verb', nr: '15.5', label: 'Verbindung Fernsteuerung – Drohne steht' },
  { key: 'p_kamera', nr: '15.6', label: 'Kamera, Gimbal und Speicherkarte bereit' },
  { key: 'p_modus', nr: '16.1', label: 'Flugmodus eingestellt' },
  { key: 'p_rthpos', nr: '16.2', label: 'Rückkehrposition (RTH) gesetzt' },
  { key: 'p_rthh', nr: '16.3', label: 'Rückkehrhöhe (RTH) über dem höchsten Hindernis eingestellt' },
  { key: 'p_akku30', nr: '16.4', label: 'Akku der Drohne mindestens 30 %' },
  { key: 'p_akku20', nr: '16.5', label: 'Akku Fernsteuerung mindestens 20 %' },
];

/** Nr. 17 Startprozedere / Betriebskontrolle. */
export const OPERATION_ITEMS: CheckItem[] = [
  { key: 'b_start', nr: '17.1', label: 'Start und Abheben ohne Auffälligkeit' },
  { key: 'b_schweb', nr: '17.2', label: 'Schwebeflug stabil, kein Abdriften' },
  { key: 'b_akku', nr: '17.3', label: 'Akkuanzeige plausibel, keine rasche Entladung' },
  { key: 'b_r360', nr: '17.4', label: 'Drehung rechts 360°' },
  { key: 'b_l360', nr: '17.5', label: 'Drehung links 360°' },
  { key: 'b_gr', nr: '17.6', label: 'Steuerung nach rechts' },
  { key: 'b_gl', nr: '17.7', label: 'Steuerung nach links' },
  { key: 'b_vor', nr: '17.8', label: 'Flug vorwärts 2 m' },
  { key: 'b_rueck', nr: '17.9', label: 'Flug rückwärts 2 m' },
  { key: 'b_land', nr: '17.10', label: 'Landung wie vorgesehen' },
];

/** Nr. 18-23 Nachkontrolle (Haken ohne Sperre). */
export const POSTFLIGHT_ITEMS: CheckItem[] = [
  { key: 'n_kam', nr: '21.1', label: 'Kamera' },
  { key: 'n_gimbal', nr: '21.2', label: 'Gimbal' },
  { key: 'n_sens', nr: '21.3', label: 'Sensoren' },
  { key: 'n_schein', nr: '21.4', label: 'Scheinwerfer' },
  { key: 'n_licht', nr: '21.5', label: 'Beleuchtung' },
  { key: 'n_akku', nr: '21.6', label: 'Akkus' },
  { key: 'n_sd', nr: '22', label: 'Speicherkarte geleert / gesichert' },
];

export const N18_LABEL = { ok: 'Drohne in Ordnung', wartung: 'Wartung erforderlich' } as const;
export const N19_LABEL = { ok: 'Akkus in Ordnung', tausch: 'Akkutausch erforderlich' } as const;
export const N20_LABEL = { frei: 'Frei von Verschmutzung', gereinigt: 'Gereinigt', wartung: 'Wartung erforderlich' } as const;

export const ABSPERRUNG_LABEL = { keine: 'Keine', '5': '5 m', '10': '10 m', '30': '30 m' } as const;

export const ABMELDUNG_LABELS = {
  el: 'Einsatzleiter',
  lst: 'Leitstelle',
  tower: 'Tower / Flugplatz',
  lfz: 'Luftfahrzeug (LFZ)',
} as const;

export const STEP_TITLES = [
  'Einsatzdaten',
  'Grundlage & Abstände',
  'Team',
  'Vorbereitung',
  'Vorflugkontrolle',
  'Betriebskontrolle',
  'Flüge & Akkus',
  'Einsatzende & Nachkontrolle',
  'Abschluss',
] as const;

export const STEP_SUBTITLES = [
  'Datum, Art, Gebiet, Fluggerät',
  'Kategorie, VLOS, Flughöhe, Buffer',
  'Pilot, Teamleiter, Helfer, EL',
  'Nr. 1–14 · Auftrag, Wetter, Funk, Sperren',
  'Nr. 15–16 · Gerät und Fernsteuerung',
  'Nr. 17 · Startprozedere',
  'Akkus, Uhrzeiten, Ereignisse',
  'Nr. 18–23 · Abmelden und Nachkontrolle',
  'Zusammenfassung und Bestätigung',
] as const;

export const TOTAL_STEPS = STEP_TITLES.length;
