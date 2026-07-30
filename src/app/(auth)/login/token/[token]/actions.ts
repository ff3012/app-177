'use server';

import { signIn } from '@/lib/auth/auth.config';
import { isAuthError, isNextRedirectError } from '@/lib/auth/is-auth-error';

export interface EmailTokenLoginState {
  error?: string;
}

/**
 * Verbraucht den Anmelde-Link erst bei explizitem Klick (nicht schon beim Laden der Seite) -
 * sonst könnten E-Mail-Link-Scanner/Sicherheits-Gateways den Einmal-Token durch einen
 * automatischen GET-Abruf vorzeitig verbrauchen, bevor der echte Benutzer klickt.
 */
export async function confirmEmailTokenLogin(token: string): Promise<EmailTokenLoginState> {
  try {
    await signIn('email-token', { token, redirectTo: '/kalender' });
    return {};
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    if (isAuthError(error)) {
      return { error: 'Der Link ist ungültig, abgelaufen oder bereits verwendet. Bitte fordere einen neuen Anmeldelink an.' };
    }
    throw error;
  }
}
