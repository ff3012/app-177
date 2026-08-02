'use client';

import { useLayoutEffect, useRef, useState } from 'react';

interface HeightFittedListProps {
  /** Design-Spec §3: untere Grenze, unter die trotz Platzmangel nie gekürzt wird. */
  minVisible: number;
  /** Design-Spec §3: obere Grenze - entspricht der Anzahl, die der Server bereits geliefert hat. */
  maxVisible: number;
  /** Ein bereits fertig gerendertes Element pro Eintrag, in Anzeige-Reihenfolge. */
  children: React.ReactNode[];
}

/**
 * "Menge anpassen, nicht Größe" (Design-Spec §3): zeigt beim ersten Rendern ALLE übergebenen Kinder
 * (bis maxVisible), damit ihre echte Höhe gemessen werden kann, und blendet danach - noch bevor der
 * Browser malt (useLayoutEffect läuft synchron vor dem Paint) - den Überhang aus, der nicht in den
 * verfügbaren Platz passt. Ein ResizeObserver hält das bei Größenänderungen des Containers nach.
 *
 * Bewusste Einschränkung: nach dem ersten Messen werden nur noch die sichtbaren Kinder tatsächlich
 * gerendert (nicht bloß versteckt), damit inaktive Einträge nicht unnötig im DOM bleiben. Das bedeutet,
 * ein SPÄTERES Vergrößern des Containers kann nicht mehr Einträge aufdecken, als beim letzten Messen
 * sichtbar waren, ohne die zuvor ausgeblendeten neu zu messen. Für einen Kiosk-Screen, der nicht live in
 * der Fenstergröße verändert wird (Auflösung ändert sich nur zwischen den harten 5-Minuten-Reloads, siehe
 * Design-Spec §8), ist das kein praktisches Problem - ein Reload rendert wieder alle Kinder neu.
 */
export function HeightFittedList({ minVisible, maxVisible, children }: HeightFittedListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const total = Math.min(children.length, maxVisible);
  const [visibleCount, setVisibleCount] = useState(total);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function measure() {
      if (!container) return;
      const available = container.clientHeight;
      const items = Array.from(container.children) as HTMLElement[];
      let cumulative = 0;
      let fitCount = 0;
      for (const item of items) {
        cumulative += item.offsetHeight;
        if (cumulative > available) break;
        fitCount++;
      }
      setVisibleCount((prev) => {
        const clamped = Math.max(Math.min(minVisible, total), Math.min(fitCount, total));
        return prev === clamped ? prev : clamped;
      });
    }

    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [minVisible, total]);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-hidden">
      {children.slice(0, visibleCount)}
    </div>
  );
}
