export interface VehicleExcelRow {
  taktischeBezeichnung: string;
  kennzeichen: string;
  marke: string;
  typ: string;
  status: string;
}

/**
 * Gemeinsame Spaltendefinition für Export und Import: der Export dient absichtlich zugleich als
 * ausfüllbare Import-Vorlage (gleiche Header-Namen) - 1:1 dasselbe Muster wie
 * lib/admin/user-excel-columns.ts. Der Import liest nur die ersten vier Spalten (siehe
 * VEHICLE_IMPORT_COLUMN_KEYS) und ignoriert "Status" (abgeleitet, nicht importierbar).
 */
export const VEHICLE_EXCEL_COLUMNS: { header: string; key: keyof VehicleExcelRow; width: number }[] = [
  { header: 'Taktische Bezeichnung', key: 'taktischeBezeichnung', width: 26 },
  { header: 'Kennzeichen', key: 'kennzeichen', width: 16 },
  { header: 'Marke', key: 'marke', width: 20 },
  { header: 'Typ', key: 'typ', width: 20 },
  { header: 'Status', key: 'status', width: 14 },
];

export const VEHICLE_IMPORT_COLUMN_KEYS: (keyof VehicleExcelRow)[] = [
  'taktischeBezeichnung',
  'kennzeichen',
  'marke',
  'typ',
];
