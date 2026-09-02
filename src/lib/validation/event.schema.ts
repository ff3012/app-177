import { z } from 'zod';

export const EVENT_CATEGORIES = ['ALLGEMEIN', 'DROHNENGRUPPE'] as const;
export type EventCategoryOption = (typeof EVENT_CATEGORIES)[number];

/** Sentinel-Wert für die "Alle Drohnengruppen (bezirksweit)"-Option im Formular-<select> - ein
 * <select> kann nie ein echtes `null` übermitteln, deshalb dieser String, den parseEventFormData
 * unten wieder auf `null` zurückführt (== bezirksweit, siehe Event.droneGroupId in schema.prisma). */
export const BEZIRKSWEIT_DRONE_GROUP_VALUE = 'BEZIRKSWEIT';

export const eventSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich.').max(200),
    description: z.string().trim().max(2000).optional().or(z.literal('')),
    location: z.string().trim().max(200).optional().or(z.literal('')),
    startsAt: z.string().min(1, 'Start ist erforderlich.'),
    endsAt: z.string().min(1, 'Ende ist erforderlich.'),
    allDay: z.boolean(),
    organizationId: z.string(),
    isSectionWide: z.boolean(),
    // Dritte Geltungsbereichs-Stufe für category ALLGEMEIN, additiv neben isSectionWide - siehe
    // canViewEvent und docs/superpowers/specs/2026-09-01-kalender-sondergruppen-design.md.
    isDistrictWide: z.boolean(),
    category: z.enum(EVENT_CATEGORIES),
    droneGroupId: z.string().nullable(),
    // Optionales Sondergruppen-Tag, nur für category ALLGEMEIN gedacht (siehe event-form.tsx) - null
    // heißt "keine Sondergruppe zugewiesen", fließt nicht in Sichtbarkeit/Berechtigung ein.
    sondergruppeId: z.string().nullable(),
  })
  .refine((data) => new Date(data.endsAt).getTime() >= new Date(data.startsAt).getTime(), {
    message: 'Ende darf nicht vor dem Start liegen.',
    path: ['endsAt'],
  })
  .refine((data) => data.category === 'DROHNENGRUPPE' || data.organizationId.length > 0, {
    // Für Kategorie DROHNENGRUPPE wird organizationId serverseitig abgeleitet (siehe
    // kalender/actions.ts) - das Formular blendet die Organisation-Auswahl für diese Kategorie aus
    // (siehe event-form.tsx), ein leerer Wert ist dort also erwartet, nicht fehlerhaft.
    message: 'Organisation ist erforderlich.',
    path: ['organizationId'],
  });
// Absichtlich KEIN .refine mehr, das droneGroupId für Kategorie DROHNENGRUPPE als truthy verlangt:
// `droneGroupId === null` ist für diese Kategorie jetzt ein gültiger, eigener Zustand ("bezirksweit,
// alle 4 Gruppen" - siehe Design-Spec), kein fehlender Pflichtwert mehr.

export type EventInput = z.infer<typeof eventSchema>;

export function parseEventFormData(formData: FormData) {
  const rawCategory = String(formData.get('category') ?? 'ALLGEMEIN');
  const rawDroneGroupId = String(formData.get('droneGroupId') ?? '');
  const rawSondergruppeId = String(formData.get('sondergruppeId') ?? '');
  return {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    location: String(formData.get('location') ?? ''),
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
    allDay: formData.get('allDay') === 'on',
    organizationId: String(formData.get('organizationId') ?? ''),
    isSectionWide: formData.get('isSectionWide') === 'on',
    isDistrictWide: formData.get('isDistrictWide') === 'on',
    category: (EVENT_CATEGORIES as readonly string[]).includes(rawCategory)
      ? (rawCategory as EventCategoryOption)
      : 'ALLGEMEIN',
    droneGroupId: rawDroneGroupId && rawDroneGroupId !== BEZIRKSWEIT_DRONE_GROUP_VALUE ? rawDroneGroupId : null,
    sondergruppeId: rawSondergruppeId ? rawSondergruppeId : null,
  };
}
