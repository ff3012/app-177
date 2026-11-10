import { z } from 'zod';

/** Schlüssel exakt wie im Prototyp (newForm()) - Design und Code sprechen dieselben Namen. */
export const PREFLIGHT_CHECK_KEYS = [
  'p_gesund', 'p_fs', 'p_drohne', 'p_licht', 'p_verb', 'p_kamera',
  'p_modus', 'p_rthpos', 'p_rthh', 'p_akku30', 'p_akku20',
] as const;

export const OPERATION_CHECK_KEYS = [
  'b_start', 'b_schweb', 'b_akku', 'b_r360', 'b_l360', 'b_gr', 'b_gl', 'b_vor', 'b_rueck', 'b_land',
] as const;

const text = z.string();
const jaNein = z.enum(['ja', 'nein']);
const neinJa = z.enum(['nein', 'ja']);

const flugSchema = z.object({
  akku: text.optional(),
  uVor: text.optional(),
  uNach: text.optional(),
  start: text.optional(),
  landung: text.optional(),
  // Zwischenflugkontrolle durchgeführt (Haken).
  zw: z.boolean().optional(),
});

/** Formularstand (Spalte `data`). Für Entwürfe ist jedes Feld optional - die Pflichtprüfung
 * beim Absenden ist eine eigene Funktion (missingForSubmit). Unbekannte Schlüssel werden entfernt. */
export const checklistDataSchema = z.object({
  // Schritt 1 · Einsatzdaten
  datum: text.optional(),
  zeit: text.optional(),
  art: z.enum(['Einsatz', 'Training']).optional(),
  alarmVon: text.optional(),
  grund: text.optional(),
  gebiet: text.optional(),
  gemeinde: text.optional(),
  drohnen: z.array(z.string()).optional(),

  // Schritt 2 · Grundlage & Abstände
  grundlage: z.enum(['acg', 'open', 'specific']).optional(),
  openKat: z.enum(['A1', 'A2', 'A3']).optional(),
  bescheid: text.optional(),
  sicht: z.enum(['VLOS', 'BVLOS']).optional(),
  hoehe: z.number().optional(),

  // Schritt 3 · Team
  pilot: text.optional(),
  teamleiter: text.optional(),
  abschnittsleiter: text.optional(),
  el: text.optional(),
  helfer: z.array(z.string()).optional(),
  helferText: text.optional(),

  // Schritt 4 · Vorbereitung (Nr. 1-14)
  auftragAm: text.optional(),
  auftragUm: text.optional(),
  komm: text.optional(),
  route: text.optional(),
  wetter: text.optional(),
  risiko: jaNein.optional(),
  risikoErg: text.optional(),
  tetra1: text.optional(),
  tetra2: text.optional(),
  tetra3: text.optional(),
  // Nr. 7 Zuständige Stellen: feste Auswahl (Mehrfachauswahl) + Freitext "Weitere". `stellen` ist der Freitext
  // und war früher das einzige Feld - ältere Entwürfe bleiben dadurch unverändert gültig.
  stellenAuswahl: z.array(z.enum(['acg', 'oeamtc', 'hsost'])).optional(),
  stellen: text.optional(),
  kontrollzone: neinJa.optional(),
  kontrollFreigabe: text.optional(),
  militaer: neinJa.optional(),
  militaerFreigabe: text.optional(),
  flugplatz: neinJa.optional(),
  betriebLaut: text.optional(),
  betriebVon: text.optional(),
  betriebBis: text.optional(),
  absperrung: z.enum(['keine', '5', '10', '30']).optional(),
  hilfskraefte: jaNein.optional(),
  hindernis: z.number().optional(),

  // Schritt 5/6/8 · Kontrollen (Nr. 15-17, 18-23)
  checks: z.record(z.string(), z.boolean()).optional(),
  gpsSat: text.optional(),
  geofence: text.optional(),
  hoehenlimit: z.number().optional(),
  kommentar15: text.optional(),
  kommentar17: text.optional(),

  // Schritt 7 · Flüge & Akkus. flugStatus: fehlt = Flug noch nicht gestartet, "laeuft" = Im Flug, "beendet".
  flugStatus: z.enum(['laeuft', 'beendet']).optional(),
  flugGestartetAm: text.optional(),
  flugBeendetAm: text.optional(),
  fluege: z.array(flugSchema).optional(),
  infoEL: text.optional(),
  ereignisse: text.optional(),

  // Schritt 8 · Einsatzende & Nachkontrolle (Zeitstempel als ISO-String, null = nicht abgemeldet)
  abm: z
    .object({
      el: z.string().nullable().optional(),
      lst: z.string().nullable().optional(),
      tower: z.string().nullable().optional(),
      lfz: z.string().nullable().optional(),
    })
    .optional(),
  n18: z.enum(['ok', 'wartung']).optional(),
  n19: z.enum(['ok', 'tausch']).optional(),
  n20: z.enum(['frei', 'gereinigt', 'wartung']).optional(),

  // Schritt 9 · Abschluss
  anmerkungen: text.optional(),
  bezugNr: text.optional(),
  bestaetigt: z.boolean().optional(),
});

export type ChecklistData = z.infer<typeof checklistDataSchema>;
