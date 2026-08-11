export interface UserExcelRow {
  firstName: string;
  lastName: string;
  email: string;
  stbNr: string;
  phone: string;
  dienstgrad: string;
  homeOrganizationName: string;
  adminFor: string;
  droneGroupName: string;
  droneRole: string;
  a1a3LizenzAm: string;
  a2LizenzAm: string;
  stuetzpunktausbildungAm: string;
  bos1AusbildungAm: string;
  bos2AusbildungAm: string;
  istAtemschutzgeraeteTraeger: string;
  isBezirksAdmin: string;
  isBezirksDrohnenAdmin: string;
  status: string;
}

/** Ja/Nein-Label für alle boolean-artigen Spalten (Atemschutzgeräteträger, Bezirksadmin,
 * Bezirks-Drohnenadmin) - ein Wort statt TRUE/FALSE, damit Export und Import (GitHub Issue #11)
 * dieselbe, für den Admin lesbare Darstellung teilen. */
export const EXCEL_BOOLEAN_LABEL = { true: 'Ja', false: 'Nein' } as const;

/** Label je Drohnengruppen-Rolle - dieselbe Wortwahl wie die SegmentedControl im UserFormSheet
 * ("Kein · Mitglied · Admin"), damit Export/Import und Formular nicht auseinanderlaufen. */
export const DRONE_ROLE_LABEL: Record<'NONE' | 'PILOT' | 'ADMIN', string> = {
  NONE: 'Kein',
  PILOT: 'Mitglied',
  ADMIN: 'Admin',
};

/**
 * Gemeinsame Spaltendefinition für Export und Import (GitHub Issue #11: auf alle Benutzerfelder
 * erweitert - vorher nur Vorname/Nachname/E-Mail/StbNr/Telefon/Heimat-Feuerwehr import-, der Rest
 * nur export-fähig). Der Export dient absichtlich zugleich als ausfüllbare Import-Vorlage (gleiche
 * Header-Namen), damit keine zwei Formate gepflegt werden müssen. Der Import liest alle Spalten
 * außer "Status" (rein abgeleitet, siehe getUserStatus - kein roher Feldwert, den man beim Anlegen
 * setzen könnte).
 *
 * Die fünf Ausbildungsstufen-Daten werden bewusst als ISO-Datum (YYYY-MM-DD) geführt statt im
 * de-AT-Anzeigeformat (wie z. B. der reine Export in atemschutz-excel-columns.ts) - dieselbe
 * Zeichenkette, die auch <input type="date"> im UserFormSheet verwendet. Nur ISO lässt sich beim
 * Re-Import verlustfrei mit `new Date(...)` zurücklesen; "15.1.2025" ist keine gültige
 * Date-Eingabe und würde beim Import stillschweigend als "Invalid Date" landen.
 */
export const USER_EXCEL_COLUMNS: { header: string; key: keyof UserExcelRow; width: number }[] = [
  { header: 'Vorname', key: 'firstName', width: 18 },
  { header: 'Nachname', key: 'lastName', width: 18 },
  { header: 'E-Mail', key: 'email', width: 28 },
  { header: 'StbNr', key: 'stbNr', width: 14 },
  { header: 'Telefonnummer', key: 'phone', width: 18 },
  { header: 'Dienstgrad', key: 'dienstgrad', width: 12 },
  { header: 'Heimat-Feuerwehr', key: 'homeOrganizationName', width: 22 },
  { header: 'Admin für', key: 'adminFor', width: 26 },
  { header: 'Drohnengruppe', key: 'droneGroupName', width: 22 },
  { header: 'Drohnengruppen-Rolle', key: 'droneRole', width: 16 },
  { header: 'A1/A3-Lizenz am', key: 'a1a3LizenzAm', width: 16 },
  { header: 'A2-Lizenz am', key: 'a2LizenzAm', width: 16 },
  { header: 'Stützpunktausbildung am', key: 'stuetzpunktausbildungAm', width: 20 },
  { header: 'BOS1-Ausbildung am', key: 'bos1AusbildungAm', width: 18 },
  { header: 'BOS2-Ausbildung am', key: 'bos2AusbildungAm', width: 18 },
  { header: 'Atemschutzgeräteträger', key: 'istAtemschutzgeraeteTraeger', width: 18 },
  { header: 'Bezirksadmin', key: 'isBezirksAdmin', width: 14 },
  { header: 'Bezirks-Drohnenadmin', key: 'isBezirksDrohnenAdmin', width: 18 },
  { header: 'Status', key: 'status', width: 14 },
];

export const USER_IMPORT_COLUMN_KEYS: (keyof UserExcelRow)[] = [
  'firstName',
  'lastName',
  'email',
  'stbNr',
  'phone',
  'dienstgrad',
  'homeOrganizationName',
  'adminFor',
  'droneGroupName',
  'droneRole',
  'a1a3LizenzAm',
  'a2LizenzAm',
  'stuetzpunktausbildungAm',
  'bos1AusbildungAm',
  'bos2AusbildungAm',
  'istAtemschutzgeraeteTraeger',
  'isBezirksAdmin',
  'isBezirksDrohnenAdmin',
];
