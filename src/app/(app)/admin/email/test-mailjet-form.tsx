'use client';

import { useActionState } from 'react';
import { sendTestEmail, type TestMailjetState } from './actions';

const initialState: TestMailjetState = {};

export function TestMailjetForm() {
  const [state, formAction, pending] = useActionState(sendTestEmail, initialState);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="recipient" className="text-sm font-medium text-neutral-700">
          Empfänger E-Mail-Adresse
        </label>
        <input
          id="recipient"
          name="recipient"
          type="email"
          required
          className="rounded border border-neutral-300 px-3 py-2"
        />
      </div>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.success && <p className="text-sm text-green-700">Test-E-Mail wurde gesendet.</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Wird gesendet…' : 'Test Mailjet'}
      </button>
    </form>
  );
}
