import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { MembershipRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { canAccessUserManagementAdmin, isBezirksAdmin } from '@/lib/auth/permissions';
import { USER_EXCEL_COLUMNS, EXCEL_BOOLEAN_LABEL, DRONE_ROLE_LABEL } from '@/lib/admin/user-excel-columns';
import { getUserStatus } from '@/lib/auth/user-status';

const STATUS_LABEL = { AKTIV: 'Aktiv', INAKTIV: 'Inaktiv', DEAKTIVIERT: 'Deaktiviert' } as const;

/** ISO-Datum (YYYY-MM-DD), nicht das de-AT-Anzeigeformat anderer Exporte - siehe Kommentar in
 * user-excel-columns.ts: nur so lässt sich die Spalte beim Re-Import verlustfrei zurücklesen. */
function isoDate(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : '';
}

export async function GET() {
  const user = await requireUser();
  if (!canAccessUserManagementAdmin(user)) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  // Für alle Heimatfeuerwehr-Admins geöffnet (vorher Bezirksadmin-only): ein Feuerwehr-/
  // Abschnittsadmin sieht dabei nur die Mitglieder seines eigenen Verwaltungsbereichs, exakt
  // derselbe scopeWhere-Ansatz wie page.tsx's Benutzer-Query. Bewusst kein isActive-Filter: der
  // Report soll aktive UND deaktivierte Benutzer enthalten.
  const users = await prisma.user.findMany({
    where: isBezirksAdmin(user) ? undefined : { homeOrganizationId: { in: user.feuerwehrAdminOrgIds } },
    include: {
      homeOrganization: true,
      memberships: { where: { role: MembershipRole.ADMIN }, include: { organization: true } },
      droneMembership: { include: { droneGroup: true } },
      dienstgrad: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  // passwordChangedAt wird oben nicht selektiert, aber via include automatisch mitgeliefert (kein
  // eigener select-Block hier) - getUserStatus() unterscheidet damit "noch nie aktiviert" (Inaktiv)
  // von "war aktiv, wurde deaktiviert" (Deaktiviert), statt beides als "Deaktiviert" zu melden.

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Benutzer');
  sheet.columns = USER_EXCEL_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  sheet.getRow(1).font = { bold: true };

  for (const u of users) {
    const droneRole = u.droneMembership ? (u.droneMembership.role === 'ADMIN' ? 'ADMIN' : 'PILOT') : 'NONE';
    sheet.addRow({
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      stbNr: u.stbNr ?? '',
      phone: u.phone ?? '',
      dienstgrad: u.dienstgrad?.kurzform ?? '',
      homeOrganizationName: u.homeOrganization.shortName ?? u.homeOrganization.name,
      adminFor: u.memberships.map((m) => m.organization.shortName ?? m.organization.name).join(', '),
      droneGroupName: u.droneMembership?.droneGroup.name ?? '',
      droneRole: DRONE_ROLE_LABEL[droneRole],
      a1a3LizenzAm: isoDate(u.droneMembership?.a1a3LizenzAm),
      a2LizenzAm: isoDate(u.droneMembership?.a2LizenzAm),
      stuetzpunktausbildungAm: isoDate(u.droneMembership?.stuetzpunktausbildungAm),
      bos1AusbildungAm: isoDate(u.droneMembership?.bos1AusbildungAm),
      bos2AusbildungAm: isoDate(u.droneMembership?.bos2AusbildungAm),
      istAtemschutzgeraeteTraeger: EXCEL_BOOLEAN_LABEL[u.istAtemschutzgeraeteTraeger ? 'true' : 'false'],
      isBezirksAdmin: EXCEL_BOOLEAN_LABEL[u.isBezirksAdmin ? 'true' : 'false'],
      isBezirksDrohnenAdmin: EXCEL_BOOLEAN_LABEL[u.isBezirksDrohnenAdmin ? 'true' : 'false'],
      status: STATUS_LABEL[getUserStatus(u)],
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="benutzer.xlsx"',
    },
  });
}
