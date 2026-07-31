'use client';

import type { ReactNode } from 'react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/** Generic mobile bottom sheet - first use in this codebase (Mobile-Brief.md), reusable for future
 * per-page filter/settings panels beyond Kalender. z-50: same level as the event-detail modal in
 * calendar-view.tsx - both are mutually exclusive blocking overlays, never shown together. */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/30" onClick={onClose}>
      <div
        className="sheet-slide-up max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white pb-safe-tabbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center pb-1 pt-2">
          <span className="h-1 w-10 rounded-full bg-neutral-300" aria-hidden />
        </div>
        <div className="flex items-center justify-between px-5 pb-3 pt-1">
          <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-brand">
            Fertig
          </button>
        </div>
        <div className="px-5 pb-6">{children}</div>
      </div>
    </div>
  );
}
