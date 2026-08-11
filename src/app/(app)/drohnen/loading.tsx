import { Skeleton } from '@/components/ui/skeleton';

/** Sechs Skeleton-Zeilen in Listenform, kein Spinner - gleiches Muster wie
 * admin/benutzer/loading.tsx, hier auf das Flugbuch-Layout (Kopfbereich + Sidebar + Liste)
 * angepasst. */
export default function DrohnenLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex flex-col gap-3.5 lg:w-[250px] lg:shrink-0">
          <Skeleton className="h-[160px] w-full rounded-lg" />
          <Skeleton className="h-[280px] w-full rounded-lg" />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[64px] w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
