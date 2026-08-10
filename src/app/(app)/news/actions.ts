'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NewsAudienceType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageNews } from '@/lib/auth/permissions';
import { newsSchema, parseNewsFormData } from '@/lib/validation/news.schema';
import { dispatchNewsMessage } from '@/lib/news/send-news';

export interface NewsFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export async function createNewsMessage(_prevState: NewsFormState, formData: FormData): Promise<NewsFormState> {
  const user = await requireUser();
  assertPermission(canManageNews(user));

  const parsed = newsSchema.safeParse(parseNewsFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const news = await prisma.newsMessage.create({
    data: {
      title: data.title,
      body: data.body,
      audienceType: data.audienceType === 'DROHNENGRUPPE' ? NewsAudienceType.DROHNENGRUPPE : NewsAudienceType.ORGANIZATION,
      audienceOrgId: data.audienceType === 'ORGANIZATION' ? data.audienceOrgId || null : null,
      audienceDroneGroupId: data.audienceType === 'DROHNENGRUPPE' ? data.audienceDroneGroupId || null : null,
      scheduledAt: data.sendMode === 'SCHEDULED' && data.scheduledAt ? new Date(data.scheduledAt) : null,
      createdById: user.id,
    },
  });

  if (data.sendMode === 'NOW') {
    try {
      await dispatchNewsMessage(news.id);
    } catch (error) {
      console.error('News-Versand fehlgeschlagen:', error);
      return {
        error: 'News wurde gespeichert, aber der Versand ist fehlgeschlagen. Bitte Push-Konfiguration prüfen.',
      };
    }
  }

  revalidatePath('/news');
  redirect('/news');
}
