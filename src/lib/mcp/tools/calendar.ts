import { z } from 'zod';
import { canViewDroneModule, canViewEvent } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/prisma';
import { getAbschnittOrganizationId } from '@/lib/organizations/abschnitt';
import { clampLimit, decodeCursor, encodeCursor } from './context';
import { defineTool } from './define';
import { parseRange } from './drone';

const DESCRIPTION_MAX = 1000;
/** Wird nie mit einer echten Organisations-ID übereinstimmen: Termine mit kaputter Hierarchie sind nie "abschnittsweit sichtbar". */
const UNRESOLVED_ABSCHNITT = '\u0000unresolved';

/** Wie getAbschnittOrganizationId, aber ein einzelner Datenfehler (Feuerwehr ohne parentId) lässt nicht das ganze Werkzeug scheitern. */
function abschnittOf(org: { type: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO'; id: string; parentId: string | null }): string {
  try {
    return getAbschnittOrganizationId(org);
  } catch {
    return UNRESOLVED_ABSCHNITT;
  }
}

export const listCalendarEvents = defineTool({
  name: 'list_calendar_events',
  description:
    'Kalender: Termine im Zeitraum, die der Benutzer auch in der App sieht (eigene Feuerwehr, Abschnitt, Bezirk, bei Mitgliedschaft auch Drohnengruppen-Termine). Zeitraum höchstens 366 Tage. Datumsangaben YYYY-MM-DD gelten als Tage in Wiener Zeit, ISO-Zeitpunkte ohne Zeitzone als Wiener Ortszeit. Beschreibungen nur mit includeDescription.',
  access: 'READ',
  inputSchema: {
    from: z.string().describe('Beginn, Datum YYYY-MM-DD oder ISO-Zeitpunkt'),
    to: z.string().describe('Ende, Datum YYYY-MM-DD oder ISO-Zeitpunkt'),
    organizationId: z.string().optional().describe('Nur Termine dieser Organisation'),
    sondergruppeId: z.string().optional().describe('Nur Termine dieser Sondergruppe'),
    includeDescription: z.boolean().optional().describe('Beschreibungstext mitliefern (Standard: nein, wird auf 1000 Zeichen gekürzt)'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional().describe('nextCursor der vorherigen Seite'),
  },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    const range = parseRange(input.from, input.to);
    const canSeeDroneCategory = canViewDroneModule(user);

    // Dieselbe Vorauswahl wie kalender/page.tsx; die endgültige Sichtbarkeit entscheidet canViewEvent unten.
    const events = await prisma.event.findMany({
      where: {
        AND: [
          { startsAt: { lte: range.to }, endsAt: { gte: range.from } },
          input.organizationId ? { organizationId: input.organizationId } : {},
          input.sondergruppeId ? { sondergruppeId: input.sondergruppeId } : {},
          {
            OR: [
              { organizationId: user.homeOrganizationId },
              { isSectionWide: true, organization: { OR: [{ id: user.homeAbschnittOrganizationId }, { parentId: user.homeAbschnittOrganizationId }] } },
              { category: 'ALLGEMEIN' as const, isDistrictWide: true },
              ...(canSeeDroneCategory ? [{ category: 'DROHNENGRUPPE' as const, OR: [{ droneGroupId: user.droneGroupId }, { droneGroupId: null }] }] : []),
            ],
          },
        ],
      },
      include: {
        organization: { select: { id: true, type: true, parentId: true, name: true, shortName: true } },
        sondergruppe: { select: { name: true } },
        droneGroup: { select: { name: true } },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });

    const visible = events.filter((event) =>
      canViewEvent(user, {
        organizationId: event.organizationId,
        isSectionWide: event.isSectionWide,
        isDistrictWide: event.isDistrictWide,
        category: event.category,
        eventAbschnittOrganizationId: abschnittOf(event.organization),
        droneGroupId: event.droneGroupId,
      }),
    );

    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);
    const items = visible.slice(offset, offset + limit).map((event) => ({
      id: event.id,
      titel: event.title,
      beginn: event.startsAt.toISOString(),
      ende: event.endsAt.toISOString(),
      ganztaegig: event.allDay,
      ort: event.location,
      organisation: event.organization.shortName ?? event.organization.name,
      kategorie: event.category === 'DROHNENGRUPPE' ? 'Drohnengruppe' : 'Allgemein',
      abschnittsweit: event.isSectionWide,
      bezirksweit: event.isDistrictWide,
      sondergruppe: event.sondergruppe?.name ?? null,
      drohnengruppe: event.droneGroup?.name ?? null,
      ...(input.includeDescription ? { beschreibung: event.description ? event.description.slice(0, DESCRIPTION_MAX) : null } : {}),
    }));
    const nextCursor = offset + limit < visible.length ? encodeCursor(offset + limit) : null;
    return { data: { items, nextCursor } };
  },
});
