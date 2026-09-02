/** Shared by kalender/page.tsx (event backgroundColor), LayerLegend, and EventCard's accent bar, so
 * the three can never disagree on what color a layer is. */
export const LAYER_COLORS: Record<string, string> = {
  own: '#1c1c1e',
  abschnitt: '#e4322b',
  bezirk: '#5856d6',
  drohnengruppe: '#22a06b',
};

export const LAYER_LABELS: Record<string, string> = {
  own: 'Meine Feuerwehr',
  abschnitt: 'Abschnitt-Kalender',
  bezirk: 'Bezirk-weit',
  drohnengruppe: 'Drohnengruppe',
};
