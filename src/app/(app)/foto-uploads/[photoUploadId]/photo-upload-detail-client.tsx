'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhotoUploadSheet } from '@/components/photo-uploads/photo-upload-sheet';
import { PhotoGallery } from '@/components/photo-uploads/photo-gallery';

interface PhotoUploadDetailClientProps {
  photoUploadId: string;
  currentUserId: string;
  isFeuerwehrAdmin: boolean;
  photos: {
    id: string;
    uploadedById: string;
    uploadedByName: string;
    takenAt: string | null;
    byteSize: number;
    originalName: string;
  }[];
}

export function PhotoUploadDetailClient({ photoUploadId, currentUserId, isFeuerwehrAdmin, photos }: PhotoUploadDetailClientProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">Fotos {photos.length}</h2>
        <button type="button" onClick={() => setSheetOpen(true)} className="text-sm font-medium text-brand">
          + Hinzufügen
        </button>
      </div>

      <PhotoGallery photoUploadId={photoUploadId} photos={photos} currentUserId={currentUserId} isFeuerwehrAdmin={isFeuerwehrAdmin} />

      <PhotoUploadSheet
        photoUploadId={photoUploadId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onUploaded={() => {
          router.refresh();
          setSheetOpen(false);
        }}
      />
    </div>
  );
}
