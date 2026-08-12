'use client';

import { usePathname } from 'next/navigation';

/**
 * Benutzerverwaltung-Breite-Brief.md §1: /admin/** braucht ab md: die volle Fensterbreite statt des
 * app-weiten max-w-5xl-Lesecontainers (der Rest der App - Kalender, Meine Feuerwehr - behält ihn
 * unverändert). (app)/layout.tsx rendert <main> nur einmal für jede Route, kennt den aktuellen Pfad
 * als Server Component aber nicht - usePathname() braucht dafür eine Client-Komponente, ähnlich wie
 * Nav/GeltungsbereichSelector das bereits an anderer Stelle lösen. Unterhalb von md: bleibt das
 * Padding unverändert (Mobile-Admin nutzt ohnehin AdminMobileTabs/Kartenlisten statt der breiten
 * Sidebar-Ansicht und ist nicht Teil dieses Briefs) - admin/layout.tsx ergänzt sein eigenes
 * md:px-7 md:py-6 genau dort, wo <main> hier aufhört, welches zu liefern.
 */
export function MainContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');

  return (
    <main
      className={
        isAdmin
          ? 'pb-content-safe w-full flex-1 px-5 pt-6 sm:px-4 sm:pb-6 md:max-w-none md:px-0 md:py-0'
          : 'pb-content-safe mx-auto w-full max-w-5xl flex-1 px-5 pt-6 sm:px-4 sm:pb-6'
      }
    >
      {children}
    </main>
  );
}
