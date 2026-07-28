interface AddToCalendarLinkProps {
  eventId: string;
  variant?: 'icon' | 'text';
}

/**
 * Verlinkt auf die Einzeltermin-.ics-Route statt clientseitig zu generieren: ein echter
 * Datei-Download mit korrektem Content-Type ist über Browser hinweg (v.a. iOS Safari) deutlich
 * zuverlässiger als eine data:-URI, wenn man am Mobilgerät den "Zum Kalender hinzufügen"-Dialog
 * auslösen möchte.
 */
export function AddToCalendarLink({ eventId, variant = 'text' }: AddToCalendarLinkProps) {
  if (variant === 'icon') {
    return (
      <a
        href={`/kalender/${eventId}/ics`}
        aria-label="Zu meinem Kalender hinzufügen"
        title="Zu meinem Kalender hinzufügen"
        className="inline-flex shrink-0 rounded border border-neutral-300 bg-white p-1.5 text-neutral-600 hover:bg-neutral-100"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M3 10h18M8 2v4M16 2v4" strokeLinecap="round" />
          <path d="M12 13v6M9 16h6" strokeLinecap="round" />
        </svg>
      </a>
    );
  }

  return (
    <a href={`/kalender/${eventId}/ics`} className="text-sm font-medium text-brand hover:underline">
      Zu meinem Kalender hinzufügen
    </a>
  );
}
