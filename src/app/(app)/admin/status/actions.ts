'use server';

import { requireUser } from '@/lib/auth/session';
import { assertPermission, isSiteAdmin } from '@/lib/auth/permissions';
import { getSystemCheckResult, type SystemCheckResult } from '@/lib/system/system-check';
import { notifySystemCheckResult } from '@/lib/system/notify-system-check';

export type { SystemCheckResult };

// Der manuelle Button sendet die E-Mail bewusst mit (nicht nur der tägliche Cron) - das ist der
// einfachste Weg für einen Admin, den Versandpfad (Empfänger konfiguriert? Mailjet erreichbar?)
// auf Knopfdruck zu testen, ohne auf den nächsten Cron-Lauf zu warten. notifySystemCheckResult
// no-opt selbst, wenn keine Adresse hinterlegt ist, und schluckt Versandfehler intern.
export async function runSystemCheck(): Promise<SystemCheckResult> {
  const user = await requireUser();
  assertPermission(isSiteAdmin(user));
  const result = await getSystemCheckResult();
  await notifySystemCheckResult(result);
  return result;
}
