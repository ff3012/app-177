'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useActionState } from 'react';
import { getRememberedValues, rememberValue } from '@/lib/remembered-values';
import {
  loginAction,
  requestLoginToken,
  confirmLoginWithToken,
  type LoginState,
  type LoginTokenState,
} from './actions';

const initialLoginState: LoginState = {};
const initialTokenState: LoginTokenState = {};
const initialConfirmState: LoginTokenState = {};

// Merkt genau die zuletzt verwendete Login-E-Mail (nicht das Passwort - das bleibt Androids
// eigenem Passwort-Manager überlassen, siehe docs/superpowers/specs/2026-08-28-
// formular-vorschlaege-design.md). Ein gemeinsamer Key für alle drei E-Mail-Felder unten, da sie
// dieselbe Identität repräsentieren.
const LOGIN_EMAIL_KEY = 'app177-last-login-email';

type Mode = 'password' | 'email-token';

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [mode, setMode] = useState<Mode>('password');
  // Treibt alle drei E-Mail-Felder unten (Passwort-Modus + beide E-Mail-Token-Modi) - vormals nur
  // "tokenEmail" für die letzten beiden, jetzt umbenannt, da der Name sonst irreführend wäre.
  const [email, setEmail] = useState('');
  const [loginState, loginFormAction, loginPending] = useActionState(loginAction, initialLoginState);
  const [tokenState, tokenFormAction, tokenPending] = useActionState(requestLoginToken, initialTokenState);
  const [confirmState, confirmFormAction, confirmPending] = useActionState(confirmLoginWithToken, initialConfirmState);

  useEffect(() => {
    const [remembered] = getRememberedValues(LOGIN_EMAIL_KEY);
    if (remembered) setEmail(remembered);
  }, []);

  function rememberEmail() {
    rememberValue(LOGIN_EMAIL_KEY, email, 1);
  }

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
        <form action={loginFormAction} onSubmit={rememberEmail} className="flex flex-col gap-4">
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
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
      ) : (
        <div className="flex flex-col gap-4">
          {tokenState.submitted ? (
            <p className="text-sm text-neutral-700">
              Falls ein aktives Konto mit dieser E-Mail-Adresse existiert, wurde eine E-Mail mit Anmeldelink und
              Code gesendet. Bitte E-Mails prüfen (auch Spam-Ordner). Gültig 5 Minuten.
            </p>
          ) : (
            <form action={tokenFormAction} onSubmit={rememberEmail} className="flex flex-col gap-4">
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
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="rounded border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none"
                />
                <p className="text-xs text-neutral-500">Du erhältst einen Anmeldelink und einen 6-stelligen Code per E-Mail, gültig 5 Minuten.</p>
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

          <div className="flex items-center gap-3 text-xs text-neutral-400">
            <div className="h-px flex-1 bg-neutral-200" />
            oder
            <div className="h-px flex-1 bg-neutral-200" />
          </div>

          <form action={confirmFormAction} onSubmit={rememberEmail} className="flex flex-col gap-3">
            <p className="text-xs text-neutral-500">
              Nutzt du die App vom Homescreen aus? Öffne den Link in der E-Mail nicht (er würde nur in Safari
              anmelden), sondern gib E-Mail und den 6-stelligen Code hier direkt ein.
            </p>

            <div className="flex flex-col gap-1">
              <label htmlFor="confirm-email" className="text-sm font-medium text-neutral-700">
                E-Mail
              </label>
              <input
                id="confirm-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="rounded border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="shortCode" className="text-sm font-medium text-neutral-700">
                6-stelliger Code aus E-Mail
              </label>
              <input
                id="shortCode"
                name="shortCode"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                className="rounded border border-neutral-300 px-3 py-2 font-mono text-lg tracking-widest focus:border-brand focus:outline-none"
                placeholder="123456"
              />
            </div>

            {confirmState.error && <p className="text-sm text-red-700">{confirmState.error}</p>}

            <button
              type="submit"
              disabled={confirmPending}
              className="self-start rounded border border-neutral-300 px-4 py-2 font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
            >
              {confirmPending ? 'Anmelden…' : 'Mit Code anmelden'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
