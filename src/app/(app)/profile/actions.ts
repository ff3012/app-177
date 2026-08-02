'use server';

import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { hashPassword, verifyPassword } from '@/lib/password';
import { changePasswordSchema, parseChangePasswordFormData } from '@/lib/validation/password-policy';
import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';

const FEEDBACK_RECIPIENT = 'florian.krebs@feuerwehr.gv.at';

export interface ChangePasswordState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

export async function changePassword(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireUser();

  const parsed = changePasswordSchema.safeParse(parseChangePasswordFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) {
    return { error: 'Benutzer wurde nicht gefunden.' };
  }

  const currentPasswordValid = await verifyPassword(data.currentPassword, dbUser.passwordHash);
  if (!currentPasswordValid) {
    return { fieldErrors: { currentPassword: ['Aktuelles Passwort ist falsch.'] } };
  }

  const passwordHash = await hashPassword(data.newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordChangedAt: new Date() },
  });

  return { success: true };
}

export interface FeedbackState {
  error?: string;
  success?: boolean;
}

const feedbackSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Bitte eine Bewertung auswählen.').max(5),
  message: z.string().trim().max(2000).optional().or(z.literal('')),
});

export async function sendFeedback(_prevState: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const user = await requireUser();

  const parsed = feedbackSchema.safeParse({
    rating: formData.get('rating'),
    message: formData.get('message'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Bitte eine Bewertung auswählen.' };
  }
  const { rating, message } = parsed.data;
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const messageText = message || '(kein Freitext)';

  try {
    await sendEmail({
      to: FEEDBACK_RECIPIENT,
      subject: `Feedback von ${user.name} (${rating}/5 Sterne)`,
      textPart: `Feedback von ${user.name} (${user.email})\n\nBewertung: ${stars} (${rating}/5)\n\n${messageText}`,
      htmlPart: `<p>Feedback von ${escapeHtml(user.name)} (${escapeHtml(user.email)})</p><p>Bewertung: ${stars} (${rating}/5)</p><p>${escapeHtml(messageText).replace(/\n/g, '<br>')}</p>`,
    });
  } catch (error) {
    console.error('Feedback-Versand fehlgeschlagen:', error);
    return { error: 'Feedback konnte nicht gesendet werden. Bitte später erneut versuchen.' };
  }

  return { success: true };
}
