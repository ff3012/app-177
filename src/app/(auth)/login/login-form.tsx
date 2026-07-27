'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = {};

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

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

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-neutral-700">
          Passwort
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
      </div>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? 'Anmelden…' : 'Anmelden'}
      </button>
    </form>
  );
}
