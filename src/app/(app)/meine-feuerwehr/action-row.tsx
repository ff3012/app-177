'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ReportTypeSheet } from './berichte/report-type-sheet';

/** Bericht-Brief.md §4: "Neuer Bericht" öffnet zuerst das Berichtsart-Sheet (Task 3), "Foto Upload"
 * ist unverändert derselbe Link/dieselbe Berechtigung wie zuvor. Rendert seit der Aktionen-Neuordnung
 * (siehe page.tsx) KEIN eigenes Grid mehr - beide Kacheln sind stattdessen zwei von vier Kindern des
 * gemeinsamen 2x2-Aktionsrasters, das die Seite selbst aufspannt (Fahrzeug reservieren/Flug
 * registrieren teilen sich dasselbe Grid). Fehlt `showPhotoUpload`, bleibt die zweite Rasterzelle
 * dieser Zeile als unsichtbarer Platzhalter erhalten (nicht einfach weggelassen), damit die
 * Zeilenpaarung der übrigen Kacheln nicht verrutscht - exakt dasselbe Muster wie MobileTabBar's leere
 * `aria-hidden`-Zelle. */
export function ActionRow({ showPhotoUpload }: { showPhotoUpload: boolean }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-brand bg-white text-[15px] font-semibold text-brand shadow-sm"
      >
        Neuer Bericht
      </button>
      {showPhotoUpload ? (
        <Link
          href="/foto-uploads/neu"
          className="flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-xl bg-white text-[15px] font-semibold text-[#1c1c1e] shadow-sm"
        >
          Foto Upload
        </Link>
      ) : (
        <div aria-hidden="true" />
      )}
      {sheetOpen && <ReportTypeSheet onClose={() => setSheetOpen(false)} />}
    </>
  );
}
