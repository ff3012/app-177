'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PhotoUploadSheet } from './photo-upload-sheet';
import { subscribeToUploadQueue, retryUpload, removeUpload, type QueuedUpload } from '@/lib/upload-queue/queue';
import { INCIDENT_KIND_LABELS } from '@/lib/validation/incident.schema';
import type { IncidentKind } from '@prisma/client';

// Findet I2 (Final-Review): siehe gleichnamige Konstante in incident-photo-gallery.tsx.
const DONE_ENTRY_CLEANUP_DELAY_MS = 1500;

interface RecentIncident {
  id: string;
  kind: IncidentKind;
  keyword: string;
  location: string;
  alarmedAt: string;
  photoIds: string[];
  totalPhotoCount: number;
}

/** Findet I3 (Final-Review): rendert dieselbe Byte-Fortschritts-Zeile wie
 * IncidentPhotoGallery's Banner, nur kompakter für die Karte auf dem Startbildschirm - kein
 * Anspruch, das Banner pixelgenau zu duplizieren, nur dieselbe Information (N von M Fotos,
 * MB-Fortschritt, Grund bei failed/paused) an dieser zweiten Stelle sichtbar zu machen. */
function UploadStatusLine({ queue }: { queue: QueuedUpload[] }) {
  const inProgress = queue.filter((entry) => entry.status !== 'done');
  if (inProgress.length === 0) return null;

  const totalBytes = inProgress.reduce((sum, entry) => sum + entry.byteSize, 0);
  const uploadedBytes = inProgress.reduce((sum, entry) => sum + entry.uploadedBytes, 0);
  const doneCount = queue.filter((entry) => entry.status === 'done').length;
  const problemEntries = inProgress.filter((entry) => entry.status === 'failed' || entry.status === 'paused');

  return (
    <div className="rounded-lg bg-neutral-50 p-2.5 text-xs text-neutral-700">
      {doneCount} von {queue.length} Fotos übertragen · {(uploadedBytes / (1024 * 1024)).toFixed(1)} MB von{' '}
      {(totalBytes / (1024 * 1024)).toFixed(1)} MB
      {problemEntries.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {problemEntries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{entry.fileName}: {entry.error}</span>
              <button type="button" onClick={() => retryUpload(entry.id)} className="text-brand hover:underline">
                {entry.status === 'paused' ? 'Fortsetzen' : 'Erneut versuchen'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RecentIncidentsBlock({ incidents }: { incidents: RecentIncident[] }) {
  const [sheetIncidentId, setSheetIncidentId] = useState<string | null>(null);
  const [queues, setQueues] = useState<Record<string, QueuedUpload[]>>({});
  const router = useRouter();
  // Findet I3 (Final-Review): wie IncidentPhotoGallery's eigener seenDoneIds-Ref, damit
  // router.refresh() für einen frisch fertiggestellten Upload genau einmal aufgerufen wird.
  const seenDoneIds = useRef(new Set<string>());
  const incidentIds = incidents.map((incident) => incident.id).join(',');

  useEffect(() => {
    const ids = incidentIds ? incidentIds.split(',') : [];
    const unsubscribes = ids.map((incidentId) =>
      subscribeToUploadQueue(incidentId, (uploads) => {
        setQueues((prev) => ({ ...prev, [incidentId]: uploads }));
        const newlyDone = uploads.filter((entry) => entry.status === 'done' && !seenDoneIds.current.has(entry.id));
        if (newlyDone.length > 0) {
          for (const entry of newlyDone) seenDoneIds.current.add(entry.id);
          // Findet I3 (Final-Review): onQueued schloss bisher nur das Sheet, ohne die Seite je neu zu
          // laden - neu hochgeladene Fotos erschienen deshalb nie in dieser Karte, bis der Nutzer manuell
          // wegnavigierte und zurückkehrte. Gleicher Mechanismus wie in IncidentPhotoGallery.
          router.refresh();
          for (const entry of newlyDone) {
            setTimeout(() => void removeUpload(entry.id), DONE_ENTRY_CLEANUP_DELAY_MS);
          }
        }
      }),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [incidentIds, router]);

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Einsätze (letzte 24 Stunden)</span>
      {incidents.map((incident) => (
        <div key={incident.id} className="flex flex-col gap-2 rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <Link href={`/meine-feuerwehr/einsaetze/${incident.id}`} className="min-w-0">
              <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                {INCIDENT_KIND_LABELS[incident.kind]}
              </span>
              <div className="mt-1 truncate text-[15px] font-semibold text-[#1c1c1e]">{incident.keyword}</div>
              <div className="text-[13px] text-[#6c6c70]">
                {new Date(incident.alarmedAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} · {incident.location}
              </div>
            </Link>
          </div>

          {incident.photoIds.length === 0 ? (
            <p className="text-sm text-neutral-500">Noch keine Fotos vorhanden.</p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {incident.photoIds.map((photoId, index) => {
                const isLast = index === incident.photoIds.length - 1;
                const remaining = incident.totalPhotoCount - incident.photoIds.length;
                return (
                  <Link
                    key={photoId}
                    href={`/meine-feuerwehr/einsaetze/${incident.id}`}
                    className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- siehe incident-photo-gallery.tsx */}
                    <img
                      src={`/api/incidents/${incident.id}/photos/${photoId}?variant=thumbnail`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    {isLast && remaining > 0 && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-white">
                        +{remaining}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          <UploadStatusLine queue={queues[incident.id] ?? []} />

          <button
            type="button"
            onClick={() => setSheetIncidentId(incident.id)}
            className="self-start text-sm font-medium text-brand"
          >
            Fotos hinzufügen
          </button>
        </div>
      ))}

      {sheetIncidentId && (
        <PhotoUploadSheet
          incidentId={sheetIncidentId}
          open={sheetIncidentId !== null}
          onClose={() => setSheetIncidentId(null)}
          onQueued={() => setSheetIncidentId(null)}
        />
      )}
    </div>
  );
}
