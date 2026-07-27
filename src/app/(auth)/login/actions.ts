'use server';

import { signIn } from '@/lib/auth/auth.config';
import { isAuthError } from '@/lib/auth/is-auth-error';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get('email');
  const password = formData.get('password');
  const callbackUrl = formData.get('callbackUrl');

  try {
    await signIn('credentials', {
      email,
      password,
      redirectTo: typeof callbackUrl === 'string' && callbackUrl.length > 0 ? callbackUrl : '/kalender',
    });
    return {};
  } catch (error) {
    if (isAuthError(error)) {
      return { error: 'E-Mail oder Passwort ist falsch.' };
    }
    throw error;
  }
}
