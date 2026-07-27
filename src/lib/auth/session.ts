import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth.config';
import type { SessionUser } from '@/types/next-auth';

export async function getOptionalUser(): Promise<SessionUser | null> {
  const session = await auth();
  return session?.user ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getOptionalUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}
