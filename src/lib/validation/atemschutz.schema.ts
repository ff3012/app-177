import { z } from 'zod';

// Ob jemand Atemschutzgeräteträger IST wird in der Benutzerverwaltung gepflegt (User.
// istAtemschutzgeraeteTraeger, siehe user.schema.ts) - dieses Schema verwaltet nur noch die
// Untersuchungs-/Finnentest-Details für bereits als Träger markierte Mitglieder.
export const atemschutzSchema = z.object({
  atemschutzUntersuchungAm: z.string().optional().or(z.literal('')),
  atemschutzGueltigBis: z.string().optional().or(z.literal('')),
  atemschutzFinnentestAm: z.string().optional().or(z.literal('')),
});

export type AtemschutzInput = z.infer<typeof atemschutzSchema>;

export function parseAtemschutzFormData(formData: FormData) {
  return {
    atemschutzUntersuchungAm: String(formData.get('atemschutzUntersuchungAm') ?? ''),
    atemschutzGueltigBis: String(formData.get('atemschutzGueltigBis') ?? ''),
    atemschutzFinnentestAm: String(formData.get('atemschutzFinnentestAm') ?? ''),
  };
}
