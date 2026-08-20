import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';
import { getUserStatus } from '@/lib/auth/user-status';
import { formatRelativeDate } from '@/lib/format';
import { DRONE_GROUP_MEMBER_EXPORT_COLUMNS, MEMBER_EXPORT_ROLE_LABEL } from '@/lib/drone/member-export-columns';

const STATUS_LABEL = { AKTIV: 'Aktiv', INAKTIV: 'Inaktiv', DEAKTIVIERT: 'Deaktiviert' } as const;

function deDate(date: Date | null): string {
  return date ? date.toLocaleDateString('de-AT') : '';
}

export async function GET() {
  const user = await requireUser();

  // Bezirksadmin/Bezirks-Drohnenadmin bekommen hier alle vier Gruppen zurück, ein reiner
  // Gruppen-Admin nur die eigene - dieselbe, bereits an anderer Stelle geteilte Regel wie
  // /admin/drohnen selbst (siehe deren Kommentar), keine eigene Kopie der Berechtigungslogik.
  const allowedGroups = await getAllowedDroneGroups(user);
  if (allowedGroups.length === 0) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  const memberships = await prisma.drohnengruppeMembership.findMany({
    where: { droneGroupId: { in: allowedGroups.map((g) => g.id) } },
    include: {
      droneGroup: { select: { name: true } },
      user: { include: { homeOrganization: true, dienstgrad: true } },
    },
    orderBy: [{ droneGroup: { name: 'asc' } }, { user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Drohnengruppe Mitglieder');
  sheet.columns = DRONE_GROUP_MEMBER_EXPORT_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  sheet.getRow(1).font = { bold: true };

  for (const m of memberships) {
    const u = m.user;
    sheet.addRow({
      droneGroupName: m.droneGroup.name,
      homeOrganizationName: u.homeOrganization.shortName ?? u.homeOrganization.name,
      stbNr: u.stbNr ?? '',
      dienstgrad: u.dienstgrad?.kurzform ?? '',
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      a1a3LizenzAm: deDate(m.a1a3LizenzAm),
      a2LizenzAm: deDate(m.a2LizenzAm),
      stuetzpunktausbildungAm: deDate(m.stuetzpunktausbildungAm),
      bos1AusbildungAm: deDate(m.bos1AusbildungAm),
      bos2AusbildungAm: deDate(m.bos2AusbildungAm),
      droneRole: MEMBER_EXPORT_ROLE_LABEL[m.role],
      status: STATUS_LABEL[getUserStatus(u)],
      lastLoginAt: u.lastLoginAt ? (formatRelativeDate(u.lastLoginAt, { fallback: '' }).title ?? '') : '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="drohnengruppe-mitglieder.xlsx"',
    },
  });
}
