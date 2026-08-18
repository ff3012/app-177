'use client';

import { useEffect, useRef, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { uploadOnePhoto, type UploadItem } from '@/lib/photo-upload/foreground-upload';
import { MAX_PHOTOS_PER_BATCH } from '@/lib/validation/photo';

interface PhotoUploadSheetProps {
  photoUploadId: string;
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

const MAX_PARALLEL = 3;

export function PhotoUploadSheet({ photoUploadId, open, onClose, onUploaded }: PhotoUploadSheetProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [running, setRunning] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const activeCountRef = useRef(0);
  // Fix Runde 1 (Task-5-Review, Important finding): BottomSheet unmountet nie (nur `if (!open)
  // return null`), d. h. dieser Komponenten-State überlebt Öffnen/Schließen. Ohne generationRef
  // würde ein Schließen währenddessen (handleAttemptClose) die noch laufende processQueue-
  // Polling-Schleife nicht stoppen - sie liefe im Hintergrund weiter, bis ihre eigenen (echten,
  // noch offenen) Netzwerk-Requests von selbst durchlaufen, und `running` bliebe so lange
  // fälschlich `true`, was den Übertragen-Button einer neu ausgewählten Stapel-Auswahl blockiert.
  // generationRef wird bei jedem "verlassenen" Schließen erhöht; jede laufende/neue processQueue-
  // Instanz merkt sich beim Start ihre eigene Generation und bricht ihre Schleife ab bzw. ignoriert
  // ihre eigenen State-Updates, sobald sie nicht mehr der aktuellen Generation entspricht.
  const generationRef = useRef(0);
  // Bricht die tatsächlichen presign-/complete-fetch- und PUT-XHR-Requests der aktuellen
  // Generation ab, damit die Rückfrage-Meldung ("Laufende Übertragungen werden abgebrochen")
  // stimmt, statt Übertragungen im Hintergrund einfach fertiglaufen zu lassen.
  const abortControllerRef = useRef<AbortController | null>(null);

  const anyInFlight = items.some((item) => item.status === 'pending' || item.status === 'uploading');

  // Rückfrage vor Tab-Schließen/Neuladen, solange eine Übertragung läuft (Foto-Upload-Brief.md §5.4:
  // "Verlässt er ihn trotzdem: Rückfrage, dass laufende Übertragungen abgebrochen werden"). Next.js
  // App Router bietet keinen globalen Client-Navigations-Interceptor - diese Absicherung deckt
  // Tab-Ereignisse und den eigenen Schließen-Pfad des Sheets ab (siehe handleAttemptClose unten),
  // nicht jede denkbare In-App-Navigation währenddessen (z. B. ein Klick auf einen anderen
  // Nav-Link) - eine bewusst begrenzte, dokumentierte Plattform-/Framework-Grenze, analog zur
  // iOS-Netzwerk-API-Einschränkung der Vorgängerversion dieser Funktion.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!anyInFlight) return;
      event.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [anyInFlight]);

  function handleFiles(fileList: FileList | null, sourceRef: React.RefObject<HTMLInputElement | null>) {
    if (!fileList || fileList.length === 0) return;
    for (const ref of [cameraInputRef, libraryInputRef, filesInputRef]) {
      if (ref !== sourceRef && ref.current) ref.current.value = '';
    }
    const files = Array.from(fileList).slice(0, MAX_PHOTOS_PER_BATCH);
    setItems(files.map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file, uploadedBytes: 0, status: 'pending' })));
  }

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  // Wie updateItem, aber wird nur innerhalb einer laufenden processQueue-Instanz nach einem
  // `await` verwendet - also genau dort, wo zwischen Auslösen und Ankommen des Updates beliebig
  // viel Zeit vergangen sein kann und das Sheet in der Zwischenzeit "verlassen" worden sein könnte
  // (siehe generationRef oben). Ein Update aus einer inzwischen verlassenen Generation wird
  // stillschweigend verworfen, statt auf einer längst nicht mehr sichtbaren Foto-Liste zu landen.
  function updateItemIfCurrent(generation: number, id: string, patch: Partial<UploadItem>) {
    if (generation !== generationRef.current) return;
    updateItem(id, patch);
  }

  async function runItem(item: UploadItem, generation: number, signal: AbortSignal) {
    updateItemIfCurrent(generation, item.id, { status: 'uploading', error: undefined, uploadedBytes: 0 });
    try {
      await uploadOnePhoto(photoUploadId, item.file, (bytes) => updateItemIfCurrent(generation, item.id, { uploadedBytes: bytes }), signal);
      updateItemIfCurrent(generation, item.id, { status: 'done', uploadedBytes: item.file.size });
    } catch (error) {
      updateItemIfCurrent(generation, item.id, { status: 'failed', error: error instanceof Error ? error.message : 'Unbekannter Fehler.' });
    }
  }

  async function processQueue(currentItems: UploadItem[]) {
    const myGeneration = generationRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setRunning(true);
    let pool = currentItems;
    while (true) {
      if (generationRef.current !== myGeneration) return; // Sheet wurde währenddessen verlassen - Schleife stillschweigend beenden.
      const pending = pool.filter((item) => item.status === 'pending');
      if (pending.length === 0 && activeCountRef.current === 0) break;
      for (const item of pending) {
        if (activeCountRef.current >= MAX_PARALLEL) break;
        activeCountRef.current += 1;
        void runItem(item, myGeneration, controller.signal).finally(() => {
          activeCountRef.current -= 1;
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      pool = await new Promise<UploadItem[]>((resolve) => setItems((latest) => (resolve(latest), latest)));
    }
    if (generationRef.current !== myGeneration) return;
    setRunning(false);
    onUploaded();
  }

  function startUpload() {
    if (items.length === 0) return;
    void processQueue(items);
  }

  function retryItem(id: string) {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    updateItem(id, { status: 'pending' });
    // Läuft bereits eine processQueue-Instanz (andere Fotos desselben Stapels noch in Arbeit),
    // holt deren eigene Polling-Schleife das gerade auf 'pending' gesetzte Foto von selbst beim
    // nächsten Durchlauf ab - ein zweiter, parallel laufender processQueue-Aufruf würde sich
    // sonst denselben activeCountRef/items-State teilen und am Ende beide unabhängig
    // onUploaded() auslösen (Minor Finding aus dem Task-5-Review).
    if (!running) {
      void processQueue(items.map((entry) => (entry.id === id ? { ...entry, status: 'pending' } : entry)));
    }
  }

  function handleAttemptClose() {
    if (anyInFlight) {
      if (!window.confirm('Es laufen noch Übertragungen. Wirklich verlassen? Laufende Übertragungen werden abgebrochen.')) return;
      // Ab hier hat der Nutzer bestätigt, dass laufende Übertragungen abgebrochen werden - das muss
      // auch tatsächlich stimmen: neue Generation markieren (damit die alte Polling-Schleife sich
      // selbst beendet und ihre verspäteten State-Updates ignoriert werden) und die echten
      // presign-/complete-fetch- sowie PUT-XHR-Requests der aktuellen Generation abbrechen.
      generationRef.current += 1;
      abortControllerRef.current?.abort();
      setRunning(false);
    }
    setItems([]);
    onClose();
  }

  const doneCount = items.filter((item) => item.status === 'done').length;
  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  const uploadedBytes = items.reduce((sum, item) => sum + item.uploadedBytes, 0);

  return (
    <BottomSheet open={open} onClose={handleAttemptClose} title="Fotos hinzufügen">
      <div className="flex flex-col gap-4">
        {items.length === 0 && (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => cameraInputRef.current?.click()} className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900">
              Foto aufnehmen
            </button>
            <button type="button" onClick={() => libraryInputRef.current?.click()} className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900">
              Aus der Fotobibliothek
            </button>
            <button type="button" onClick={() => filesInputRef.current?.click()} className="min-h-11 rounded-lg border border-neutral-300 px-4 text-left text-sm font-medium text-neutral-900">
              Aus Dateien
            </button>
          </div>
        )}

        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files, cameraInputRef)} />
        <input ref={libraryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files, libraryInputRef)} />
        <input ref={filesInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files, filesInputRef)} />

        {items.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-neutral-700">
              {running || doneCount > 0
                ? `${doneCount} von ${items.length} Fotos übertragen · ${(uploadedBytes / (1024 * 1024)).toFixed(1)} MB von ${(totalBytes / (1024 * 1024)).toFixed(1)} MB · Originalauflösung`
                : `${items.length} Fotos ausgewählt`}
            </p>
            {running && <p className="text-xs text-neutral-500">Der Upload läuft, bitte warte bis alle Fotos hochgeladen sind.</p>}
            {items
              .filter((item) => item.status === 'failed')
              .map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    {item.file.name}: {item.error}
                  </span>
                  <button type="button" onClick={() => retryItem(item.id)} className="text-brand hover:underline">
                    Erneut versuchen
                  </button>
                </div>
              ))}
          </div>
        )}

        <div className="flex items-start gap-2 text-sm text-green-800">
          <span aria-hidden className="mt-1 h-2 w-2 flex-none rounded-full bg-green-600" />
          <p>Durch das Hochladen werden die Fotorechte an die Feuerwehr für die Veröffentlichung abgetreten.</p>
        </div>
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Fotos werden unverändert gespeichert — samt Aufnahmezeit und, falls im Bild vorhanden, Standortdaten. Bei Personen und Kennzeichen gilt
          die Datenschutzregelung der Wehr.
        </p>

        {items.length > 0 && !running && doneCount < items.length && (
          <button type="button" onClick={startUpload} className="min-h-[52px] rounded-lg bg-brand font-medium text-white">
            {items.length} Fotos übertragen
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
