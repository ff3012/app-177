import ical, { type VEvent, type ParameterValue } from 'node-ical';
import { EventCategory } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getOrCreateIcsSyncUser } from './ics-sync-user';

const FETCH_TIMEOUT_MS = 15_000;
// Bewusst kein "alle Termine seit Anfang der Quelle" (die Quelle kann Jahre an Historie
// enthalten, siehe Kommentar unten) - ein rollierendes Fenster reicht für den praktischen
// Zweck ("was steht als Nächstes an") und hält jeden 5-Minuten-Sync schnell.
const SYNC_WINDOW_PAST_MS = 14 * 24 * 60 * 60 * 1000; // 14 Tage zurück
const SYNC_WINDOW_FUTURE_MS = 365 * 24 * 60 * 60 * 1000; // 12 Monate voraus

export interface IcsSyncResult {
  imported: number;
  updated: number;
  removed: number;
}

/** ParameterValue ist laut node-ical entweder ein reiner String oder `{val, params}` - sichere
 * Zugriffsmethode laut node-ical's eigener Dokumentation im .d.ts. */
function textValue(value: ParameterValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : value.val;
}

interface ParsedInstance {
  icsUid: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

function toInstance(event: VEvent, start: Date, end: Date, icsUid: string): ParsedInstance {
  const title = textValue(event.summary)?.trim();
  const description = textValue(event.description)?.trim();
  const location = textValue(event.location)?.trim();
  return {
    icsUid,
    title: title || '(ohne Titel)',
    description: description ? description : null,
    location: location ? location : null,
    startsAt: start,
    endsAt: end,
    allDay: event.datetype === 'date',
  };
}

/**
 * Parst den .ics-Text und liefert alle VEVENT-Instanzen innerhalb des Sync-Fensters
 * [now-14d, now+12mo] - inklusive per RRULE wiederkehrender Termine, die node-ical's eigener
 * expandRecurringEvent() expandiert (samt RECURRENCE-ID-Overrides und EXDATE-Ausschlüssen, statt
 * das hier von Hand nachzubauen). Der reale Google-Kalender, für den dieses Feature gebaut wurde,
 * enthält aktuell keine RRULEs (jeder Termin ist bereits ein eigenständiges VEVENT) - die
 * RRULE-Expansion ist trotzdem eingebaut, für den Fall, dass eine andere Feuerwehr einen
 * wiederkehrenden Termin in ihrem Quellkalender hat.
 */
function parseInstances(icsText: string, windowStart: Date, windowEnd: Date): ParsedInstance[] {
  const parsed = ical.sync.parseICS(icsText);
  const instances: ParsedInstance[] = [];

  for (const item of Object.values(parsed)) {
    if (!item || item.type !== 'VEVENT' || !item.uid) continue;

    if (item.rrule) {
      const expanded = ical.expandRecurringEvent(item, { from: windowStart, to: windowEnd });
      for (const occurrence of expanded) {
        // Pro Instanz eine eigene, deterministische UID (Basis-UID + Startzeit) - sonst würden
        // alle Vorkommen derselben Serie über organizationId+icsUid auf eine einzige Zeile
        // kollabieren.
        instances.push(toInstance(occurrence.event, occurrence.start, occurrence.end, `${item.uid}::${occurrence.start.toISOString()}`));
      }
      continue;
    }

    if (!item.start) continue;
    const end = item.end ?? item.start;
    if (end < windowStart || item.start > windowEnd) continue;
    instances.push(toInstance(item, item.start, end, item.uid));
  }

  return instances;
}

/**
 * Synchronisiert den externen ICS-Kalender einer Feuerwehr (Organization.icsImportUrl) in ihren
 * Kalender (Event mit icsUid gesetzt) - voller Abgleich innerhalb des Sync-Fensters: neue
 * Quell-Termine werden angelegt, geänderte aktualisiert, aus der Quelle verschwundene gelöscht
 * (samt ihrer Zusagen, TerminZusage.event hat onDelete: Cascade). Termine außerhalb des Fensters
 * werden nie berührt. Wirft bei Netzwerk-/Parse-Fehlern - der Aufrufer (Cron-Route, "Jetzt
 * synchronisieren"-Button) entscheidet, wie das dem Admin angezeigt wird.
 */
export async function syncIcsCalendarForOrganization(organizationId: string, icsUrl: string): Promise<IcsSyncResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let icsText: string;
  try {
    const response = await fetch(icsUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`ICS-Feed antwortete mit Status ${response.status}`);
    }
    icsText = await response.text();
  } finally {
    clearTimeout(timeout);
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - SYNC_WINDOW_PAST_MS);
  const windowEnd = new Date(now.getTime() + SYNC_WINDOW_FUTURE_MS);
  const instances = parseInstances(icsText, windowStart, windowEnd);

  // Bewusst NICHT nach startsAt gefiltert (anders als früher): der DB-Unique-Constraint ist
  // (organizationId, icsUid) OHNE startsAt, also muss auch die Duplikat-Prüfung hier alle
  // icsUid-Zeilen der Organisation kennen, egal wo ihr aktuell gespeichertes startsAt liegt. Wird
  // im Quellkalender das Datum eines Termins verschoben, kann die zuvor gespeicherte Zeile ein
  // startsAt außerhalb des jetzigen Fensters haben, während die neue Version wieder hineinfällt -
  // eine auf das Fenster verengte Abfrage würde diese Zeile übersehen und fälschlich ein zweites
  // Event mit derselben icsUid anlegen (genau der reale Fehler "Unique constraint failed on the
  // fields: (organizationId, icsUid)"). Die Fenstergrenze gilt weiterhin für die Löschung
  // verschwundener Termine unten, dort anhand des VOR diesem Sync gespeicherten startsAt.
  const existing = await prisma.event.findMany({
    where: { organizationId, icsUid: { not: null } },
    select: { id: true, icsUid: true, startsAt: true },
  });
  const existingByUid = new Map(existing.map((event) => [event.icsUid as string, event]));
  const seenUids = new Set<string>();

  let imported = 0;
  let updated = 0;
  if (instances.length > 0) {
    const createdById = (await getOrCreateIcsSyncUser()).id;
    for (const instance of instances) {
      seenUids.add(instance.icsUid);
      const match = existingByUid.get(instance.icsUid);
      if (match) {
        await prisma.event.update({
          where: { id: match.id },
          data: {
            title: instance.title,
            description: instance.description,
            location: instance.location,
            startsAt: instance.startsAt,
            endsAt: instance.endsAt,
            allDay: instance.allDay,
          },
        });
        updated++;
      } else {
        await prisma.event.create({
          data: {
            title: instance.title,
            description: instance.description,
            location: instance.location,
            startsAt: instance.startsAt,
            endsAt: instance.endsAt,
            allDay: instance.allDay,
            organizationId,
            isSectionWide: false,
            category: EventCategory.ALLGEMEIN,
            createdById,
            icsUid: instance.icsUid,
          },
        });
        imported++;
      }
    }
  }

  const staleIds = existing
    .filter(
      (event) =>
        !seenUids.has(event.icsUid as string) && event.startsAt >= windowStart && event.startsAt <= windowEnd,
    )
    .map((event) => event.id);
  if (staleIds.length > 0) {
    await prisma.event.deleteMany({ where: { id: { in: staleIds } } });
  }

  return { imported, updated, removed: staleIds.length };
}
