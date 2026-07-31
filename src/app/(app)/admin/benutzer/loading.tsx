import { Skeleton } from '@/components/ui/skeleton';

/** Verwaltung-Brief.md 3.4: sechs Skeleton-Zeilen in Tabellenform, kein Spinner. Next.js zeigt
 * diese Datei automatisch als Suspense-Fallback, solange page.tsx's Server Component lädt - sowohl
 * beim ersten Seitenaufruf als auch bei einem router.refresh() nach einer Mehrfachauswahl-Aktion. */
export default function BenutzerLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex gap-2.5">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>

      <div className="flex gap-2.5">
        <Skeleton className="h-8 w-full max-w-[320px]" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
      </div>

      <div className="hidden overflow-hidden rounded-lg bg-surface shadow-card sm:block">
        <div className="flex items-center gap-4 border-b-2 border-line-strong px-3 py-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-14" />
        </div>
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex h-[52px] items-center gap-4 border-b border-line px-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
