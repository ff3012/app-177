export interface UserExcelRow {
  firstName: string;
  lastName: string;
  email: string;
  stbNr: string;
  phone: string;
  homeOrganizationName: string;
  adminFor: string;
  droneRole: string;
  status: string;
}

/**
 * Gemeinsame Spaltendefinition für Export und Import: der Export dient absichtlich zugleich als
 * ausfüllbare Import-Vorlage (gleiche Header-Namen), damit keine zwei Formate gepflegt werden
 * müssen. Der Import liest nur die ersten sechs Spalten aus (siehe import/actions.ts) und ignoriert
 * "Admin für"/"Drohnengruppe"/"Status", damit ein reiner Re-Upload einer Export-Datei funktioniert.
 */
export const USER_EXCEL_COLUMNS: { header: string; key: keyof UserExcelRow; width: number }[] = [
  { header: 'Vorname', key: 'firstName', width: 18 },
  { header: 'Nachname', key: 'lastName', width: 18 },
  { header: 'E-Mail', key: 'email', width: 28 },
  { header: 'StbNr', key: 'stbNr', width: 14 },
  { header: 'Telefonnummer', key: 'phone', width: 18 },
  { header: 'Heimat-Feuerwehr', key: 'homeOrganizationName', width: 22 },
  { header: 'Admin für', key: 'adminFor', width: 24 },
  { header: 'Drohnengruppe', key: 'droneRole', width: 14 },
  { header: 'Status', key: 'status', width: 14 },
];

export const USER_IMPORT_COLUMN_KEYS: (keyof UserExcelRow)[] = [
  'firstName',
  'lastName',
  'email',
  'stbNr',
  'phone',
  'homeOrganizationName',
];
