'use server';

import { signOut } from '@/lib/auth/auth.config';

export async function logoutAction() {
  await signOut({ redirectTo: '/login' });
}
