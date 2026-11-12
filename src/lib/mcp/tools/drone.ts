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
import { formatViennaDay, formatViennaIso, viennaWallTimeToDate } from './vienna-time';

const MAX_RANGE_DAYS = 366;

function validDay(y: number, m: number, d: number): boolean {
  const check = new Date(Date.UTC(y, m - 1, d));
  // Unmögliche Tage wie 2026-02-31 würden sonst stillschweigend in den Folgemonat rutschen.
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const ZONED_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Datum `YYYY-MM-DD` (Beginn bzw. Ende des Wiener Kalendertags), ISO-Zeitpunkt mit Zeitzone (`Z`/`+02:00`)
 * oder ISO-Zeitpunkt OHNE Zeitzone (gilt als Wiener Ortszeit, unabhängig von der Server-Zeitzone); sonst `invalid`.
 */
export function parseRangeBound(value: string, endOfDay: boolean): Date {
  const trimmed = value.trim();
  let date: Date | null = null;
  const dateOnly = DATE_ONLY.exec(trimmed);
  const local = LOCAL_DATE_TIME.exec(trimmed);
  if (dateOnly) {
    const [y, m, d] = [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])];
    if (validDay(y, m, d)) {
      date = endOfDay ? viennaWallTimeToDate(y, m, d, 23, 59, 59, 999) : viennaWallTimeToDate(y, m, d, 0, 0, 0, 0);
    }
  } else if (local) {
    const [y, m, d, h, min] = [Number(local[1]), Number(local[2]), Number(local[3]), Number(local[4]), Number(local[5])];
    const sec = Number(local[6] ?? 0);
    const ms = Number((local[7] ?? '0').padEnd(3, '0'));
    if (validDay(y, m, d) && h < 24 && min < 60 && sec < 60) date = viennaWallTimeToDate(y, m, d, h, min, sec, ms);
  } else if (ZONED_DATE_TIME.test(trimmed)) {
    date = new Date(trimmed);
  }
  if (!date || Number.isNaN(date.getTime())) throw invalid(`Ungültiges Datum: ${value}`);
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
    'Drohnengruppe: Flugbuch im Zeitraum (Datum, Beginn, Ort, Drohne, Pilot, Zweck). datum = Wiener Kalendertag, beginn = Wiener Ortszeit als ISO-8601 mit Offset (z. B. 2030-06-15T19:30:00+02:00). Mitglieder sehen die eigenen Flüge (selbst geflogen oder erfasst), Gruppenadmins alle Flüge ihrer Gruppe. Zeitraum höchstens 366 Tage. Datumsangaben YYYY-MM-DD gelten als Tage in Wiener Zeit, ISO-Zeitpunkte ohne Zeitzone als Wiener Ortszeit.',
  access: 'READ',
  inputSchema: {
    from: z.string().describe('Beginn, Datum YYYY-MM-DD oder ISO-Zeitpunkt'),
    to: z.string().describe('Ende, Datum YYYY-MM-DD oder ISO-Zeitpunkt'),
    droneGroupId: z.string().optional().describe('Nur für Admins mit mehreren Gruppen'),
    pilotId: z.string().optional().describe('Nur Flüge dieses Piloten (Mitglieder: innerhalb der eigenen Flüge)'),
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
    // Fail-closed: ein Admin ohne aufgelöste Gruppe darf nie ungefiltert alle Gruppen sehen.
    if (isAdmin && !groupId) throw denied('Keine Berechtigung für diese Drohnengruppe.');
    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);

    const rows = await prisma.droneFlight.findMany({
      where: {
        startsAt: { gte: range.from, lte: range.to },
        // pilotId wirkt wie in /drohnen als UND innerhalb des jeweiligen Bereichs (Admin: Gruppe, Mitglied: eigene Flüge).
        ...(isAdmin ? { drone: { droneGroupId: groupId! } } : { OR: [{ registeredById: user.id }, { pilotUserId: user.id }] }),
        ...(input.pilotId ? { pilotUserId: input.pilotId } : {}),
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
          datum: formatViennaDay(f.startsAt),
          beginn: formatViennaIso(f.startsAt),
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
    'Drohnengruppe: 90-Tage/3-Flüge-Regel. Zeigt immer den eigenen Status (regelErfuellt = Ergebnis der Regel, ja/nein; status = Ampel nach Flugzahl im 90-Tage-Fenster). Gruppenadmins zusätzlich die Einsatzbereitschafts-Ampel (GRUEN/GELB/ROT nach Flugzahl, wie in der Admin-Ansicht Einsatzbereitschaft) je BOS1-Pilot ihrer Gruppe.',
  access: 'READ',
  inputSchema: { droneGroupId: z.string().optional().describe('Nur für Admins mit mehreren Gruppen') },
  handler: async ({ principal }, input) => {
    const user = principal.user;
    requireDroneModule(user);
    // Gruppenprüfung vor allem anderen: auch ein Mitglied darf keine fremde droneGroupId angeben.
    const allowed = await getAllowedDroneGroups(user);
    const groupId = await resolveGroupId(user, input.droneGroupId, allowed.map((g) => g.id));

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

    if (allowed.length === 0 || !groupId) return { data: { eigener } };

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
