import { z } from 'zod';

export const EVENT_CATEGORIES = ['ALLGEMEIN', 'DROHNENGRUPPE'] as const;
export type EventCategoryOption = (typeof EVENT_CATEGORIES)[number];

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
    category: z.enum(EVENT_CATEGORIES),
    droneGroupId: z.string().nullable(),
  })
  .refine((data) => new Date(data.endsAt).getTime() >= new Date(data.startsAt).getTime(), {
    message: 'Ende darf nicht vor dem Start liegen.',
    path: ['endsAt'],
  })
  // Ein Termin der Kategorie "Drohnengruppe" OHNE Gruppe wäre für niemanden sichtbar (jede
  // Sichtbarkeits-/Push-Prüfung vergleicht exakt gegen die Gruppe des Nutzers) - er würde also still
  // im Nichts landen. Serverseitig geprüft, nicht nur über die UI, damit auch ein direkter
  // Server-Action-Aufruf keine solche Waise anlegen kann.
  .refine((data) => data.category !== 'DROHNENGRUPPE' || Boolean(data.droneGroupId), {
    message: 'Für einen Drohnengruppen-Termin muss eine Drohnengruppe gewählt werden.',
    path: ['droneGroupId'],
  });

export type EventInput = z.infer<typeof eventSchema>;

export function parseEventFormData(formData: FormData) {
  const rawCategory = String(formData.get('category') ?? 'ALLGEMEIN');
  return {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    location: String(formData.get('location') ?? ''),
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
    allDay: formData.get('allDay') === 'on',
    organizationId: String(formData.get('organizationId') ?? ''),
    isSectionWide: formData.get('isSectionWide') === 'on',
    category: (EVENT_CATEGORIES as readonly string[]).includes(rawCategory)
      ? (rawCategory as EventCategoryOption)
      : 'ALLGEMEIN',
    droneGroupId: (formData.get('droneGroupId') as string) || null,
  };
}
