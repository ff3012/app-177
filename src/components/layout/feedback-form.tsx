'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { sendFeedback, type FeedbackState } from '@/app/(app)/profile/actions';

const initialState: FeedbackState = {};

export function FeedbackForm() {
  const [state, formAction, pending] = useActionState(sendFeedback, initialState);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      setRating(0);
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-neutral-600">Bewertung</label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              aria-label={`${star} von 5 Sternen`}
              className="text-2xl leading-none"
            >
              <span className={(hoverRating || rating) >= star ? 'text-amber-500' : 'text-neutral-300'}>★</span>
            </button>
          ))}
        </div>
        <input type="hidden" name="rating" value={rating} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="feedback-message" className="text-xs font-medium text-neutral-600">
          Dein Feedback (optional)
        </label>
        <textarea
          id="feedback-message"
          name="message"
          rows={3}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
      </div>

      {state.error && <p className="text-xs text-red-700">{state.error}</p>}
      {state.success && <p className="text-xs text-green-700">Danke für dein Feedback!</p>}

      <button
        type="submit"
        disabled={pending || rating === 0}
        className="self-start rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Wird gesendet…' : 'Feedback senden'}
      </button>
    </form>
  );
}
