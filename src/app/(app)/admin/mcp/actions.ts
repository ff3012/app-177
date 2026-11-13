'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission, isBezirksAdmin } from '@/lib/auth/permissions';
import { requireUser } from '@/lib/auth/session';
import { setMcpEnabled } from '@/lib/mcp/enabled';

/** Schaltet den MCP-Connector ein oder aus - nur Bezirksadmin (jede Action prüft selbst, die Seite allein reicht nicht). */
export async function toggleMcpEnabled(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertPermission(isBezirksAdmin(user), 'Nur Bezirksadmins dürfen den MCP-Connector umschalten.');
  await setMcpEnabled(formData.get('enabled') === 'true');
  revalidatePath('/admin/mcp');
}
