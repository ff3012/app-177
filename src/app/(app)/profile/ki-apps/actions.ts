'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { revokeConnection } from '@/lib/mcp/connections';

/** Beendet die Verbindung einer KI-App für den angemeldeten Benutzer (nie für andere). */
export async function revokeMyConnection(oauthClientId: string): Promise<void> {
  const user = await requireUser();
  // Der Parameter kommt vom Client (Server-Action-Argument): leer oder kein String widerruft nichts.
  if (typeof oauthClientId !== 'string' || !oauthClientId) return;
  await revokeConnection(user.id, oauthClientId);
  revalidatePath('/profile/ki-apps');
}
