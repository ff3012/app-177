import type { ReactNode } from 'react';

/**
 * Fester Rahmen um den Berichts-Assistenten der Schnellerfassung. Er ist in beiden Layouts dasselbe
 * Element an derselben Stelle im React-Baum; nur die Klassen wechseln. So bleibt der Assistent beim
 * Wechsel über die 1024-px-Schwelle (iPad drehen, Split View) eingehängt und verliert keine Eingaben.
 */
export function WizardFrame({ layout, children }: { layout: 'mobile' | 'tablet'; children: ReactNode }) {
  return (
    <div className={layout === 'tablet' ? 'touch-manipulation' : 'pt-safe mx-auto max-w-lg touch-manipulation px-4 py-4'}>
      {children}
    </div>
  );
}
