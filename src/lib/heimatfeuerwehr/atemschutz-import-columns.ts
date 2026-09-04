export interface AtemschutzImportRow {
  fwNr: string;
  stbNr: string;
  untersuchtungsart: string;
  untersuchtungsdatum: string;
  tauglichkeitsart: string;
}

/** Untersuchtungsart-Werte im offiziellen Export - Rechtschreibung exakt wie in der Quelldatei
 * ("Untersuchtungsart", nicht "Untersuchungsart"), nicht korrigieren. */
export const UNTERSUCHUNGSART_TAUGLICHKEIT = 'Atemschutztauglichkeit';
export const UNTERSUCHUNGSART_LEISTUNGSTEST = 'Atemschutz Leistungstest';

/** Erwartete Spalten-Header des offiziellen Atemschutz-Untersuchungs-Exports (Sheet "ExportResults") -
 * siehe docs/superpowers/specs/2026-09-04-atemschutz-import-design.md. Reine Import-Spaltenliste, kein
 * gemeinsames Export-Template wie bei vehicle-excel-columns.ts, da diese App selbst keinen
 * Atemschutz-Export in diesem Format erzeugt - die Quelldatei stammt aus einem externen System. */
export const ATEMSCHUTZ_IMPORT_COLUMNS: { header: string; key: keyof AtemschutzImportRow }[] = [
  { header: 'FW-Nr', key: 'fwNr' },
  { header: 'StbNr', key: 'stbNr' },
  { header: 'Untersuchtungsart', key: 'untersuchtungsart' },
  { header: 'Untersuchtungsdatum', key: 'untersuchtungsdatum' },
  { header: 'Tauglichkeitsart', key: 'tauglichkeitsart' },
];
