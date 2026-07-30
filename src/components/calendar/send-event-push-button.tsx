'use client';

import { useState, useTransition } from 'react';
import { triggerEventPushNotification, type EventPushActionState } from '@/app/(app)/kalender/[eventId]/rsvp-actions';

export function SendEventPushButton({ eventId }: { eventId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<EventPushActionState | undefined>();

  function handleClick() {
    setResult(undefined);
    startTransition(async () => {
      const outcome = await triggerEventPushNotification(eventId);
      setResult(outcome);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="self-start rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
      >
        {pending ? 'Wird gesendet…' : 'Push-Benachrichtigung jetzt senden'}
      </button>
      {result?.error && <p className="text-xs text-red-700">{result.error}</p>}
      {result?.success && (
        <p className="text-xs text-green-700">
          Gesendet an {result.sent} von {result.recipients} Geräten.
        </p>
      )}
    </div>
  );
}
