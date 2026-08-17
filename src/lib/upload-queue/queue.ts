'use client';

import { getUploadQueueDb, type QueuedUpload } from './db';

const MAX_PARALLEL_UPLOADS = 3;

type Listener = (uploads: QueuedUpload[]) => void;

const listeners = new Set<Listener>();
let activeUploads = 0;

async function notifyListeners(): Promise<void> {
  const db = await getUploadQueueDb();
  const all = await db.getAll('uploads');
  for (const listener of listeners) listener(all);
}

export function subscribeToUploadQueue(incidentId: string, listener: Listener): () => void {
  const scoped: Listener = (all) => listener(all.filter((entry) => entry.incidentId === incidentId));
  listeners.add(scoped);
  void notifyListeners();
  return () => listeners.delete(scoped);
}

/** iOS Safari (auch als installierte PWA) unterstützt die Network Information API nicht -
 * navigator.connection ist dort immer undefined. Reale Plattformgrenze (Foto-Upload-Brief.md §5,
 * "Umsetzungshinweis"): auf iOS wird "Nur über WLAN" nicht durchgesetzt, der Upload startet dort
 * immer sofort, auch wenn der Schalter aktiv ist. */
function isCellularConnection(): boolean {
  const connection = (navigator as unknown as { connection?: { type?: string; effectiveType?: string } }).connection;
  if (!connection) return false;
  if (connection.type) return connection.type === 'cellular';
  return connection.effectiveType !== undefined && ['slow-2g', '2g', '3g'].includes(connection.effectiveType);
}

async function updateEntry(id: string, patch: Partial<QueuedUpload>): Promise<void> {
  const db = await getUploadQueueDb();
  const existing = await db.get('uploads', id);
  if (!existing) return;
  await db.put('uploads', { ...existing, ...patch });
  await notifyListeners();
}

export async function enqueuePhotos(
  incidentId: string,
  files: File[],
  options: { publicRelease: boolean; wifiOnly: boolean },
): Promise<void> {
  const db = await getUploadQueueDb();
  const tx = db.transaction('uploads', 'readwrite');
  for (const file of files) {
    const id = `${incidentId}-${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
    const entry: QueuedUpload = {
      id,
      incidentId,
      file,
      fileName: file.name,
      mimeType: file.type,
      byteSize: file.size,
      uploadedBytes: 0,
      status: 'queued',
      publicRelease: options.publicRelease,
      wifiOnly: options.wifiOnly,
      createdAt: Date.now(),
    };
    await tx.store.put(entry);
  }
  await tx.done;
  await notifyListeners();
  void processQueue();
}

async function uploadOne(entry: QueuedUpload): Promise<void> {
  if (entry.wifiOnly && isCellularConnection()) {
    await updateEntry(entry.id, { status: 'paused', error: 'Wartet auf WLAN-Verbindung.' });
    return;
  }

  await updateEntry(entry.id, { status: 'uploading', error: undefined });

  try {
    const presignResponse = await fetch(`/api/incidents/${entry.incidentId}/photos/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: entry.fileName, mimeType: entry.mimeType, byteSize: entry.byteSize }),
    });
    if (!presignResponse.ok) {
      const body = (await presignResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Server hat den Upload abgelehnt.');
    }
    const { uploadUrl, photoId } = (await presignResponse.json()) as { uploadUrl: string; photoId: string };

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', entry.mimeType);
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        void updateEntry(entry.id, { uploadedBytes: event.loaded });
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload fehlgeschlagen (${xhr.status}).`)));
      xhr.onerror = () => reject(new Error('Netzwerkfehler beim Hochladen.'));
      xhr.send(entry.file);
    });

    const completeResponse = await fetch(`/api/incidents/${entry.incidentId}/photos/${photoId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicRelease: entry.publicRelease }),
    });
    if (!completeResponse.ok) {
      const body = (await completeResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Verarbeitung nach dem Upload fehlgeschlagen.');
    }

    await updateEntry(entry.id, { status: 'done', uploadedBytes: entry.byteSize });
  } catch (error) {
    await updateEntry(entry.id, { status: 'failed', error: error instanceof Error ? error.message : 'Unbekannter Fehler.' });
  }
}

export async function processQueue(): Promise<void> {
  const db = await getUploadQueueDb();
  const all = await db.getAll('uploads');
  const queued = all.filter((entry) => entry.status === 'queued');
  for (const entry of queued) {
    if (activeUploads >= MAX_PARALLEL_UPLOADS) break;
    activeUploads += 1;
    void uploadOne(entry).finally(() => {
      activeUploads -= 1;
      void processQueue();
    });
  }
}

export async function retryUpload(id: string): Promise<void> {
  await updateEntry(id, { status: 'queued', error: undefined });
  void processQueue();
}

export async function pauseUpload(id: string): Promise<void> {
  await updateEntry(id, { status: 'paused' });
}

export function resumeQueueProcessing(): void {
  void processQueue();
}

export async function removeUpload(id: string): Promise<void> {
  const db = await getUploadQueueDb();
  await db.delete('uploads', id);
  await notifyListeners();
}

// Sobald die Verbindung wechselt (WLAN <-> Mobilfunk) oder der Browser wieder online ist, erneut
// versuchen - pausierte Einträge werden in uploadOne selbst wieder auf 'queued' geprüft, nicht hier.
// Nur auf dem Client registrieren (dieses Modul wird nie serverseitig ausgeführt, aber 'use client'
// allein verhindert nicht, dass ein SSR-Preload-Pass das Modul einmal ohne DOM lädt).
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void processQueue());
  const connection = (navigator as unknown as { connection?: EventTarget }).connection;
  connection?.addEventListener?.('change', () => void processQueue());
}
