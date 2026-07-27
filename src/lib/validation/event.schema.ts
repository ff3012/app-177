import { z } from 'zod';

export const eventSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich.').max(200),
    description: z.string().trim().max(2000).optional().or(z.literal('')),
    location: z.string().trim().max(200).optional().or(z.literal('')),
    startsAt: z.string().min(1, 'Start ist erforderlich.'),
    endsAt: z.string().min(1, 'Ende ist erforderlich.'),
    allDay: z.boolean(),
    organizationId: z.string().min(1, 'Organisation ist erforderlich.'),
    isSectionWide: z.boolean(),
  })
  .refine((data) => new Date(data.endsAt).getTime() >= new Date(data.startsAt).getTime(), {
    message: 'Ende darf nicht vor dem Start liegen.',
    path: ['endsAt'],
  });

export type EventInput = z.infer<typeof eventSchema>;

export function parseEventFormData(formData: FormData) {
  return {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    location: String(formData.get('location') ?? ''),
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
    allDay: formData.get('allDay') === 'on',
    organizationId: String(formData.get('organizationId') ?? ''),
    isSectionWide: formData.get('isSectionWide') === 'on',
  };
}
