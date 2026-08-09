import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { canViewDroneModule } from '@/lib/auth/permissions';
import { buildIcsCalendar } from '@/lib/calendar/ics';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireUser();
  const { eventId } = await params;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { organization: { select: { type: true, id: true, parentId: true } } },
  });
  if (!event) {
    return NextResponse.json({ error: 'Termin wurde nicht gefunden.' }, { status: 404 });
  }

  const eventAbschnittOrganizationId = getAbschnittOrganizationId(event.organization);
  const visible =
    (event.organizationId === user.homeOrganizationId ||
      (event.isSectionWide && eventAbschnittOrganizationId === user.homeAbschnittOrganizationId)) &&
    (event.category !== 'DROHNENGRUPPE' || canViewDroneModule(user));
  if (!visible) {
    return NextResponse.json({ error: 'Kein Zugriff auf diesen Termin.' }, { status: 404 });
  }

  const body = buildIcsCalendar(event.title, [event]);
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="termin.ics"',
    },
  });
}
