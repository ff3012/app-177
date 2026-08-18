'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PhotoUploadSheet } from './photo-upload-sheet';
import { PHOTO_UPLOAD_KIND_LABELS } from '@/lib/validation/photo-upload.schema';
import type { PhotoUploadKind } from '@prisma/client';

interface RecentPhotoUpload {
  id: string;
  kind: PhotoUploadKind;
  description: string;
  createdAt: string;
  createdByName: string;
  photoIds: string[];
  totalPhotoCount: number;
}

export function RecentPhotoUploadsBlock({ photoUploads }: { photoUploads: RecentPhotoUpload[] }) {
  const [sheetPhotoUploadId, setSheetPhotoUploadId] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e93]">Foto Uploads (letzte 24 Stunden)</span>
      {photoUploads.map((photoUpload) => (
        <div key={photoUpload.id} className="flex flex-col gap-2 rounded-xl bg-white p-4 shadow-sm">
          <Link href={`/foto-uploads/${photoUpload.id}`} className="min-w-0">
            <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
              {PHOTO_UPLOAD_KIND_LABELS[photoUpload.kind]}
            </span>
            <div className="mt-1 truncate text-[15px] font-semibold text-[#1c1c1e]">{photoUpload.description}</div>
            <div className="text-[13px] text-[#6c6c70]">
              {new Date(photoUpload.createdAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} · Angelegt von{' '}
              {photoUpload.createdByName}
            </div>
          </Link>

          {photoUpload.photoIds.length === 0 ? (
            <p className="text-sm text-neutral-500">Noch keine Fotos vorhanden.</p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {photoUpload.photoIds.map((photoId, index) => {
                const isLast = index === photoUpload.photoIds.length - 1;
                const remaining = photoUpload.totalPhotoCount - photoUpload.photoIds.length;
                return (
                  <Link key={photoId} href={`/foto-uploads/${photoUpload.id}`} className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200">
                    {/* eslint-disable-next-line @next/next/no-img-element -- siehe photo-gallery.tsx */}
                    <img src={`/api/photo-uploads/${photoUpload.id}/photos/${photoId}?variant=thumbnail`} alt="" className="h-full w-full object-cover" />
                    {isLast && remaining > 0 && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-white">+{remaining}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          <button type="button" onClick={() => setSheetPhotoUploadId(photoUpload.id)} className="self-start text-sm font-medium text-brand">
            Fotos hinzufügen
          </button>
        </div>
      ))}

      {sheetPhotoUploadId && (
        <PhotoUploadSheet
          photoUploadId={sheetPhotoUploadId}
          open={sheetPhotoUploadId !== null}
          onClose={() => setSheetPhotoUploadId(null)}
          onUploaded={() => {
            router.refresh();
            setSheetPhotoUploadId(null);
          }}
        />
      )}
    </div>
  );
}
