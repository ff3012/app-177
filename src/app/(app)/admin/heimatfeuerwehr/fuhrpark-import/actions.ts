'use server';

import ExcelJS from 'exceljs';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import {
  VEHICLE_EXCEL_COLUMNS,
  VEHICLE_IMPORT_COLUMN_KEYS,
  type VehicleExcelRow,
} from '@/lib/heimatfeuerwehr/vehicle-excel-columns';

export interface ImportVehiclesState {
  error?: string;
  result?: { created: number; skipped: number; errors: string[] };
}

/** Org-gebunden (anders als der Benutzer-Import, der die Ziel-Feuerwehr pro Zeile aus einer
 * Spalte liest): ein Fuhrpark-Export ist immer für genau eine Feuerwehr, ein Re-Upload legt daher
 * alle Zeilen in derselben, aktuell ausgewählten Org an. Duplikat-Erkennung über kennzeichen
 * (bereits @unique) - existiert es schon, wird die Zeile übersprungen statt aktualisiert, exakt
 * wie beim Benutzer-Import (StbNr+Org-Duplikate werden auch nur übersprungen, nicht upgedatet). */
export async function importVehicles(
  organizationId: string,
  _prevState: ImportVehiclesState,
  formData: FormData,
): Promise<ImportVehiclesState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Bitte eine Excel-Datei auswählen.' };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // Siehe admin/benutzer/import/actions.ts für die Begründung des any-Casts (exceljs bringt eine
    // eigene, alte @types/node-Kopie mit, strukturell inkompatibel mit unserer @types/node@22).
    await workbook.xlsx.load(buffer as any);
  } catch (error) {
    console.error('Fuhrpark-Import: Datei konnte nicht gelesen werden:', error);
    return { error: 'Datei konnte nicht gelesen werden. Bitte eine gültige .xlsx-Datei hochladen.' };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { error: 'Die Datei enthält kein Tabellenblatt.' };
  }

  const columnIndexByKey = new Map<keyof VehicleExcelRow, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const headerText = String(cell.value ?? '').trim();
    const match = VEHICLE_EXCEL_COLUMNS.find((column) => column.header === headerText);
    if (match) columnIndexByKey.set(match.key, colNumber);
  });

  const missingKeys = VEHICLE_IMPORT_COLUMN_KEYS.filter((key) => !columnIndexByKey.has(key));
  if (missingKeys.length > 0) {
    const missingHeaders = VEHICLE_EXCEL_COLUMNS.filter((column) => missingKeys.includes(column.key)).map((c) => c.header);
    return { error: `Fehlende Spalten in der Kopfzeile: ${missingHeaders.join(', ')}.` };
  }

  const existingVehicles = await prisma.vehicle.findMany({ select: { kennzeichen: true } });
  const existingKennzeichen = new Set(existingVehicles.map((v) => v.kennzeichen));

  const errors: string[] = [];
  let created = 0;
  let skipped = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const getValue = (key: keyof VehicleExcelRow): string => {
      const colIndex = columnIndexByKey.get(key);
      if (!colIndex) return '';
      return String(row.getCell(colIndex).value ?? '').trim();
    };

    const taktischeBezeichnung = getValue('taktischeBezeichnung');
    const kennzeichen = getValue('kennzeichen');
    const marke = getValue('marke');
    const typ = getValue('typ');

    if (!taktischeBezeichnung && !kennzeichen && !marke && !typ) continue; // leere Zeile überspringen

    if (!taktischeBezeichnung || !kennzeichen || !marke || !typ) {
      errors.push(`Zeile ${rowNumber}: Taktische Bezeichnung, Kennzeichen, Marke und Typ sind erforderlich.`);
      continue;
    }

    if (existingKennzeichen.has(kennzeichen)) {
      skipped++;
      continue;
    }

    try {
      await prisma.vehicle.create({ data: { taktischeBezeichnung, kennzeichen, marke, typ, organizationId } });
      existingKennzeichen.add(kennzeichen);
      created++;
    } catch (error) {
      console.error(`Fuhrpark-Import Zeile ${rowNumber} fehlgeschlagen:`, error);
      errors.push(`Zeile ${rowNumber}: Unerwarteter Fehler beim Anlegen.`);
    }
  }

  revalidatePath('/admin/heimatfeuerwehr');
  return { result: { created, skipped, errors } };
}
