import { z } from 'zod';
import { canViewDroneModule } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/prisma';
import { classifyFlightCount, getGruppenEinsatzbereitschaft } from '@/lib/drone/einsatzbereitschaft';
import { getAllowedDroneGroups } from '@/lib/drone/flightbook-groups';
import {
  NINETY_DAY_REQUIRED_FLIGHTS,
  NINETY_DAY_WINDOW_DAYS,
  getComplianceUntilDate,
  getNinetyDayCutoff,
  meetsNinetyDayRule,
} from '@/lib/drone/ninety-day-rule';
import type { SessionUser } from '@/types/next-auth';
import { clampLimit, decodeCursor, denied, invalid, toPage } from './context';
import { defineTool } from './define';

const MAX_RANGE_DAYS = 366;
const VIENNA = 'Europe/Vienna';

const viennaParts = new Intl.DateTimeFormat('en-US', {
  timeZone: VIENNA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Versatz von Europe/Vienna gegenüber UTC (in ms) zum gegebenen Zeitpunkt. */
function viennaOffsetMs(at: Date): number {
  const p = Object.fromEntries(viennaParts.formatToParts(at).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Wandzeit in Europe/Vienna -> Zeitpunkt (unabhängig von der Server-Zeitzone, auch über Sommerzeitgrenzen). */
function viennaWallTimeToDate(y: number, m: number, d: number, h: number, min: number, s: number, ms: number): Date {
  const guess = Date.UTC(y, m - 1, d, h, min, s, ms);
  const first = guess - viennaOffsetMs(new Date(guess));
  return new Date(guess - viennaOffsetMs(new Date(first)));
}

/** Kalendertag `YYYY-MM-DD` in Europe/Vienna (nie über UTC, sonst rutscht ein Tag um Mitternacht). */
export function formatViennaDay(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: VIENNA });
}

/** Datum `YYYY-MM-DD` (Beginn bzw. Ende des Wiener Kalendertags) oder ISO-Zeitpunkt; sonst `invalid`. */
export function parseRangeBound(value: string, endOfDay: boolean): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  let date: Date;
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(Date.UTC(y, m - 1, d));
    // Unmögliche Tage wie 2026-02-31 würden sonst stillschweigend in den Folgemonat rutschen.
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      throw invalid(`Ungültiges Datum: ${value}`);
    }
    date = endOfDay ? viennaWallTimeToDate(y, m, d, 23, 59, 59, 999) : viennaWallTimeToDate(y, m, d, 0, 0, 0, 0);
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) throw invalid(`Ungültiges Datum: ${value}`);
  return date;
}

export function parseRange(from: string, to: string): { from: Date; to: Date } {
  const range = { from: parseRangeBound(from, false), to: parseRangeBound(to, true) };
  if (range.to.getTime() < range.from.getTime()) throw invalid('"to" liegt vor "from".');
  if (range.to.getTime() - range.from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    throw invalid(`Der Zeitraum darf höchstens ${MAX_RANGE_DAYS} Tage umfassen.`);
  }
  return range;
}

function requireDroneModule(user: SessionUser): void {
  if (!canViewDroneModule(user)) throw denied('Keine Berechtigung: Der Bereich ist nur für Mitglieder der Drohnengruppe.');
}

/** Gruppe, die der Aufrufer ansehen darf: Admins aus getAllowedDroneGroups, Mitglieder nur die eigene. */
async function resolveGroupId(user: SessionUser, requested: string | undefined, allowedIds: string[]): Promise<string | null> {
  if (allowedIds.length > 0) {
    if (requested && !allowedIds.includes(requested)) throw denied('Keine Berechtigung für diese Drohnengruppe.');
    return requested ?? allowedIds[0];
  }
  if (requested && requested !== user.droneGroupId) throw denied('Keine Berechtigung für diese Drohnengruppe.');
  return user.droneGroupId;
}

export const listDroneFlights = defineTool({
  name: 'list_drone_flights',
  description:
    'Drohnengruppe: Flugbuch im Zeitraum (Datum, Ort, Drohne, Pilot, Zweck). Mitglieder sehen die eigenen Flüge (selbst geflogen oder erfasst), Gruppenadmins alle Flüge ihrer Gruppe. Zeitraum höchstens 366 Tage; Datumsangaben YYYY-MM-DD gelten als Tage in Wiener Zeit.',
  access: 'READ',
  inputSchema: {
    from: z.string().describe('Beginn, Datum YYYY-MM-DD oder ISO-Zeitpunkt'),
    to: z.string().describe('Ende, Datum YYYY-MM-DD oder ISO-Zeitpunkt'),
    droneGroupId: z.string().optional().describe('Nur für Admins mit mehreren Gruppen'),
    pilotId: z.string().optional().describe('Nur Flüge dieses Piloten (nur für Admins)'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional().describe('nextCursor der vorherigen Seite'),
  },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    requireDroneModule(user);
    const range = parseRange(input.from, input.to);
    const allowed = await getAllowedDroneGroups(user);
    const isAdmin = allowed.length > 0;
    const groupId = await resolveGroupId(user, input.droneGroupId, allowed.map((g) => g.id));
    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);

    const rows = await prisma.droneFlight.findMany({
      where: {
        startsAt: { gte: range.from, lte: range.to },
        ...(isAdmin
          ? { drone: { droneGroupId: groupId ?? undefined }, ...(input.pilotId ? { pilotUserId: input.pilotId } : {}) }
          : { OR: [{ registeredById: user.id }, { pilotUserId: user.id }] }),
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        startsAt: true,
        location: true,
        purpose: true,
        drone: { select: { name: true, droneGroup: { select: { name: true } } } },
        pilotUser: { select: { firstName: true, lastName: true } },
      },
    });

    const page = toPage(rows, limit, offset);
    return {
      data: {
        items: page.items.map((f) => ({
          id: f.id,
          datum: f.startsAt.toISOString(),
          ort: f.location,
          drohne: f.drone.name,
          pilot: `${f.pilotUser.lastName} ${f.pilotUser.firstName}`,
          zweck: f.purpose === 'EINSATZ' ? 'Einsatz' : 'Übung',
          drohnengruppe: f.drone.droneGroup.name,
        })),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const getDroneReadiness = defineTool({
  name: 'get_drone_readiness',
  description:
    'Drohnengruppe: 90-Tage/3-Flüge-Regel. Zeigt immer den eigenen Status; Gruppenadmins zusätzlich die Einsatzbereitschafts-Ampel (grün/gelb/rot) je BOS1-Pilot ihrer Gruppe.',
  access: 'READ',
  inputSchema: { droneGroupId: z.string().optional().describe('Nur für Admins mit mehreren Gruppen') },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    requireDroneModule(user);

    const cutoff = getNinetyDayCutoff();
    const own = await prisma.droneFlight.findMany({
      where: { pilotUserId: user.id, startsAt: { gte: cutoff } },
      orderBy: { startsAt: 'desc' },
      select: { startsAt: true },
    });
    const compliantUntil = getComplianceUntilDate(own.map((f) => f.startsAt));
    const eigener = {
      fluegeImFenster: own.length,
      erforderlich: NINETY_DAY_REQUIRED_FLIGHTS,
      fensterTage: NINETY_DAY_WINDOW_DAYS,
      regelErfuellt: meetsNinetyDayRule(own.length),
      gueltigBis: compliantUntil ? formatViennaDay(compliantUntil) : null,
      status: classifyFlightCount(own.length),
    };

    const allowed = await getAllowedDroneGroups(user);
    if (allowed.length === 0) return { data: { eigener } };
    const groupId = await resolveGroupId(user, input.droneGroupId, allowed.map((g) => g.id));
    if (!groupId) return { data: { eigener } };

    const group = await getGruppenEinsatzbereitschaft(groupId);
    return {
      data: {
        eigener,
        gruppe: {
          name: group.droneGroupName,
          mitglieder: group.totalMembers,
          a2Zertifikate: group.a2Count,
          piloten: group.pilots.map((p) => ({ id: p.id, name: p.name, feuerwehr: p.feuerwehr, fluege: p.flightCount, status: p.status })),
        },
      },
    };
  },
});
