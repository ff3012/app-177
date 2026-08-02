/** Kleines Auto-Symbol, das einen automatisch aus einer Fahrzeug-Buchung erzeugten Kalender-
 * Termin kennzeichnet (siehe meine-feuerwehr/actions.ts, Event.vehicleBookingId). Handgerolltes
 * Inline-SVG statt einer Icon-Bibliothek, passend zur bestehenden Konvention dieser Codebase.
 * Von calendar-view.tsx (FullCalendar-Monatsraster-Chip) UND event-list-view.tsx (Zeile + mobile
 * Karte) genutzt, damit alle drei Darstellungen nicht auseinanderlaufen. */
export function VehicleBookingIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-label="Fahrzeug-Buchung"
    >
      <path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="2" y="13" width="20" height="5" rx="1" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="18" r="1.5" />
      <circle cx="17" cy="18" r="1.5" />
    </svg>
  );
}
