import { z } from 'zod';

export const createFeuerwehrSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
  shortName: z.string().trim().max(100).optional().or(z.literal('')),
  nummer: z.string().trim().min(1, 'Nummer ist erforderlich.').max(20),
  parentId: z.string().trim().min(1, 'Abschnitt ist erforderlich.'),
});
export type CreateFeuerwehrInput = z.infer<typeof createFeuerwehrSchema>;

export const renameFeuerwehrSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
  shortName: z.string().trim().max(100).optional().or(z.literal('')),
});
export type RenameFeuerwehrInput = z.infer<typeof renameFeuerwehrSchema>;

export const createDroneGroupSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
  organizationId: z.string().trim().min(1, 'Abschnitt ist erforderlich.'),
});
export type CreateDroneGroupInput = z.infer<typeof createDroneGroupSchema>;

export const renameDroneGroupSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
});
export type RenameDroneGroupInput = z.infer<typeof renameDroneGroupSchema>;

export const createSondergruppeSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
});
export type CreateSondergruppeInput = z.infer<typeof createSondergruppeSchema>;

export const renameSondergruppeSchema = z.object({
  name: z.string().trim().min(1, 'Name ist erforderlich.').max(200),
});
export type RenameSondergruppeInput = z.infer<typeof renameSondergruppeSchema>;
