import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { buildIcsCalendar } from '@/lib/calendar/ics';

// .ics-Feeds sind nicht Session-, sondern Token-authentifiziert - wir können nicht prüfen, ob der
// Abonnent Mitglied der Drohnengruppe ist. Kategorie "Drohnengruppe" bleibt daher hier immer außen vor.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const combinedToken = process.env.ABSCHNITTS_ICS_TOKEN;
  if (combinedToken && token === combinedToken) {
    const events = await prisma.event.findMany({
      where: { isSectionWide: true, category: { not: 'DROHNENGRUPPE' } },
      orderBy: { startsAt: 'asc' },
    });
    const body = buildIcsCalendar('Abschnitt Purkersdorf - Termine', events);
    return new NextResponse(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
  }

  const organization = await prisma.organization.findUnique({ where: { icsToken: token } });
  if (!organization) {
    return NextResponse.json({ error: 'Ungültiger Kalender-Link.' }, { status: 404 });
  }

  const events = await prisma.event.findMany({
    where: {
      OR: [{ organizationId: organization.id }, { isSectionWide: true }],
      category: { not: 'DROHNENGRUPPE' },
    },
    orderBy: { startsAt: 'asc' },
  });
  const body = buildIcsCalendar(`${organization.name} - Termine`, events);
  return new NextResponse(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}
