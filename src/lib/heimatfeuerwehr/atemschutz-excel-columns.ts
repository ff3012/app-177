export interface AtemschutzExcelRow {
  name: string;
  istAtemschutzgeraeteTraeger: string;
  untersuchungAm: string;
  gueltigBis: string;
  finnentestAm: string;
  statusUntersuchung: string;
  statusFinnentest: string;
}

/** Export-only (kein Import, siehe CLAUDE.md/Plan) - keine gemeinsame Spaltenliste mit einem
 * Import-Subset nötig wie bei vehicle-excel-columns.ts, da es keinen Import-Pfad gibt. */
export const ATEMSCHUTZ_EXCEL_COLUMNS: { header: string; key: keyof AtemschutzExcelRow; width: number }[] = [
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Atemschutzgeräteträger', key: 'istAtemschutzgeraeteTraeger', width: 20 },
  { header: 'Untersuchung am', key: 'untersuchungAm', width: 16 },
  { header: 'Gültig bis', key: 'gueltigBis', width: 16 },
  { header: 'Finnentest am', key: 'finnentestAm', width: 16 },
  { header: 'Status Untersuchung', key: 'statusUntersuchung', width: 16 },
  { header: 'Status Finnentest', key: 'statusFinnentest', width: 16 },
];
