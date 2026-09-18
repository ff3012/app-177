export interface AusbildungImportRow {
  fwNr: string;
  stbNr: string;
  email: string;
  a1a3Datum: string;
  a2Datum: string;
  bos1Datum: string;
  bos2Datum: string;
}

/** Erwartete Spalten-Header des FDISK-Ausbildungs-Exports (Sheet "ExportResults") - siehe
 * docs/superpowers/specs/2026-09-17-drohnen-ausbildung-import-design.md. Vorname/Zuname/Dienstgrad/
 * Feuerwehr aus der echten Datei werden bewusst NICHT hier gelistet - sie werden nie geschrieben und
 * sind für die fehlende-Spalten-Prüfung nicht nötig. */
export const AUSBILDUNG_IMPORT_COLUMNS: { header: string; key: keyof AusbildungImportRow }[] = [
  { header: 'FW-Nr', key: 'fwNr' },
  { header: 'StbNr', key: 'stbNr' },
  { header: 'email', key: 'email' },
  { header: 'A1/A3 Datum', key: 'a1a3Datum' },
  { header: 'A2 Datum', key: 'a2Datum' },
  { header: 'BOS1 Datum', key: 'bos1Datum' },
  { header: 'BOS2 Datum', key: 'bos2Datum' },
];
