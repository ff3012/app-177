const TIME_ZONE = 'Europe/Vienna';

const dateFormat = new Intl.DateTimeFormat('de-AT', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('de-AT', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "So., 15. November 2026" in Wiener Zeit. */
export function formatKioskDate(date: Date): string {
  return dateFormat.format(date);
}

/** "11:59" in Wiener Zeit. */
export function formatKioskTime(date: Date): string {
  return timeFormat.format(date);
}
