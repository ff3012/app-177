'use client';

import { getUploadQueueDb, type QueuedUpload } from './db';

// Re-exportiert, damit Aufrufer (z. B. incident-photo-gallery.tsx) den Typ zusammen mit den
// Queue-Funktionen aus diesem einen Modul importieren können, statt zusätzlich './db' zu kennen.
export type { QueuedUpload };

const MAX_PARALLEL_UPLOADS = 3;

type Listener = (uploads: QueuedUpload[]) => void;

const listeners = new Set<Listener>();
let activeUploads = 0;

// Post-Re-Review-Fix: mit RecentIncidentsBlock's Ein-Abo-pro-Einsatz (Findet I3) und der
// Stuck-Upload-Recovery (Findet I1) konnte derselbe 'queued'-Eintrag von mehreren, zeitgleich
// laufenden processQueue()-Aufrufen aufgegriffen werden - jeder liest denselben IndexedDB-Snapshot,
// bevor der jeweils andere den Status auf 'uploading' zurückgeschrieben hat. Das bereits vorhandene
// activeUploads deckelt nur die *Parallelität* (max. 3 gleichzeitig), verhindert aber nicht, dass
// derselbe Eintrag zweimal gestartet wird - Ergebnis wären doppelte Presign-Aufrufe, doppelte
// IncidentPhoto-Zeilen und doppelte S3-Objekte für einen einzigen vom Nutzer ausgewählten File. Dieses
// Set ist die eigentliche Absicherung dagegen, unabhängig davon, wie viele Stellen processQueue()
// aufrufen (Subscriptions, enqueuePhotos, online-/connection.change-Events).
const inFlightIds = new Set<string>();

async function notifyListeners(): Promise<void> {
  const db = await getUploadQueueDb();
  const all = await db.getAll('uploads');
  for (const listener of listeners) listener(all);
}

// Findet I1 (Final-Review): processQueue() wählt ausschließlich status:'queued' aus - ein Eintrag, der
// beim App-Schließen/Reload mitten im Transfer bei 'uploading' hängen blieb, würde sonst für immer
// unauffindbar bleiben (die Fortschrittsanzeige zeigt ihn mit eingefrorenen uploadedBytes, "Erneut
// versuchen" erscheint nur für 'failed'). activeUploads startet nach einem frischen Seitenaufruf immer bei
// 0, also kann zu diesem Zeitpunkt nichts mehr legitim 'uploading' sein - jeder solche Eintrag ist ein
// Überbleibsel eines abgebrochenen vorherigen Ladevorgangs und wird einmalig pro Modul-Ladezyklus auf
// 'queued' zurückgesetzt, bevor processQueue() erneut angestoßen wird.
let recoveryPromise: Promise<void> | null = null;

async function recoverStuckUploads(): Promise<void> {
  const db = await getUploadQueueDb();
  const all = await db.getAll('uploads');
  const stuck = all.filter((entry) => entry.status === 'uploading');
  for (const entry of stuck) {
    await db.put('uploads', { ...entry, status: 'queued', error: undefined });
  }
  if (stuck.length > 0) await notifyListeners();
}

// Memoisiertes Promise statt eines simplen Boolean-Flags, damit mehrere gleichzeitige Aufrufer (z. B.
// mehrere gleichzeitig gemountete Komponenten, die alle subscribeToUploadQueue/enqueuePhotos aufrufen)
// dieselbe eine Wiederherstellung abwarten, statt sie mehrfach parallel auszuführen. Bei einem Fehler wird
// das Promise zurückgesetzt (gleiches Muster wie getUploadQueueDb() in db.ts), damit ein späterer Aufruf
// einen neuen Versuch starten kann.
function ensureStuckUploadsRecovered(): Promise<void> {
  if (!recoveryPromise) {
    recoveryPromise = recoverStuckUploads().catch((error) => {
      recoveryPromise = null;
      throw error;
    });
  }
  return recoveryPromise;
}

// Post-Re-Review-Fix: RecentIncidentsBlock ruft subscribeToUploadQueue() einmal PRO angezeigtem
// Einsatz auf (siehe Findet I3 oben) - vor diesem Fix hängte jeder dieser Aufrufe ein eigenes
// .then(() => processQueue()) an ensureStuckUploadsRecovered() an. Die Recovery selbst war zwar schon
// memoisiert, der anschließende processQueue()-Aufruf aber nicht, lief also bei N gleichzeitig
// angezeigten Einsätzen N-mal unabhängig voneinander an - reine Verschwendung, die durch den
// inFlightIds-Guard unten zwar unschädlich gemacht, aber nicht vermieden wird. Gleiches
// Memoisierungs-Muster wie ensureStuckUploadsRecovered() selbst: einmal pro Modul-Ladezyklus.
let initialProcessQueuePromise: Promise<void> | null = null;

function ensureInitialProcessQueue(): Promise<void> {
  if (!initialProcessQueuePromise) {
    initialProcessQueuePromise = ensureStuckUploadsRecovered().then(() => processQueue());
  }
  return initialProcessQueuePromise;
}

export function subscribeToUploadQueue(incidentId: string, listener: Listener): () => void {
  const scoped: Listener = (all) => listener(all.filter((entry) => entry.incidentId === incidentId));
  listeners.add(scoped);
  void notifyListeners();
  void ensureInitialProcessQueue();
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
  void ensureStuckUploadsRecovered();
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
  // Guard-Check und -Eintragung passieren absichtlich synchron direkt nach dem einzigen await oben, in
  // derselben Schleife wie das Starten der Uploads (kein weiterer await dazwischen) - so kann ein zweiter,
  // zeitgleich laufender processQueue()-Aufruf, dessen eigenes await db.getAll() kurz danach aufwacht,
  // niemals denselben Eintrag noch als "nicht in Flight" vorfinden: sobald dieser Durchlauf hier einmal zu
  // laufen beginnt, läuft er ohne Unterbrechung bis zum Schleifenende durch (JS ist single-threaded, und
  // uploadOne() wird bewusst nicht awaited).
  const queued = all.filter((entry) => entry.status === 'queued' && !inFlightIds.has(entry.id));
  for (const entry of queued) {
    if (activeUploads >= MAX_PARALLEL_UPLOADS) break;
    inFlightIds.add(entry.id);
    activeUploads += 1;
    void uploadOne(entry).finally(() => {
      activeUploads -= 1;
      inFlightIds.delete(entry.id);
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

// Achtung, kein Auto-Resume: processQueue() wählt ausschließlich Einträge mit status:'queued' aus, also
// hat dieses 'online'/'change'-Event auf einen pausierten Eintrag (egal ob manuell via pauseUpload oder
// wifi-bedingt via uploadOne) keinerlei Wirkung - er bleibt 'paused', bis explizit retryUpload() darauf
// aufgerufen wird (Task 6s "Fortsetzen"-Button). Ob ein wifi-bedingt pausierter Eintrag stattdessen bei
// Netzwerkwechsel automatisch wieder aufgenommen werden soll, ist eine bewusst offen gelassene
// UX-Designfrage für Task 6, keine hier "vergessene" Verdrahtung. Nur auf dem Client registrieren
// (dieses Modul wird nie serverseitig ausgeführt, aber 'use client' allein verhindert nicht, dass ein
// SSR-Preload-Pass das Modul einmal ohne DOM lädt).
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void processQueue());
  const connection = (navigator as unknown as { connection?: EventTarget }).connection;
  connection?.addEventListener?.('change', () => void processQueue());
}
