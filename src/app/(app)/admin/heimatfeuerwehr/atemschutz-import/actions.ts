'use server';

import ExcelJS from 'exceljs';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { NOT_DEACTIVATED_WHERE } from '@/lib/auth/user-status';
import { getOrganizationFeatures } from '@/lib/heimatfeuerwehr/features';
import { parseGueltigkeitsdauerJahre, addYearsToIsoDate } from '@/lib/heimatfeuerwehr/atemschutz-tauglichkeit';
import {
  ATEMSCHUTZ_IMPORT_COLUMNS,
  UNTERSUCHUNGSART_TAUGLICHKEIT,
  UNTERSUCHUNGSART_LEISTUNGSTEST,
  type AtemschutzImportRow,
} from '@/lib/heimatfeuerwehr/atemschutz-import-columns';

export interface ImportAtemschutzState {
  error?: string;
  result?: {
    imported: number;
    skippedNotFound: number;
    skippedNotTraeger: number;
    skippedOtherFeuerwehr: number;
    errors: string[];
  };
}

/** exceljs kann für Rich-Text/Formel/Hyperlink/Fehler-Zellen ein Objekt statt eines primitiven Werts
 * liefern - ein bloßes String(...) würde das dann als "[object Object]" in eine sicherheitsrelevante
 * medizinische Textspalte schreiben. Löst die gängigen Fälle gezielt auf, bevor auf String(...) als
 * letzten Fallback zurückgefallen wird. */
function cellText(value: unknown): string {
  if (value && typeof value === 'object') {
    if ('richText' in value && Array.isArray((value as any).richText)) {
      return (value as any).richText.map((part: any) => part.text ?? '').join('');
    }
    if ('error' in value) return '';
    if ('result' in value) return String((value as any).result ?? '');
    if ('text' in value) return String((value as any).text ?? '');
  }
  return String(value ?? '');
}

/** Parst ein Datum aus einer Excel-Zelle - entweder ein von exceljs bereits als Date erkannter Zellwert
 * (Excel-Datumszelle) oder ein "dd.mm.yyyy"-Text (Excel-Textzelle) - beide Formen kommen in echten
 * Exports vor, je nachdem wie die Quellzelle formatiert wurde. Liefert "YYYY-MM-DD" (dieselbe
 * Darstellung, die new Date(...) im restlichen Atemschutz-Modul erwartet) oder null. */
function parseExcelDateToIso(value: unknown): string | null {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = cellText(value).trim();
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Org-gebunden (wie der Fuhrpark-Import): eine Zeile, deren FW-Nr nicht der aktuell gewählten
 * Feuerwehr entspricht, wird als Fehler übersprungen, nicht automatisch der richtigen Feuerwehr
 * zugeordnet - der Admin importiert bewusst für EINE Feuerwehr, nicht bezirksweit. Matching über StbNr
 * innerhalb dieser Feuerwehr; mehrfach vorhandene StbNr (User.stbNr ist nicht @unique) wird als nicht
 * eindeutig zuordenbar abgelehnt statt eine willkürliche Zeile zu treffen. Nur bereits als
 * Atemschutzgeräteträger markierte Mitglieder werden aktualisiert - der Import aktiviert dieses Flag
 * nicht selbst (siehe Design-Spec). Mehrere Zeilen für dieselbe (Mitglied, Untersuchtungsart)-
 * Kombination: die mit dem neuesten Untersuchtungsdatum gewinnt, erst nach vollständigem Einlesen
 * entschieden (nicht zeilenweise geschrieben), damit eine spätere Zeile eine frühere nicht per Zufall
 * abhängig von der Zeilenreihenfolge überschreibt.
 */
export async function importAtemschutz(
  organizationId: string,
  _prevState: ImportAtemschutzState,
  formData: FormData,
): Promise<ImportAtemschutzState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const { atemschutz } = await getOrganizationFeatures(organizationId);
  if (!atemschutz) {
    return { error: 'Das Modul Atemschutzgeräteträger ist für diese Feuerwehr deaktiviert.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Bitte eine Excel-Datei auswählen.' };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // Siehe fuhrpark-import/actions.ts für die Begründung des any-Casts (exceljs bringt eine eigene,
    // alte @types/node-Kopie mit, strukturell inkompatibel mit unserer @types/node@22).
    await workbook.xlsx.load(buffer as any);
  } catch (error) {
    console.error('Atemschutz-Import: Datei konnte nicht gelesen werden:', error);
    return { error: 'Datei konnte nicht gelesen werden. Bitte eine gültige .xlsx-Datei hochladen.' };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { error: 'Die Datei enthält kein Tabellenblatt.' };
  }

  const columnIndexByKey = new Map<keyof AtemschutzImportRow, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const headerText = String(cell.value ?? '').trim();
    const match = ATEMSCHUTZ_IMPORT_COLUMNS.find((column) => column.header === headerText);
    if (match) columnIndexByKey.set(match.key, colNumber);
  });

  const missingColumns = ATEMSCHUTZ_IMPORT_COLUMNS.filter((column) => !columnIndexByKey.has(column.key));
  if (missingColumns.length > 0) {
    return { error: `Fehlende Spalten in der Kopfzeile: ${missingColumns.map((c) => c.header).join(', ')}.` };
  }

  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { nummer: true } });
  if (!organization) {
    return { error: 'Feuerwehr wurde nicht gefunden.' };
  }

  const members = await prisma.user.findMany({
    where: { homeOrganizationId: organizationId, ...NOT_DEACTIVATED_WHERE },
    select: { id: true, stbNr: true, istAtemschutzgeraeteTraeger: true },
  });
  const membersByStbNr = new Map<string, { id: string; istAtemschutzgeraeteTraeger: boolean }[]>();
  for (const member of members) {
    if (!member.stbNr) continue;
    const existing = membersByStbNr.get(member.stbNr) ?? [];
    existing.push({ id: member.id, istAtemschutzgeraeteTraeger: member.istAtemschutzgeraeteTraeger });
    membersByStbNr.set(member.stbNr, existing);
  }

  interface Resolved {
    userId: string;
    untersuchtungsart: string;
    untersuchtungsdatumIso: string;
    tauglichkeitsart: string;
    rowNumber: number;
  }
  const resolvedByKey = new Map<string, Resolved>();
  const errors: string[] = [];
  let skippedNotFound = 0;
  let skippedNotTraeger = 0;
  let skippedOtherFeuerwehr = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const getValue = (key: keyof AtemschutzImportRow): string => {
      const colIndex = columnIndexByKey.get(key);
      if (!colIndex) return '';
      return cellText(row.getCell(colIndex).value).trim();
    };

    const fwNr = getValue('fwNr');
    const stbNr = getValue('stbNr');
    const untersuchtungsart = getValue('untersuchtungsart');
    const tauglichkeitsart = getValue('tauglichkeitsart');
    const dateColIndex = columnIndexByKey.get('untersuchtungsdatum')!;
    const rawDate = row.getCell(dateColIndex).value;

    if (!fwNr && !stbNr && !untersuchtungsart) continue; // leere Zeile überspringen

    if (fwNr !== organization.nummer) {
      skippedOtherFeuerwehr++;
      continue;
    }

    const matched = membersByStbNr.get(stbNr);
    if (!matched || matched.length === 0) {
      skippedNotFound++;
      continue;
    }
    if (matched.length > 1) {
      errors.push(`Zeile ${rowNumber}: Standesbuchnummer ${stbNr} mehrfach vorhanden, Zeile übersprungen.`);
      continue;
    }
    const member = matched[0];
    if (!member.istAtemschutzgeraeteTraeger) {
      skippedNotTraeger++;
      continue;
    }

    if (untersuchtungsart !== UNTERSUCHUNGSART_TAUGLICHKEIT && untersuchtungsart !== UNTERSUCHUNGSART_LEISTUNGSTEST) {
      errors.push(`Zeile ${rowNumber}: Unbekannte Untersuchtungsart "${untersuchtungsart}".`);
      continue;
    }

    const untersuchtungsdatumIso = parseExcelDateToIso(rawDate);
    if (!untersuchtungsdatumIso) {
      errors.push(`Zeile ${rowNumber}: Ungültiges Datum in Untersuchtungsdatum.`);
      continue;
    }

    const key = `${member.id}|${untersuchtungsart}`;
    const existing = resolvedByKey.get(key);
    if (!existing || untersuchtungsdatumIso > existing.untersuchtungsdatumIso) {
      resolvedByKey.set(key, { userId: member.id, untersuchtungsart, untersuchtungsdatumIso, tauglichkeitsart, rowNumber });
    }
  }

  let imported = 0;
  for (const resolved of resolvedByKey.values()) {
    try {
      if (resolved.untersuchtungsart === UNTERSUCHUNGSART_TAUGLICHKEIT) {
        const jahre = parseGueltigkeitsdauerJahre(resolved.tauglichkeitsart);
        await prisma.user.update({
          where: { id: resolved.userId },
          data: {
            atemschutzUntersuchungAm: new Date(resolved.untersuchtungsdatumIso),
            atemschutzTauglichkeitsart: resolved.tauglichkeitsart || null,
            ...(jahre !== null
              ? { atemschutzGueltigBis: new Date(addYearsToIsoDate(resolved.untersuchtungsdatumIso, jahre)) }
              : {}),
          },
        });
      } else {
        await prisma.user.update({
          where: { id: resolved.userId },
          data: {
            atemschutzFinnentestAm: new Date(resolved.untersuchtungsdatumIso),
            atemschutzFinnentestTauglichkeitsart: resolved.tauglichkeitsart || null,
          },
        });
      }
      imported++;
    } catch (error) {
      console.error(`Atemschutz-Import Zeile ${resolved.rowNumber} fehlgeschlagen:`, error);
      errors.push(`Zeile ${resolved.rowNumber}: Unerwarteter Fehler beim Speichern.`);
    }
  }

  revalidatePath('/admin/heimatfeuerwehr');
  return { result: { imported, skippedNotFound, skippedNotTraeger, skippedOtherFeuerwehr, errors } };
}
