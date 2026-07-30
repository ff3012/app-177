'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { EmailTokenLoginState } from './actions';

export function ConfirmLoginForm({ action }: { action: () => Promise<EmailTokenLoginState> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function handleClick() {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-red-700">{error}</p>
          <Link href="/login" className="text-sm text-brand hover:underline">
            Zurück zur Anmeldung
          </Link>
        </div>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Anmelden…' : 'Jetzt anmelden'}
      </button>
    </div>
  );
}
