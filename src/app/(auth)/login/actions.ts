'use server';

import { cookies } from 'next/headers';
import { TokenPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { signIn } from '@/lib/auth/auth.config';
import { isAuthError, isNextRedirectError } from '@/lib/auth/is-auth-error';
import { checkLoginThrottle, recordFailedLogin, resetLoginAttempts } from '@/lib/auth/login-throttle';
import { createToken } from '@/lib/auth/tokens';
import { sendLoginTokenEmail } from '@/lib/email/templates';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const emailRaw = formData.get('email');
  const password = formData.get('password');
  const callbackUrl = formData.get('callbackUrl');
  const email = typeof emailRaw === 'string' ? emailRaw.toLowerCase().trim() : '';

  const throttle = await checkLoginThrottle(email);
  if (throttle.locked) {
    return {
      error: `Zu viele Fehlversuche. Bitte in ${throttle.minutesRemaining} Minute(n) erneut versuchen.`,
    };
  }

  try {
    await signIn('credentials', {
      email,
      password,
      redirectTo: typeof callbackUrl === 'string' && callbackUrl.length > 0 ? callbackUrl : '/kalender',
    });
    await resetLoginAttempts(email);
    return {};
  } catch (error) {
    if (isNextRedirectError(error)) {
      await resetLoginAttempts(email);
      throw error;
    }
    if (isAuthError(error)) {
      await recordFailedLogin(email);
      return { error: 'E-Mail oder Passwort ist falsch.' };
    }
    throw error;
  }
}

export interface LoginTokenState {
  submitted?: boolean;
  error?: string;
}

const LOGIN_TOKEN_RATE_LIMIT_SECONDS = 30;
const LOGIN_TOKEN_COOKIE_NAME = 'logintoken_last_request';

/**
 * Fordert einen Anmeldelink per E-Mail an. Antwortet bewusst immer gleich (kein
 * Enumeration-Leak), analog zu requestPasswordReset in passwort-vergessen/actions.ts - "Wenn ein
 * Benutzer nicht registriert ist, Meldung wie gehabt" wird hier als derselbe nicht-verratende
 * Text wie beim bestehenden Passwort-Link-Anfordern umgesetzt, nicht als abweichende Fehlermeldung.
 */
export async function requestLoginToken(_prevState: LoginTokenState, formData: FormData): Promise<LoginTokenState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!email) {
    return { error: 'E-Mail-Adresse ist erforderlich.' };
  }

  const now = Date.now();
  const cookieStore = await cookies();

  const lastRequestCookie = cookieStore.get(LOGIN_TOKEN_COOKIE_NAME)?.value;
  const blockedByCookie =
    Boolean(lastRequestCookie) && now - Number(lastRequestCookie) < LOGIN_TOKEN_RATE_LIMIT_SECONDS * 1000;

  if (!blockedByCookie) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.isActive) {
      const recentToken = await prisma.passwordToken.findFirst({
        where: {
          userId: user.id,
          purpose: TokenPurpose.LOGIN,
          createdAt: { gt: new Date(now - LOGIN_TOKEN_RATE_LIMIT_SECONDS * 1000) },
        },
      });

      if (!recentToken) {
        const token = await createToken(user.id, TokenPurpose.LOGIN);
        try {
          await sendLoginTokenEmail(user, token);
        } catch (error) {
          console.error('Fehler beim Senden der Anmelde-Link-E-Mail:', error);
        }
      }
    }
  }

  cookieStore.set(LOGIN_TOKEN_COOKIE_NAME, String(now), {
    maxAge: LOGIN_TOKEN_RATE_LIMIT_SECONDS,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/login',
  });

  return { submitted: true };
}

/**
 * Meldet direkt auf dieser Seite an, statt über den per Mail verschickten Link zu gehen - eine
 * am Homescreen installierte iOS-PWA hat einen eigenen, von Safari getrennten Speicher-Container
 * (bestätigt durch Test: selbst vollständiges Schließen+Neuöffnen der App übernimmt eine in
 * Safari über den Link hergestellte Anmeldung NICHT). Ein per Mail-App geöffneter Link landet
 * immer in Safari, nie direkt in der bereits offenen Homescreen-App - das lässt sich nicht
 * umgehen. Der einzige zuverlässige Weg: den Code direkt in der bereits geöffneten App-Instanz
 * einfügen, damit signIn() im selben Speicher-Container läuft, in dem die Seite gerade läuft.
 */
export async function confirmLoginWithToken(_prevState: LoginTokenState, formData: FormData): Promise<LoginTokenState> {
  const token = String(formData.get('token') ?? '').trim();
  if (!token) {
    return { error: 'Bitte den Code aus der E-Mail eingeben.' };
  }

  try {
    await signIn('email-token', { token, redirectTo: '/kalender' });
    return {};
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    if (isAuthError(error)) {
      return { error: 'Der Code ist ungültig, abgelaufen oder bereits verwendet. Bitte fordere einen neuen an.' };
    }
    throw error;
  }
}
