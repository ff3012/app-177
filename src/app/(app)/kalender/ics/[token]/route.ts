import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { buildIcsCalendar } from '@/lib/calendar/ics';
import {
  LEGACY_COMBINED_ICS_ABSCHNITT_NUMMER,
  getAbschnittOrganizationId,
} from '@/lib/organizations/abschnitt';

// .ics-Feeds sind nicht Session-, sondern Token-authentifiziert - wir können nicht prüfen, ob der
// Abonnent Mitglied der Drohnengruppe ist. Kategorie "Drohnengruppe" bleibt daher hier immer außen vor.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const combinedToken = process.env.ABSCHNITTS_ICS_TOKEN;
  if (combinedToken && token === combinedToken) {
    // Dieser Feed hat keine eigene Organization-Zeile (das Token ist eine Umgebungsvariable), war aber
    // schon immer der Feed genau EINES Abschnitts. Bis zur Bezirks-Hierarchie fiel das nicht auf, weil
    // es nur einen Abschnitt gab; ohne diese Einschränkung würde er jetzt die abschnittsweiten Termine
    // aller 7 Abschnitte unter dem Titel "Purkersdorf" ausliefern.
    const abschnitt = await prisma.organization.findUnique({
      where: { nummer: LEGACY_COMBINED_ICS_ABSCHNITT_NUMMER },
      select: { id: true, name: true },
    });
    if (!abschnitt) {
      return NextResponse.json({ error: 'Ungültiger Kalender-Link.' }, { status: 404 });
    }
    const events = await prisma.event.findMany({
      where: {
        isSectionWide: true,
        category: { not: 'DROHNENGRUPPE' },
        organization: { OR: [{ id: abschnitt.id }, { parentId: abschnitt.id }] },
      },
      orderBy: { startsAt: 'asc' },
    });
    const body = buildIcsCalendar(`${abschnitt.name} - Termine`, events);
    return new NextResponse(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
  }

  const organization = await prisma.organization.findUnique({ where: { icsToken: token } });
  if (!organization) {
    return NextResponse.json({ error: 'Ungültiger Kalender-Link.' }, { status: 404 });
  }

  const abschnittOrganizationId = getAbschnittOrganizationId(organization);
  const events = await prisma.event.findMany({
    where: {
      OR: [
        { organizationId: organization.id },
        {
          isSectionWide: true,
          organization: { OR: [{ id: abschnittOrganizationId }, { parentId: abschnittOrganizationId }] },
        },
      ],
      category: { not: 'DROHNENGRUPPE' },
    },
    orderBy: { startsAt: 'asc' },
  });
  const body = buildIcsCalendar(`${organization.name} - Termine`, events);
  return new NextResponse(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}
