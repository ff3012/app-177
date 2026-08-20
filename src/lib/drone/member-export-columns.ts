/** Deutsche Beschriftung je Drohnengruppen-Rolle für diesen Export - bewusst alle drei echten
 * DroneRole-Werte einzeln (anders als DRONE_ROLE_LABEL in user-excel-columns.ts, das VIEWER für die
 * allgemeine Benutzerverwaltung absichtlich mit PILOT zu "Mitglied" zusammenfasst) - in einem
 * Drohnengruppen-eigenen Mitgliederexport ist gerade diese Unterscheidung relevant. */
export const MEMBER_EXPORT_ROLE_LABEL: Record<'PILOT' | 'VIEWER' | 'ADMIN', string> = {
  PILOT: 'Pilot',
  VIEWER: 'Betrachter',
  ADMIN: 'Admin',
};

export interface DroneGroupMemberExportRow {
  droneGroupName: string;
  homeOrganizationName: string;
  stbNr: string;
  dienstgrad: string;
  firstName: string;
  lastName: string;
  email: string;
  a1a3LizenzAm: string;
  a2LizenzAm: string;
  stuetzpunktausbildungAm: string;
  bos1AusbildungAm: string;
  bos2AusbildungAm: string;
  droneRole: string;
  status: string;
  lastLoginAt: string;
}

/** Spaltenreihenfolge wie vom App-Betreiber vorgegeben. Anders als USER_EXCEL_COLUMNS (Benutzerverwaltung,
 * dient zugleich als Re-Import-Vorlage, daher ISO-Datum) ist dieser Export rein lesend - die fünf
 * Ausbildungsstufen-Daten werden deshalb im de-AT-Anzeigeformat geführt, nicht ISO. */
export const DRONE_GROUP_MEMBER_EXPORT_COLUMNS: { header: string; key: keyof DroneGroupMemberExportRow; width: number }[] = [
  { header: 'Drohnengruppe', key: 'droneGroupName', width: 22 },
  { header: 'Heimatfeuerwehr', key: 'homeOrganizationName', width: 22 },
  { header: 'Stb', key: 'stbNr', width: 12 },
  { header: 'Dienstgrad', key: 'dienstgrad', width: 12 },
  { header: 'Vorname', key: 'firstName', width: 18 },
  { header: 'Nachname', key: 'lastName', width: 18 },
  { header: 'email', key: 'email', width: 28 },
  { header: 'A1/A3', key: 'a1a3LizenzAm', width: 14 },
  { header: 'A2', key: 'a2LizenzAm', width: 14 },
  { header: 'Stützpunktausbildung', key: 'stuetzpunktausbildungAm', width: 20 },
  { header: 'BOS1', key: 'bos1AusbildungAm', width: 14 },
  { header: 'BOS2', key: 'bos2AusbildungAm', width: 14 },
  { header: 'Drohnengruppe Rechte', key: 'droneRole', width: 16 },
  { header: 'Status Zugang', key: 'status', width: 14 },
  { header: 'letzter Login', key: 'lastLoginAt', width: 18 },
];
