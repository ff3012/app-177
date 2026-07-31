import type { CalendarEventInput } from './calendar-view';

interface RsvpBadgeProps {
  counts: NonNullable<CalendarEventInput['rsvpCounts']>;
  /** Plain colored text instead of pill backgrounds - used inside the FullCalendar month-grid
   * chip, where there's no room for padded pills (see calendar-view.tsx's eventContent). */
  compact?: boolean;
}

export function RsvpBadge({ counts, compact }: RsvpBadgeProps) {
  if (counts.ZUGESAGT === 0 && counts.ABGESAGT === 0 && counts.UNKLAR === 0) {
    return <span className="text-neutral-400">–</span>;
  }

  if (compact) {
    return (
      <span className="whitespace-nowrap text-[10px] leading-tight">
        <span className="text-green-100">✓ {counts.ZUGESAGT}</span> ·{' '}
        <span className="text-red-200">✗ {counts.ABGESAGT}</span> ·{' '}
        <span className="text-neutral-200">? {counts.UNKLAR}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex gap-1 whitespace-nowrap">
      <span className="rounded bg-green-100 px-1 text-green-800">✓ {counts.ZUGESAGT}</span>
      <span className="rounded bg-red-100 px-1 text-red-800">✗ {counts.ABGESAGT}</span>
      <span className="rounded bg-neutral-200 px-1 text-neutral-700">? {counts.UNKLAR}</span>
    </span>
  );
}
