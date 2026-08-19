'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Erzwingt einen frischen Server-Render der aktuellen Route samt übergeordnetem (app)-Layout nach
 * dem Mounten. Ohne das bleibt die Glocken-Badge im Header nach dem Besuch dieser Seite clientseitig
 * im Next.js-Router-Cache stehen: der NewsRead-Schreibvorgang in page.tsx läuft während des Renderns,
 * nicht in einer Server Action/einem Route Handler, wo revalidatePath() erlaubt wäre (siehe den
 * Kommentar dort und in vehicle-booking-decision.ts, wo dieselbe Next.js-Einschränkung greift) - für
 * eine per Server-Action ausgelöste Navigation zählt das nicht, aber der übliche Weg hierher ist ein
 * ganz normaler <Link>-Klick aus /news oder der Startbildschirm-Karte heraus. */
export function RefreshAfterMarkRead() {
  const router = useRouter();

  useEffect(() => {
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
