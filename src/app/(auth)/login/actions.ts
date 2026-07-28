'use server';

import { signIn } from '@/lib/auth/auth.config';
import { isAuthError, isNextRedirectError } from '@/lib/auth/is-auth-error';
import { checkLoginThrottle, recordFailedLogin, resetLoginAttempts } from '@/lib/auth/login-throttle';

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
