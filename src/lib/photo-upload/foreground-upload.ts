export interface UploadItem {
  id: string;
  file: File;
  uploadedBytes: number;
  status: 'pending' | 'uploading' | 'done' | 'failed';
  error?: string;
}

/** Lädt genau eine Datei hoch: presign -> XHR PUT (mit Byte-Fortschritt) -> complete. Wirft bei
 * jedem Fehlschlag - der Aufrufer (photo-upload-sheet.tsx) fängt das pro Datei ab, damit ein
 * einzelner Fehlschlag die übrigen nicht mitreißt (Foto-Upload-Brief.md §5.4). Kein
 * Wiederaufnehmen/Pausieren - das ist mit dieser rein synchronen, nicht-persistenten Funktion
 * bewusst nicht vorgesehen; ein Fehlschlag wird stattdessen einfach erneut aufgerufen
 * ("Erneut versuchen"), was denselben Ablauf von vorn beginnt.
 *
 * Optionaler `signal` (Fix Runde 1, Task-5-Review): erlaubt dem Aufrufer, einen laufenden Upload
 * abzubrechen, wenn der Nutzer das Sheet mitten in einer Übertragung schließt und die
 * Rückfrage-Meldung ("Laufende Übertragungen werden abgebrochen") wahr machen soll, statt den
 * Request im Hintergrund einfach zu Ende laufen zu lassen. Bricht sowohl den presign-/complete-
 * `fetch` als auch den PUT-`XMLHttpRequest` ab; ein Abbruch wirft (wie jeder andere Fehlschlag
 * auch), der Aufrufer erkennt ihn an `error.name === 'AbortError'`. */
export async function uploadOnePhoto(
  photoUploadId: string,
  file: File,
  onProgress: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const presignResponse = await fetch(`/api/photo-uploads/${photoUploadId}/photos/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, byteSize: file.size }),
    signal,
  });
  if (!presignResponse.ok) {
    const body = (await presignResponse.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Server hat den Upload abgelehnt.');
  }
  const { uploadUrl, photoId } = (await presignResponse.json()) as { uploadUrl: string; photoId: string };

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload fehlgeschlagen (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('Netzwerkfehler beim Hochladen.'));
    xhr.onabort = () => reject(new DOMException('Hochladen abgebrochen.', 'AbortError'));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort());
    }
    xhr.send(file);
  });

  const completeResponse = await fetch(`/api/photo-uploads/${photoUploadId}/photos/${photoId}/complete`, { method: 'POST', signal });
  if (!completeResponse.ok) {
    const body = (await completeResponse.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Verarbeitung nach dem Upload fehlgeschlagen.');
  }
}
