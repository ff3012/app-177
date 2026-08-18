'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhotoUploadSheet } from '@/components/incidents/photo-upload-sheet';
import { IncidentPhotoGallery } from '@/components/incidents/incident-photo-gallery';

interface IncidentDetailClientProps {
  incidentId: string;
  canManage: boolean;
  // Separat von canManage: canManage ist laut Task 1 bewusst "jedes Mitglied darf" (siehe
  // canManageIncidentsFor), taugt also nicht als Gate für die Foto-Lösch-Berechtigung in der Galerie,
  // die echt admin-beschränkt sein muss (canDeleteIncidentPhoto: Uploader ODER Feuerwehr-Admin).
  isFeuerwehrAdmin: boolean;
  currentUserId: string;
  photos: {
    id: string;
    uploadedById: string;
    uploadedByName: string;
    takenAt: string | null;
    byteSize: number;
    originalName: string;
    publicRelease: boolean;
  }[];
}

export function IncidentDetailClient({
  incidentId,
  canManage,
  isFeuerwehrAdmin,
  currentUserId,
  photos,
}: IncidentDetailClientProps) {
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

      <IncidentPhotoGallery
        incidentId={incidentId}
        photos={photos}
        currentUserId={currentUserId}
        canManage={canManage}
        isFeuerwehrAdmin={isFeuerwehrAdmin}
      />

      <PhotoUploadSheet
        incidentId={incidentId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onQueued={() => router.refresh()}
      />
    </div>
  );
}
