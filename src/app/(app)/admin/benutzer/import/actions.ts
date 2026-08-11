'use server';

import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { revalidatePath } from 'next/cache';
import { DroneRole, TokenPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, isBezirksAdmin } from '@/lib/auth/permissions';
import { hashPassword } from '@/lib/password';
import { createToken } from '@/lib/auth/tokens';
import { sendActivationEmail } from '@/lib/email/templates';
import { AUSBILDUNGSSTUFEN, E164_PHONE_REGEX, type Ausbildungsstufe } from '@/lib/validation/user.schema';
import { USER_EXCEL_COLUMNS, USER_IMPORT_COLUMN_KEYS, type UserExcelRow } from '@/lib/admin/user-excel-columns';

export interface ImportUsersState {
  error?: string;
  result?: {
    created: number;
    skipped: number;
    errors: string[];
    activationLinks: { name: string; email: string; link: string }[];
  };
}

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

/** Gegenstück zu DRONE_ROLE_LABEL (user-excel-columns.ts) - Label -> Rollen-Key, case-insensitive. */
const DRONE_ROLE_BY_LABEL: Record<string, 'NONE' | 'PILOT' | 'ADMIN'> = {
  kein: 'NONE',
  mitglied: 'PILOT',
  admin: 'ADMIN',
};

function parseJaNein(value: string): boolean {
  return value.trim().toLowerCase() === 'ja';
}

/** Erwartet YYYY-MM-DD (siehe Kommentar in user-excel-columns.ts) - liefert `undefined` bei einem
 * nicht parsebaren, nicht-leeren Wert, damit der Aufrufer das von "Feld leer" (null) unterscheiden
 * und als Fehler statt als stillschweigend übersprungenes Feld behandeln kann. */
function parseIsoDate(value: string): Date | null | undefined {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Dieselbe "eine Stufe darf nur gesetzt sein, wenn jede vorangehende Stufe ebenfalls gesetzt ist"-
 * Regel wie userSchema's superRefine (user.schema.ts) - der Bulk-Import umgeht userSchema komplett
 * (eigene Zeilen-für-Zeilen-Verarbeitung, siehe Datei-Kommentar unten), muss die Invariante der
 * Ausbildungsstufen deshalb hier eigenständig durchsetzen, damit keine Zeile mit z. B. gesetztem
 * BOS1 ohne A1/A3 in der Datenbank landen kann. */
function findAusbildungsGapError(values: Record<Ausbildungsstufe, string>): string | null {
  let seenGap = false;
  for (const key of AUSBILDUNGSSTUFEN) {
    if (!values[key]) {
      seenGap = true;
    } else if (seenGap) {
      return 'Ausbildungsstufen müssen der Reihe nach abgeschlossen werden (z. B. setzt BOS1 A1/A3, A2 und Stützpunktausbildung voraus).';
    }
  }
  return null;
}

/**
 * Erweiterung auf alle Benutzerfelder (GitHub Issue #11) - dieselbe Zeilen-für-Zeilen-Verarbeitung
 * wie zuvor, jetzt zusätzlich mit Dienstgrad/Admin-für/Drohnengruppe+Rolle/Ausbildungsstufen/
 * Atemschutzgeräteträger/Bezirksadmin/Bezirks-Drohnenadmin. Die admin-rechte-relevanten Felder
 * (Bezirksadmin, Bezirks-Drohnenadmin, Admin für) werden hier bewusst OHNE die feingranularen
 * canGrantBezirksAdmin/canGrantBezirksDrohnenAdmin/canGrantAdminFor-Prüfungen aus actions.ts
 * geschrieben - importUsers ist bereits oben auf isBezirksAdmin gegated, und
 * canGrantBezirksAdmin/canGrantBezirksDrohnenAdmin sind für einen Bezirksadmin ohnehin
 * unconditionally true (siehe permissions.ts), ein Feuerwehr-Admin erreicht diese Aktion gar nicht.
 */
export async function importUsers(_prevState: ImportUsersState, formData: FormData): Promise<ImportUsersState> {
  const currentUser = await requireUser();
  assertPermission(isBezirksAdmin(currentUser));

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Bitte eine Excel-Datei auswählen.' };
  }

  const sendWelcomeEmail = formData.get('sendWelcomeEmail') !== 'nein';

  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // exceljs bringt über @fast-csv/format und @fast-csv/parse eine eigene, alte
    // @types/node@14-Kopie mit (siehe package-lock.json) - deren "Buffer"-Typ ist strukturell
    // inkompatibel mit dem aus unserer @types/node@22, auch nach einem Cast auf "Buffer".
    // Da beide Seiten zur Laufzeit dasselbe Node-Buffer-Objekt sind, ist `any` hier der
    // pragmatische Ausweg statt eine Typkonflikt zwischen zwei Fremdpaket-Typdefinitionen zu lösen.
    await workbook.xlsx.load(buffer as any);
  } catch (error) {
    console.error('Excel-Import: Datei konnte nicht gelesen werden:', error);
    return { error: 'Datei konnte nicht gelesen werden. Bitte eine gültige .xlsx-Datei hochladen.' };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { error: 'Die Datei enthält kein Tabellenblatt.' };
  }

  // Kopfzeile nach Spaltennamen auflösen statt feste Spaltenpositionen anzunehmen - robuster
  // gegenüber umsortierten/zusätzlichen Spalten (z. B. ein wieder hochgeladener Export).
  const columnIndexByKey = new Map<keyof UserExcelRow, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const headerText = String(cell.value ?? '').trim();
    const match = USER_EXCEL_COLUMNS.find((column) => column.header === headerText);
    if (match) columnIndexByKey.set(match.key, colNumber);
  });

  const missingKeys = USER_IMPORT_COLUMN_KEYS.filter((key) => !columnIndexByKey.has(key));
  if (missingKeys.length > 0) {
    const missingHeaders = USER_EXCEL_COLUMNS.filter((column) => missingKeys.includes(column.key)).map((c) => c.header);
    return { error: `Fehlende Spalten in der Kopfzeile: ${missingHeaders.join(', ')}.` };
  }

  const organizations = await prisma.organization.findMany();
  const dienstgrade = await prisma.dienstgrad.findMany();
  const droneGroups = await prisma.droneGroup.findMany();
  const existingUsers = await prisma.user.findMany({
    select: { email: true, stbNr: true, homeOrganizationId: true },
  });

  const errors: string[] = [];
  const activationLinks: { name: string; email: string; link: string }[] = [];
  let created = 0;
  let skipped = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const getValue = (key: keyof UserExcelRow): string => {
      const colIndex = columnIndexByKey.get(key);
      if (!colIndex) return '';
      return String(row.getCell(colIndex).value ?? '').trim();
    };

    const firstName = getValue('firstName');
    const lastName = getValue('lastName');
    const email = getValue('email').toLowerCase();
    const stbNr = getValue('stbNr');
    const phone = getValue('phone');
    const orgName = getValue('homeOrganizationName');
    const dienstgradKurzform = getValue('dienstgrad');
    const adminForRaw = getValue('adminFor');
    const droneGroupName = getValue('droneGroupName');
    const droneRoleLabel = getValue('droneRole');
    const atemschutz = getValue('istAtemschutzgeraeteTraeger');
    const bezirksAdmin = getValue('isBezirksAdmin');
    const bezirksDrohnenAdmin = getValue('isBezirksDrohnenAdmin');
    const ausbildungRaw: Record<Ausbildungsstufe, string> = {
      a1a3LizenzAm: getValue('a1a3LizenzAm'),
      a2LizenzAm: getValue('a2LizenzAm'),
      stuetzpunktausbildungAm: getValue('stuetzpunktausbildungAm'),
      bos1AusbildungAm: getValue('bos1AusbildungAm'),
      bos2AusbildungAm: getValue('bos2AusbildungAm'),
    };

    if (!firstName && !lastName && !email && !orgName) continue; // leere Zeile überspringen

    if (!firstName || !lastName || !email || !orgName || !stbNr) {
      errors.push(`Zeile ${rowNumber}: Vorname, Nachname, E-Mail, Standesbuchnummer und Heimat-Feuerwehr sind erforderlich.`);
      continue;
    }

    const organization = organizations.find(
      (org) =>
        org.name.toLowerCase() === orgName.toLowerCase() ||
        (org.shortName ?? '').toLowerCase() === orgName.toLowerCase(),
    );
    if (!organization) {
      errors.push(`Zeile ${rowNumber}: Feuerwehr "${orgName}" wurde nicht gefunden.`);
      continue;
    }

    if (phone && !E164_PHONE_REGEX.test(phone)) {
      errors.push(`Zeile ${rowNumber}: Telefonnummer "${phone}" ist kein gültiges E.164-Format.`);
      continue;
    }

    let dienstgradId: string | null = null;
    if (dienstgradKurzform) {
      const dienstgrad = dienstgrade.find((d) => d.kurzform.toLowerCase() === dienstgradKurzform.toLowerCase());
      if (!dienstgrad) {
        errors.push(`Zeile ${rowNumber}: Dienstgrad "${dienstgradKurzform}" wurde nicht gefunden.`);
        continue;
      }
      dienstgradId = dienstgrad.id;
    }

    const adminOrgIds: string[] = [];
    if (adminForRaw) {
      const names = adminForRaw
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      const unresolvedName = names.find(
        (name) =>
          !organizations.some(
            (org) => org.name.toLowerCase() === name.toLowerCase() || (org.shortName ?? '').toLowerCase() === name.toLowerCase(),
          ),
      );
      if (unresolvedName) {
        errors.push(`Zeile ${rowNumber}: Feuerwehr "${unresolvedName}" (Admin für) wurde nicht gefunden.`);
        continue;
      }
      for (const name of names) {
        const org = organizations.find(
          (o) => o.name.toLowerCase() === name.toLowerCase() || (o.shortName ?? '').toLowerCase() === name.toLowerCase(),
        )!;
        if (!adminOrgIds.includes(org.id)) adminOrgIds.push(org.id);
      }
    }

    const normalizedRoleLabel = droneRoleLabel.toLowerCase();
    let droneRole: 'NONE' | 'PILOT' | 'ADMIN' = 'NONE';
    if (normalizedRoleLabel) {
      const matchedRole = DRONE_ROLE_BY_LABEL[normalizedRoleLabel];
      if (!matchedRole) {
        errors.push(`Zeile ${rowNumber}: Drohnengruppen-Rolle "${droneRoleLabel}" ist ungültig (erlaubt: Kein/Mitglied/Admin).`);
        continue;
      }
      droneRole = matchedRole;
    }

    let droneGroupId: string | null = null;
    let ausbildungDates: Record<Ausbildungsstufe, Date | null> | null = null;
    if (droneRole !== 'NONE') {
      if (!droneGroupName) {
        errors.push(`Zeile ${rowNumber}: Drohnengruppe ist erforderlich, wenn eine Drohnengruppen-Rolle gesetzt ist.`);
        continue;
      }
      const group = droneGroups.find((g) => g.name.toLowerCase() === droneGroupName.toLowerCase());
      if (!group) {
        errors.push(`Zeile ${rowNumber}: Drohnengruppe "${droneGroupName}" wurde nicht gefunden.`);
        continue;
      }
      droneGroupId = group.id;

      const gapError = findAusbildungsGapError(ausbildungRaw);
      if (gapError) {
        errors.push(`Zeile ${rowNumber}: ${gapError}`);
        continue;
      }
      const parsed = {} as Record<Ausbildungsstufe, Date | null>;
      let invalidDateKey: Ausbildungsstufe | null = null;
      for (const key of AUSBILDUNGSSTUFEN) {
        const value = parseIsoDate(ausbildungRaw[key]);
        if (value === undefined) {
          invalidDateKey = key;
          break;
        }
        parsed[key] = value;
      }
      if (invalidDateKey) {
        errors.push(`Zeile ${rowNumber}: Datum "${ausbildungRaw[invalidDateKey]}" ist ungültig (erwartet: YYYY-MM-DD).`);
        continue;
      }
      ausbildungDates = parsed;
    }

    // Duplikat-Erkennung laut Vorgabe: StbNr + Heimat-Feuerwehr.
    const isDuplicate =
      stbNr !== '' && existingUsers.some((u) => u.stbNr === stbNr && u.homeOrganizationId === organization.id);
    if (isDuplicate) {
      skipped++;
      continue;
    }

    if (existingUsers.some((u) => u.email === email)) {
      errors.push(`Zeile ${rowNumber}: E-Mail "${email}" ist bereits vergeben.`);
      continue;
    }

    try {
      const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
      const newUser = await prisma.user.create({
        data: {
          firstName,
          lastName,
          email,
          stbNr: stbNr || null,
          phone: phone || null,
          isActive: false,
          dienstgradId,
          istAtemschutzgeraeteTraeger: parseJaNein(atemschutz),
          homeOrganizationId: organization.id,
          isBezirksAdmin: parseJaNein(bezirksAdmin),
          isBezirksDrohnenAdmin: parseJaNein(bezirksDrohnenAdmin),
          passwordHash,
        },
      });
      existingUsers.push({ email: newUser.email, stbNr: newUser.stbNr, homeOrganizationId: newUser.homeOrganizationId });
      created++;

      if (adminOrgIds.length > 0) {
        await prisma.membership.createMany({
          data: adminOrgIds.map((organizationId) => ({ userId: newUser.id, organizationId, role: 'ADMIN' })),
        });
      }

      if (droneRole !== 'NONE' && droneGroupId && ausbildungDates) {
        await prisma.drohnengruppeMembership.create({
          data: {
            userId: newUser.id,
            role: droneRole === 'ADMIN' ? DroneRole.ADMIN : DroneRole.PILOT,
            droneGroupId,
            ...ausbildungDates,
          },
        });
      }

      const token = await createToken(newUser.id, TokenPurpose.ACTIVATION);

      if (!sendWelcomeEmail) {
        // Kein Mail-Versand gewünscht: Aktivierungslink stattdessen sammeln und im Ergebnis zum
        // manuellen Weitergeben anzeigen (analog zum Einzel-Anlegen-Formular).
        activationLinks.push({ name: `${firstName} ${lastName}`, email, link: `${baseUrl()}/aktivieren/${token}` });
      } else {
        try {
          await sendActivationEmail(newUser, token);
        } catch (emailError) {
          console.error(`Aktivierungs-E-Mail für Zeile ${rowNumber} fehlgeschlagen:`, emailError);
          errors.push(`Zeile ${rowNumber}: Benutzer angelegt, aber Aktivierungs-E-Mail konnte nicht gesendet werden.`);
        }
      }
    } catch (error) {
      console.error(`Import Zeile ${rowNumber} fehlgeschlagen:`, error);
      errors.push(`Zeile ${rowNumber}: Unerwarteter Fehler beim Anlegen.`);
    }
  }

  revalidatePath('/admin/benutzer');
  return { result: { created, skipped, errors, activationLinks } };
}
