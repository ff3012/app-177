import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth.config';
import type { SessionUser } from '@/types/next-auth';

export async function getOptionalUser(): Promise<SessionUser | null> {
  const session = await auth();
  // Der jwt()-Callback leert token.id, wenn der Benutzer nicht mehr existiert oder deaktiviert wurde.
  if (!session?.user?.id) {
    return null;
  }
  return session.user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getOptionalUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}
