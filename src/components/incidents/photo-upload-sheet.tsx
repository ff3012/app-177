'use client';

import { useRef, useState, type RefObject } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { enqueuePhotos } from '@/lib/upload-queue/queue';
import { MAX_INCIDENT_PHOTOS_PER_BATCH } from '@/lib/validation/incident-photo';

interface PhotoUploadSheetProps {
  incidentId: string;
  open: boolean;
  onClose: () => void;
  onQueued: () => void;
}

export function PhotoUploadSheet({ incidentId, open, onClose, onQueued }: PhotoUploadSheetProps) {
  const [wifiOnly, setWifiOnly] = useState(true);
  const [publicRelease, setPublicRelease] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  // HTMLInputElement.files is never null for a type="file" input (an untouched input has an empty
  // FileList, not null), so a `??` fallback chain across the three refs always resolves to the first
  // one regardless of which was actually used. Instead, whenever one input gains a selection, clear the
  // other two so at most one ever holds files at a time - submit() then just picks whichever is non-empty.
  function handleFiles(fileList: FileList | null, sourceRef: RefObject<HTMLInputElement | null>) {
    if (!fileList || fileList.length === 0) return;
    for (const ref of [cameraInputRef, libraryInputRef, filesInputRef]) {
      if (ref !== sourceRef && ref.current) ref.current.value = '';
    }
    setError(undefined);
    setSelectedCount(Math.min(fileList.length, MAX_INCIDENT_PHOTOS_PER_BATCH));
  }

  async function submit() {
    const fileList = [cameraInputRef, libraryInputRef, filesInputRef]
      .map((ref) => ref.current?.files)
      .find((files) => files && files.length > 0);
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, MAX_INCIDENT_PHOTOS_PER_BATCH);
    try {
      await enqueuePhotos(incidentId, files, { publicRelease, wifiOnly });
      onQueued();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotos konnten nicht zur Warteschlange hinzugefügt werden.');
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Fotos hinzufügen">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900"
          >
            Foto aufnehmen
          </button>
          <button
            type="button"
            onClick={() => libraryInputRef.current?.click()}
            className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900"
          >
            Aus der Fotobibliothek
          </button>
          <button
            type="button"
            onClick={() => filesInputRef.current?.click()}
            className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900"
          >
            Aus Dateien
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files, cameraInputRef)}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files, libraryInputRef)}
        />
        <input
          ref={filesInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files, filesInputRef)}
        />

        <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-neutral-900">
          <span>
            Nur über WLAN übertragen
            <span className="block text-xs text-neutral-500">Originale sind 4-12 MB groß</span>
          </span>
          <input type="checkbox" checked={wifiOnly} onChange={(e) => setWifiOnly(e.target.checked)} className="h-5 w-5" />
        </label>

        <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-neutral-900">
          <span>Für Öffentlichkeitsarbeit freigeben</span>
          <input type="checkbox" checked={publicRelease} onChange={(e) => setPublicRelease(e.target.checked)} className="h-5 w-5" />
        </label>

        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Fotos werden unverändert gespeichert - samt Aufnahmezeit und, falls im Bild vorhanden, Standortdaten. Bei Personen und
          Kennzeichen gilt die Datenschutzregelung der Wehr.
        </p>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          type="button"
          disabled={selectedCount === 0}
          onClick={() => submit()}
          className="min-h-[52px] rounded-lg bg-brand font-medium text-white disabled:opacity-40"
        >
          {selectedCount > 0 ? `${selectedCount} Fotos übertragen` : 'Fotos auswählen'}
        </button>
      </div>
    </BottomSheet>
  );
}
