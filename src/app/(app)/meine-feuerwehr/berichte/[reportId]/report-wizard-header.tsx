'use client';

import Link from 'next/link';

/** Kopfzeile für alle drei Formular-Schritte (Bericht-Brief.md §5): "‹ Zurück"/"‹ Abbrechen" +
 * dreiteiliger Fortschrittsbalken + "Schritt n von 3". `backHref` ist Schritt 1 -> zurück zur
 * Startseite ("Abbrechen"), Schritt 2/3 -> zurück zum vorherigen Schritt ("Zurück"). */
export function ReportWizardHeader({ step, backHref, backLabel }: { step: 1 | 2 | 3; backHref: string; backLabel: string }) {
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link href={backHref} className="text-sm font-medium text-brand">
          ‹ {backLabel}
        </Link>
        <span className="text-xs font-medium text-neutral-500">Schritt {step} von 3</span>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3].map((n) => (
          <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-brand' : 'bg-neutral-200'}`} />
        ))}
      </div>
    </div>
  );
}
