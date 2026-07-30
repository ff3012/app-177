'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useActionState } from 'react';
import { loginAction, requestLoginToken, type LoginState, type LoginTokenState } from './actions';

const initialLoginState: LoginState = {};
const initialTokenState: LoginTokenState = {};

type Mode = 'password' | 'email-token';

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [mode, setMode] = useState<Mode>('password');
  const [loginState, loginFormAction, loginPending] = useActionState(loginAction, initialLoginState);
  const [tokenState, tokenFormAction, tokenPending] = useActionState(requestLoginToken, initialTokenState);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex rounded-lg bg-neutral-100 p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode('password')}
          className={`flex-1 rounded px-3 py-1.5 font-medium ${
            mode === 'password' ? 'bg-brand text-white' : 'text-neutral-600 hover:bg-neutral-200'
          }`}
        >
          Passwort
        </button>
        <button
          type="button"
          onClick={() => setMode('email-token')}
          className={`flex-1 rounded px-3 py-1.5 font-medium ${
            mode === 'email-token' ? 'bg-brand text-white' : 'text-neutral-600 hover:bg-neutral-200'
          }`}
        >
          E-Mail Token
        </button>
      </div>

      {mode === 'password' ? (
        <form action={loginFormAction} className="flex flex-col gap-4">
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
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium text-neutral-700">
                Passwort
              </label>
              <Link href="/passwort-vergessen" className="text-xs text-brand hover:underline">
                Passwort vergessen?
              </Link>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="rounded border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none"
            />
          </div>

          {loginState.error && <p className="text-sm text-red-700">{loginState.error}</p>}

          <button
            type="submit"
            disabled={loginPending}
            className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {loginPending ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
      ) : tokenState.submitted ? (
        <p className="text-sm text-neutral-700">
          Falls ein aktives Konto mit dieser E-Mail-Adresse existiert, wurde ein Anmeldelink gesendet. Bitte
          E-Mails prüfen (auch Spam-Ordner). Der Link ist 15 Minuten gültig.
        </p>
      ) : (
        <form action={tokenFormAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="token-email" className="text-sm font-medium text-neutral-700">
              E-Mail
            </label>
            <input
              id="token-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="rounded border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none"
            />
            <p className="text-xs text-neutral-500">Du erhältst einen Anmeldelink per E-Mail, gültig 15 Minuten.</p>
          </div>

          {tokenState.error && <p className="text-sm text-red-700">{tokenState.error}</p>}

          <button
            type="submit"
            disabled={tokenPending}
            className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {tokenPending ? 'Senden…' : 'Anmeldelink senden'}
          </button>
        </form>
      )}
    </div>
  );
}
