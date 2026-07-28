'use client';

import { useState, useTransition } from 'react';
import { sendPasswordResetEmailToUser, type PasswordResetEmailState } from '../actions';

export function PasswordResetEmailButton({ userId }: { userId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PasswordResetEmailState>({});

  function handleClick() {
    startTransition(async () => {
      const outcome = await sendPasswordResetEmailToUser(userId);
      setResult(outcome);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="self-start rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
      >
        {pending ? 'Wird gesendet…' : 'Password Reset E-Mail senden'}
      </button>
      {result.success && <p className="text-xs text-green-700">E-Mail wurde gesendet.</p>}
      {result.error && <p className="text-xs text-red-700">{result.error}</p>}
    </div>
  );
}
