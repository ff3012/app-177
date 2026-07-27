'use client';

import { useActionState } from 'react';
import { requestPasswordReset, type ForgotPasswordState } from './actions';

const initialState: ForgotPasswordState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.submitted) {
    return (
      <p className="text-sm text-neutral-700">
        Falls ein aktives Konto mit dieser E-Mail-Adresse existiert, wurde ein Link zum Zurücksetzen des Passworts
        gesendet.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-neutral-700">
          E-Mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
      </div>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Senden…' : 'Link anfordern'}
      </button>
    </form>
  );
}
