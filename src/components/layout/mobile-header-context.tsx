'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface MobileHeaderState {
  title: string | null;
  titleProgress: number;
  actionSlot: ReactNode | null;
  setTitle: (title: string | null, progress: number) => void;
  setActionSlot: (node: ReactNode | null) => void;
}

const MobileHeaderContext = createContext<MobileHeaderState | null>(null);

/**
 * Wraps the whole (app) layout (header + main) so a page deep inside <main> - e.g. Kalender's
 * CollapsingPageTitle or its mobile filter button - can push content into the shared mobile header
 * (single row, <640px) without the header component needing to know about individual pages. Chosen
 * over a DOM portal because both consumers need reactive VALUES (a 0-1 scroll progress, not just
 * static JSX), which a portal alone can't share across the header/main sibling boundary.
 */
export function MobileHeaderProvider({ children }: { children: ReactNode }) {
  const [title, setTitleState] = useState<string | null>(null);
  const [titleProgress, setTitleProgress] = useState(0);
  const [actionSlot, setActionSlot] = useState<ReactNode | null>(null);

  const value = useMemo<MobileHeaderState>(
    () => ({
      title,
      titleProgress,
      actionSlot,
      setTitle: (nextTitle, progress) => {
        setTitleState(nextTitle);
        setTitleProgress(progress);
      },
      setActionSlot,
    }),
    [title, titleProgress, actionSlot],
  );

  return <MobileHeaderContext.Provider value={value}>{children}</MobileHeaderContext.Provider>;
}

/** Safe no-op fallback so pages outside (app)/layout.tsx (e.g. (auth)/*) never need their own guard. */
const NOOP_STATE: MobileHeaderState = {
  title: null,
  titleProgress: 0,
  actionSlot: null,
  setTitle: () => {},
  setActionSlot: () => {},
};

export function useMobileHeader(): MobileHeaderState {
  return useContext(MobileHeaderContext) ?? NOOP_STATE;
}
