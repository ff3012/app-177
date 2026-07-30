import { z } from 'zod';

export const RSVP_STATUSES = ['ZUGESAGT', 'ABGESAGT', 'UNKLAR'] as const;
export type RsvpStatusOption = (typeof RSVP_STATUSES)[number];

export const rsvpSchema = z.object({
  status: z.enum(RSVP_STATUSES),
  note: z.string().trim().max(200, 'Notiz darf maximal 200 Zeichen lang sein.').optional(),
});

export type RsvpInput = z.infer<typeof rsvpSchema>;
