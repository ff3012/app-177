'use server';

import { AuthError } from 'next-auth';
import { signIn } from '@/lib/auth/auth.config';

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
    if (error instanceof AuthError) {
      return { error: 'E-Mail oder Passwort ist falsch.' };
    }
    throw error;
  }
}
