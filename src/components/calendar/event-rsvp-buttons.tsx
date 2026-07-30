'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setRsvp } from '@/app/(app)/kalender/[eventId]/rsvp-actions';
import type { RsvpStatusOption } from '@/lib/validation/rsvp.schema';

const STATUS_LABEL: Record<RsvpStatusOption, string> = {
  ZUGESAGT: 'Zugesagt',
  ABGESAGT: 'Abgesagt',
  UNKLAR: 'Unklar',
};

const STATUS_ACTIVE_CLASS: Record<RsvpStatusOption, string> = {
  ZUGESAGT: 'bg-green-600 text-white border-green-600',
  ABGESAGT: 'bg-red-600 text-white border-red-600',
  UNKLAR: 'bg-neutral-500 text-white border-neutral-500',
};

interface EventRsvpButtonsProps {
  eventId: string;
  initialStatus: RsvpStatusOption | null;
  /** Wenn gesetzt: Notizfeld + expliziter Speichern-Button (Detailseite). Sonst sofortiges Speichern per Klick (Übersicht). */
  initialNote?: string;
  withNote?: boolean;
}

export function EventRsvpButtons({ eventId, initialStatus, initialNote, withNote = false }: EventRsvpButtonsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<RsvpStatusOption | null>(initialStatus);
  const [note, setNote] = useState(initialNote ?? '');
  const [error, setError] = useState<string | undefined>();

  function save(nextStatus: RsvpStatusOption, nextNote?: string) {
    setError(undefined);
    setStatus(nextStatus);
    startTransition(async () => {
      const result = await setRsvp(eventId, nextStatus, nextNote);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        {(Object.keys(STATUS_LABEL) as RsvpStatusOption[]).map((option) => (
          <button
            key={option}
            type="button"
            disabled={pending}
            onClick={() => (withNote ? setStatus(option) : save(option))}
            className={`rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-60 ${
              status === option ? STATUS_ACTIVE_CLASS[option] : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {STATUS_LABEL[option]}
          </button>
        ))}
      </div>

      {withNote && (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            rows={2}
            placeholder="Notiz (optional, max. 200 Zeichen)"
            className="rounded border border-neutral-300 px-2.5 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={pending || !status}
            onClick={() => status && save(status, note)}
            className="self-start rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {pending ? 'Speichert…' : 'Zusage speichern'}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
