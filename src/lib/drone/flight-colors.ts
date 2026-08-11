/**
 * Die einzigen zwei Farben dieses Moduls ohne exakt passenden Tailwind-Token (siehe
 * Global Constraints im Plan) - Einsatz-Streifen/"Flug registrieren" nutzen weiterhin die
 * bestehende brand-Klasse, Erfüllt/Bernstein/Offen weiterhin success/warning/danger. Gleiches
 * Muster wie src/lib/calendar/layer-colors.ts: eine kleine, benannte Konstanten-Datei statt
 * verstreuter Hex-Werte in mehreren Komponenten.
 */
export const FLIGHT_COLORS = {
  uebungStripe: '#c9c9ce',
  chipActiveBg: '#1c1c1e',
} as const;
