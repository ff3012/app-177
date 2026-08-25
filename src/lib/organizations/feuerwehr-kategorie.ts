import type { FeuerwehrKategorie } from '@prisma/client';

export const FEUERWEHR_KATEGORIE_LABEL: Record<FeuerwehrKategorie, string> = {
  FREIWILLIGE_FEUERWEHR: 'Freiwillige Feuerwehr',
  BETRIEBSFEUERWEHR: 'Betriebsfeuerwehr',
};
