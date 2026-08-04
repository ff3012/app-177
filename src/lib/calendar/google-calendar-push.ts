import { JWT } from 'google-auth-library';
import type { Event } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const TIME_ZONE = 'Europe/Vienna';

export interface GoogleServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

/**
 * Prüft, dass die hochgeladene Datei überhaupt wie ein Google-Service-Account-JSON aussieht, bevor
 * irgendein Netzwerkaufruf versucht wird - siehe verifyServiceAccountCredentials() für den
 * eigentlichen Live-Test gegen Google.
 */
export function parseServiceAccountJson(raw: string): GoogleServiceAccountCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Datei ist kein gültiges JSON.');
  }
  const candidate = parsed as Partial<Record<string, unknown>> & { type?: unknown };
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    candidate.type !== 'service_account' ||
    typeof candidate.client_email !== 'string' ||
    !candidate.client_email.includes('@') ||
    typeof candidate.private_key !== 'string' ||
    !candidate.private_key.includes('BEGIN PRIVATE KEY')
  ) {
    throw new Error('Datei sieht nicht wie ein Google-Service-Account-JSON aus (type/client_email/private_key fehlen).');
  }
  return { client_email: candidate.client_email, private_key: candidate.private_key };
}

function createJwtClient(creds: GoogleServiceAccountCredentials): JWT {
  return new JWT({ email: creds.client_email, key: creds.private_key, scopes: [CALENDAR_SCOPE] });
}

/**
 * Echter Test-Aufruf gegen Google (nicht nur JSON-Formvalidierung) - wird beim Hochladen der Datei
 * im Admin-UI aufgerufen, damit ein falscher/kaputter Schlüssel sofort mit Googles eigener
 * Fehlermeldung abgelehnt wird, statt unbrauchbar gespeichert zu werden. Wirft bei Fehlschlag.
 */
export async function verifyServiceAccountCredentials(raw: string): Promise<void> {
  const creds = parseServiceAccountJson(raw);
  await createJwtClient(creds).authorize();
}

interface OrgGoogleCalendarClient {
  jwt: JWT;
  calendarId: string;
}

async function getClientForOrganization(organizationId: string): Promise<OrgGoogleCalendarClient | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { googleCalendarServiceAccountJson: true, googleCalendarId: true },
  });
  if (!org?.googleCalendarServiceAccountJson || !org.googleCalendarId) return null;
  const creds = parseServiceAccountJson(org.googleCalendarServiceAccountJson);
  return { jwt: createJwtClient(creds), calendarId: org.googleCalendarId };
}

/** Vienna-lokales Datum (YYYY-MM-DD) aus einem UTC-Zeitpunkt - unabhängig von der Prozess-TZ. */
function formatViennaDateOnly(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date);
}

/** Vienna-lokales Datum+Zeit ohne Offset (für dateTime + separates timeZone-Feld bei Google). */
function formatViennaDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Googles end.date ist bei Ganztags-Terminen exklusiv (der Tag danach) - anders als app-177s
 * inklusives endsAt. Rechnet auf Basis des reinen Datumsstrings via UTC-Mittag weiter, um jede
 * DST-Grenzfall-Verschiebung zu vermeiden (Mittag liegt nie in der Nähe einer Zeitumstellung).
 */
function addOneDayToDateOnly(dateOnly: string): string {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12));
  noonUtc.setUTCDate(noonUtc.getUTCDate() + 1);
  return noonUtc.toISOString().slice(0, 10);
}

function toGoogleEventBody(event: Event): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: event.title,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
  };
  if (event.allDay) {
    body.start = { date: formatViennaDateOnly(event.startsAt) };
    body.end = { date: addOneDayToDateOnly(formatViennaDateOnly(event.endsAt)) };
  } else {
    body.start = { dateTime: formatViennaDateTime(event.startsAt), timeZone: TIME_ZONE };
    body.end = { dateTime: formatViennaDateTime(event.endsAt), timeZone: TIME_ZONE };
  }
  return body;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
  return message.slice(0, 500);
}

function isNotFoundError(error: unknown): boolean {
  const status = (error as { status?: number; response?: { status?: number } } | undefined)?.status;
  const responseStatus = (error as { response?: { status?: number } } | undefined)?.response?.status;
  return status === 404 || responseStatus === 404;
}

async function markSyncResult(organizationId: string, error: string | null): Promise<void> {
  await prisma.organization
    .update({
      where: { id: organizationId },
      data: { googleCalendarLastSyncAt: new Date(), googleCalendarLastSyncError: error },
    })
    .catch((updateError) => {
      console.error('Konnte googleCalendarLastSyncAt/-Error nicht aktualisieren:', updateError);
    });
}

/**
 * Schreibt einen app-177-Termin nach Google Calendar - Create beim ersten Mal (speichert die von
 * Google vergebene Id als googleEventId zurück), danach Update. Wirft nie: ein Fehler wird geloggt
 * und in Organization.googleCalendarLastSyncError sichtbar gemacht, blockiert aber nie den
 * eigentlichen Aufrufer (siehe CLAUDE.md-Prinzip "externer Seiteneffekt darf die Kernaktion nie
 * verhindern", z. B. notify-flight-created.ts).
 *
 * No-op (kein Fehler) wenn: die Organisation keine Google-Zugangsdaten hinterlegt hat, ODER
 * event.icsUid gesetzt ist (Schleifen-Schutz - ein aus Google importierter Termin wird nie
 * zurückgeschrieben, siehe docs/superpowers/specs/2026-08-04-google-calendar-push-sync-design.md).
 */
export async function pushEventToGoogleCalendar(event: Event): Promise<void> {
  if (event.icsUid) return;

  const client = await getClientForOrganization(event.organizationId);
  if (!client) return;

  try {
    const body = toGoogleEventBody(event);
    if (event.googleEventId) {
      await client.jwt.request({
        url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(client.calendarId)}/events/${encodeURIComponent(event.googleEventId)}`,
        method: 'PATCH',
        data: body,
      });
    } else {
      const response = await client.jwt.request<{ id: string }>({
        url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(client.calendarId)}/events`,
        method: 'POST',
        data: body,
      });
      await prisma.event.update({ where: { id: event.id }, data: { googleEventId: response.data.id } });
    }
    await markSyncResult(event.organizationId, null);
  } catch (error) {
    console.error('Google-Kalender-Push fehlgeschlagen:', error);
    await markSyncResult(event.organizationId, errorMessage(error));
  }
}

/**
 * Löscht das Google-Calendar-Gegenstück eines app-177-Termins (vor dem eigentlichen
 * prisma.event.delete() aufzurufen, da googleEventId danach nicht mehr lesbar wäre). No-op wenn kein
 * googleEventId gesetzt ist, keine Zugangsdaten hinterlegt sind, oder der Termin aus einem Import
 * stammt (icsUid gesetzt - kann dann gar kein googleEventId haben, siehe Schleifen-Schutz oben).
 * Eine 404-Antwort (in Google bereits gelöscht) gilt als Erfolg, nicht als Fehler.
 */
export async function deleteEventFromGoogleCalendar(
  event: Pick<Event, 'id' | 'organizationId' | 'googleEventId' | 'icsUid'>,
): Promise<void> {
  if (event.icsUid || !event.googleEventId) return;

  const client = await getClientForOrganization(event.organizationId);
  if (!client) return;

  try {
    await client.jwt.request({
      url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(client.calendarId)}/events/${encodeURIComponent(event.googleEventId)}`,
      method: 'DELETE',
    });
    await markSyncResult(event.organizationId, null);
  } catch (error) {
    if (isNotFoundError(error)) {
      await markSyncResult(event.organizationId, null);
      return;
    }
    console.error('Google-Kalender-Löschung fehlgeschlagen:', error);
    await markSyncResult(event.organizationId, errorMessage(error));
  }
}
