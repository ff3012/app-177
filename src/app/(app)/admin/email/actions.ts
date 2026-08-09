'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, isBezirksAdmin } from '@/lib/auth/permissions';
import { sendEmail } from '@/lib/email/mailjet';
import { setSystemCheckNotificationEmail } from '@/lib/settings';

export interface TestMailjetState {
  success?: boolean;
  error?: string;
}

const testEmailSchema = z.object({
  recipient: z.string().trim().email('Ungültige E-Mail-Adresse.'),
});

export async function sendTestEmail(
  _prevState: TestMailjetState,
  formData: FormData,
): Promise<TestMailjetState> {
  const user = await requireUser();
  assertPermission(isBezirksAdmin(user));

  const parsed = testEmailSchema.safeParse({ recipient: formData.get('recipient') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige E-Mail-Adresse.' };
  }

  try {
    await sendEmail({
      to: parsed.data.recipient,
      subject: 'Test: Mailjet-Integration',
      textPart:
        'Dies ist eine Testnachricht der Feuerwehr-App Abschnitt Purkersdorf. Die Mailjet-Integration funktioniert.',
      htmlPart:
        '<p>Dies ist eine Testnachricht der Feuerwehr-App Abschnitt Purkersdorf.</p><p>Die Mailjet-Integration funktioniert.</p>',
    });
  } catch (error) {
    console.error('Test-E-Mail fehlgeschlagen:', error);
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler beim Versand.';
    return { error: `Versand fehlgeschlagen: ${message}` };
  }

  return { success: true };
}

export interface SystemCheckEmailState {
  success?: boolean;
  error?: string;
}

const systemCheckEmailSchema = z.object({
  email: z.string().trim().email('Ungültige E-Mail-Adresse.'),
});

export async function saveSystemCheckEmail(
  _prevState: SystemCheckEmailState,
  formData: FormData,
): Promise<SystemCheckEmailState> {
  const user = await requireUser();
  assertPermission(isBezirksAdmin(user));

  const parsed = systemCheckEmailSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige E-Mail-Adresse.' };
  }

  await setSystemCheckNotificationEmail(parsed.data.email);
  revalidatePath('/admin/email');
  return { success: true };
}
