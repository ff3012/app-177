import ExcelJS from 'exceljs';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';
import { getNinetyDayCutoff, meetsNinetyDayRule } from '@/lib/drone/ninety-day-rule';
import { listDrohnengruppeMembers } from '@/lib/drone/members';

/** Ersetzt die bisherige /drohnen/90-tage-Unterseite (siehe Drohnengruppe-Brief.md §8.6) - exakt
 * dieselben drei Spalten, die die neue Gruppenstatus-Balkenliste auf der Hauptseite bereits live
 * anzeigt, jetzt als herunterladbare Datei statt als eigene Seite. */
export async function GET(request: NextRequest) {
  const user = await requireUser();
  const allowedGroups = await getAllowedDroneGroups(user);
  if (allowedGroups.length === 0) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  const requestedGroupId = request.nextUrl.searchParams.get('gruppe');
  const group = (requestedGroupId && allowedGroups.find((g) => g.id === requestedGroupId)) || allowedGroups[0];

  const cutoff = getNinetyDayCutoff();
  const [members, counts] = await Promise.all([
    listDrohnengruppeMembers(group.id),
    prisma.droneFlight.groupBy({
      by: ['pilotUserId'],
      where: { startsAt: { gte: cutoff }, pilotUser: { droneMembership: { droneGroupId: group.id } } },
      _count: { _all: true },
    }),
  ]);
  const countByPilot = new Map(counts.map((c) => [c.pilotUserId, c._count._all]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('90-Tage-Report');
  sheet.columns = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Flüge (90 Tage)', key: 'count', width: 16 },
    { header: 'Status', key: 'status', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const member of members) {
    const count = countByPilot.get(member.id) ?? 0;
    sheet.addRow({
      name: `${member.lastName} ${member.firstName}`,
      count,
      status: meetsNinetyDayRule(count) ? 'Erfüllt' : 'Offen',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="90-tage-report-${group.name.replace(/[^a-z0-9]+/gi, '-')}.xlsx"`,
    },
  });
}
