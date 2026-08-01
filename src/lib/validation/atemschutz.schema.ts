import { z } from 'zod';

// Keine Pflicht-Daten: ein Admin kann jemanden als Atemschutzgeräteträger markieren, bevor der
// erste Untersuchungs-/Finnentest-Termin feststeht.
export const atemschutzSchema = z.object({
  istAtemschutzgeraeteTraeger: z.boolean(),
  atemschutzUntersuchungAm: z.string().optional().or(z.literal('')),
  atemschutzGueltigBis: z.string().optional().or(z.literal('')),
  atemschutzFinnentestAm: z.string().optional().or(z.literal('')),
});

export type AtemschutzInput = z.infer<typeof atemschutzSchema>;

export function parseAtemschutzFormData(formData: FormData) {
  return {
    istAtemschutzgeraeteTraeger: formData.get('istAtemschutzgeraeteTraeger') === 'on',
    atemschutzUntersuchungAm: String(formData.get('atemschutzUntersuchungAm') ?? ''),
    atemschutzGueltigBis: String(formData.get('atemschutzGueltigBis') ?? ''),
    atemschutzFinnentestAm: String(formData.get('atemschutzFinnentestAm') ?? ''),
  };
}
