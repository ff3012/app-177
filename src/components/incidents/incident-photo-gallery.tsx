'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeToUploadQueue, retryUpload, type QueuedUpload } from '@/lib/upload-queue/queue';
import { deleteIncidentPhoto, setIncidentPhotoPublicRelease } from '@/app/(app)/meine-feuerwehr/einsaetze/actions';

interface PhotoData {
  id: string;
  uploadedById: string;
  uploadedByName: string;
  takenAt: string | null;
  byteSize: number;
  originalName: string;
  publicRelease: boolean;
}

interface IncidentPhotoGalleryProps {
  incidentId: string;
  photos: PhotoData[];
  currentUserId: string;
  canManage: boolean;
  // Echt admin-beschränkt (Bezirksadmin ODER ADMIN-Membership dieser Feuerwehr) - anders als canManage
  // oben, das laut Task 1 bewusst "jedes Mitglied darf" bedeutet (canManageIncidentsFor ===
  // canViewIncidentsFor) und daher NICHT als Gate für die Foto-Lösch-Berechtigung taugt.
  // canDeleteIncidentPhoto erlaubt nur den Uploader selbst oder einen echten Feuerwehr-Admin.
  isFeuerwehrAdmin: boolean;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatBytes(byteSize: number): string {
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

export function IncidentPhotoGallery({
  incidentId,
  photos,
  currentUserId,
  canManage,
  isFeuerwehrAdmin,
}: IncidentPhotoGalleryProps) {
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [selected, setSelected] = useState<PhotoData | null>(null);
  const router = useRouter();
  // Merkt sich, welche Warteschlangen-Einträge bereits als 'done' gesehen wurden, damit
  // router.refresh() für einen frisch fertiggestellten Upload genau einmal aufgerufen wird (nicht bei
  // jedem weiteren Queue-Update, z. B. Fortschritts-Ticks anderer noch laufender Uploads).
  const seenDoneIds = useRef(new Set<string>());

  useEffect(
    () =>
      subscribeToUploadQueue(incidentId, (uploads) => {
        setQueue(uploads);
        const newlyDone = uploads.filter((entry) => entry.status === 'done' && !seenDoneIds.current.has(entry.id));
        if (newlyDone.length > 0) {
          for (const entry of newlyDone) seenDoneIds.current.add(entry.id);
          // Ein fertiger Upload erreicht 'done' erst NACHDEM sein complete-Aufruf den Foto-Status auf
          // READY gesetzt hat (siehe queue.ts's uploadOne) - erst dann taucht das Foto überhaupt in der
          // vom Server geladenen photos-Liste auf, die diese Komponente sonst nie von sich aus neu lädt.
          router.refresh();
        }
      }),
    [incidentId, router],
  );

  const inProgress = queue.filter((entry) => entry.status !== 'done');
  const totalBytes = inProgress.reduce((sum, entry) => sum + entry.byteSize, 0);
  const uploadedBytes = inProgress.reduce((sum, entry) => sum + entry.uploadedBytes, 0);
  const doneCount = queue.filter((entry) => entry.status === 'done').length;

  return (
    <div className="flex flex-col gap-3">
      {inProgress.length > 0 && (
        <div className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700">
          {doneCount} von {queue.length} Fotos übertragen · {(uploadedBytes / (1024 * 1024)).toFixed(1)} MB von{' '}
          {(totalBytes / (1024 * 1024)).toFixed(1)} MB
          {inProgress.some((entry) => entry.status === 'failed') && (
            <ul className="mt-2 flex flex-col gap-1">
              {inProgress
                .filter((entry) => entry.status === 'failed')
                .map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{entry.fileName}: {entry.error}</span>
                    <button type="button" onClick={() => retryUpload(entry.id)} className="text-brand hover:underline">
                      Erneut versuchen
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setSelected(photo)}
            className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Bild kommt aus einer eigenen,
               session-geschützten Route mit 307-Redirect auf eine kurzlebige presigned URL, kein
               statischer Pfad, den next/image sinnvoll optimieren könnte. */}
            <img
              src={`/api/incidents/${incidentId}/photos/${photo.id}?variant=thumbnail`}
              alt=""
              className="h-full w-full object-cover"
            />
            <span
              className={`absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white ${
                photo.uploadedById === currentUserId ? 'bg-brand' : 'bg-neutral-500'
              }`}
            >
              {initials(photo.uploadedByName)}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4" onClick={() => setSelected(null)}>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- siehe Kommentar oben */}
            <img
              src={`/api/incidents/${incidentId}/photos/${selected.id}?variant=view`}
              alt=""
              className="max-h-[50vh] w-full rounded-lg object-contain"
            />
            <p className="text-sm text-neutral-700">Hochgeladen von {selected.uploadedByName}</p>
            {selected.takenAt && <p className="text-sm text-neutral-500">Aufgenommen am {new Date(selected.takenAt).toLocaleString('de-AT')}</p>}
            <p className="text-sm text-neutral-500">{formatBytes(selected.byteSize)}</p>
            <a
              href={`/api/incidents/${incidentId}/photos/${selected.id}?variant=original`}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-center text-sm font-medium text-neutral-900"
            >
              Original herunterladen
            </a>
            {selected.uploadedById === currentUserId && (
              <label className="flex items-center justify-between gap-3 text-sm text-neutral-900">
                Für Öffentlichkeitsarbeit freigeben
                <input
                  type="checkbox"
                  defaultChecked={selected.publicRelease}
                  onChange={(e) => setIncidentPhotoPublicRelease(selected.id, incidentId, e.target.checked)}
                  className="h-5 w-5"
                />
              </label>
            )}
            {(selected.uploadedById === currentUserId || isFeuerwehrAdmin) && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm('Foto wirklich löschen?')) return;
                  void deleteIncidentPhoto(selected.id, incidentId).then(() => setSelected(null));
                }}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
              >
                Löschen
              </button>
            )}
            <button type="button" onClick={() => setSelected(null)} className="text-sm text-neutral-500">
              Schließen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
