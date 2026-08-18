'use client';

import { useState } from 'react';
import { deletePhoto } from '@/app/(app)/foto-uploads/actions';

interface PhotoData {
  id: string;
  uploadedById: string;
  uploadedByName: string;
  takenAt: string | null;
  byteSize: number;
  originalName: string;
}

interface PhotoGalleryProps {
  photoUploadId: string;
  photos: PhotoData[];
  currentUserId: string;
  isFeuerwehrAdmin: boolean;
}

function initials(name: string): string {
  return name.split(' ').map((part) => part[0]).join('').toUpperCase().slice(0, 2);
}

function formatBytes(byteSize: number): string {
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

export function PhotoGallery({ photoUploadId, photos, currentUserId, isFeuerwehrAdmin }: PhotoGalleryProps) {
  const [selected, setSelected] = useState<PhotoData | null>(null);
  const [actionError, setActionError] = useState<string | undefined>();

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-1.5">
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => {
              setActionError(undefined);
              setSelected(photo);
            }}
            className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Bild kommt aus einer eigenen,
               session-geschützten Route mit 307-Redirect auf eine kurzlebige presigned URL. */}
            <img src={`/api/photo-uploads/${photoUploadId}/photos/${photo.id}?variant=thumbnail`} alt="" className="h-full w-full object-cover" />
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
            <img src={`/api/photo-uploads/${photoUploadId}/photos/${selected.id}?variant=view`} alt="" className="max-h-[50vh] w-full rounded-lg object-contain" />
            <p className="text-sm text-neutral-700">Hochgeladen von {selected.uploadedByName}</p>
            {selected.takenAt && <p className="text-sm text-neutral-500">Aufgenommen am {new Date(selected.takenAt).toLocaleString('de-AT')}</p>}
            <p className="text-sm text-neutral-500">{formatBytes(selected.byteSize)}</p>
            <a href={`/api/photo-uploads/${photoUploadId}/photos/${selected.id}?variant=original`} className="rounded-lg border border-neutral-300 px-4 py-2 text-center text-sm font-medium text-neutral-900">
              Original herunterladen
            </a>
            {(selected.uploadedById === currentUserId || isFeuerwehrAdmin) && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm('Foto wirklich löschen?')) return;
                  deletePhoto(selected.id, photoUploadId)
                    .then(() => setSelected(null))
                    .catch((error) => setActionError(error instanceof Error ? error.message : 'Löschen fehlgeschlagen.'));
                }}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
              >
                Löschen
              </button>
            )}
            {actionError && <p className="text-sm text-red-700">{actionError}</p>}
            <button type="button" onClick={() => setSelected(null)} className="text-sm text-neutral-500">
              Schließen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
