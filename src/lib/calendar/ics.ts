import ical from 'ical-generator';
import type { Event as PrismaEvent } from '@prisma/client';

export function buildIcsCalendar(name: string, events: PrismaEvent[]): string {
  const calendar = ical({ name, timezone: 'Europe/Vienna' });

  for (const event of events) {
    calendar.createEvent({
      id: event.id,
      start: event.startsAt,
      end: event.endsAt,
      allDay: event.allDay,
      summary: event.title,
      description: event.description ?? undefined,
      location: event.location ?? undefined,
      timezone: 'Europe/Vienna',
    });
  }

  return calendar.toString();
}
