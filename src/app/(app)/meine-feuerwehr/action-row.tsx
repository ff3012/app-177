'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ReportTypeSheet } from './berichte/report-type-sheet';

/** Bericht-Brief.md §4: Aktionsreihe ersetzt den bisherigen einzelnen Foto-Upload-Button - zwei gleich
 * große Kacheln im 1:1-Grid, min. 96px hoch. "Neuer Bericht" öffnet zuerst das Berichtsart-Sheet
 * (Task 3), "Foto Upload" ist unverändert derselbe Link/dieselbe Berechtigung wie zuvor. */
export function ActionRow({ showPhotoUpload }: { showPhotoUpload: boolean }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <div className={showPhotoUpload ? 'grid grid-cols-2 gap-2.5' : 'grid grid-cols-1 gap-2.5'}>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-brand bg-white text-[15px] font-semibold text-brand shadow-sm"
        >
          Neuer Bericht
        </button>
        {showPhotoUpload && (
          <Link
            href="/foto-uploads/neu"
            className="flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-xl bg-white text-[15px] font-semibold text-[#1c1c1e] shadow-sm"
          >
            Foto Upload
          </Link>
        )}
      </div>
      {sheetOpen && <ReportTypeSheet onClose={() => setSheetOpen(false)} />}
    </>
  );
}
