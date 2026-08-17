import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type QueuedUploadStatus = 'queued' | 'uploading' | 'paused' | 'failed' | 'done';

export interface QueuedUpload {
  id: string;
  incidentId: string;
  file: File;
  fileName: string;
  mimeType: string;
  byteSize: number;
  uploadedBytes: number;
  status: QueuedUploadStatus;
  publicRelease: boolean;
  wifiOnly: boolean;
  error?: string;
  createdAt: number;
}

interface UploadQueueDBSchema extends DBSchema {
  uploads: {
    key: string;
    value: QueuedUpload;
    indexes: { 'by-incident': string };
  };
}

const DB_NAME = 'einsatz-foto-upload-queue';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<UploadQueueDBSchema>> | null = null;

// IndexedDB unterstützt das Speichern von File/Blob-Objekten direkt (structured clone) - kein
// separates Auslesen in ArrayBuffer nötig. Das ist die Grundlage für "übersteht App-Neustart"
// (Foto-Upload-Brief.md §5): moderne Browser (Chrome/Firefox/Safari) persistieren gespeicherte
// Blobs über einen App-/Browser-Neustart hinweg.
export function getUploadQueueDb(): Promise<IDBPDatabase<UploadQueueDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<UploadQueueDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('uploads', { keyPath: 'id' });
        store.createIndex('by-incident', 'incidentId');
      },
    }).catch((error) => {
      // Ohne dieses Zurücksetzen würde ein einmalig fehlgeschlagenes openDB() (z. B. Private-Browsing-
      // Modus ohne IndexedDB-Unterstützung, oder ein momentanes Speicherkontingent-Problem) dbPromise
      // dauerhaft auf ein abgelehntes Promise fixieren - jeder spätere Aufruf von getUploadQueueDb()
      // würde für den Rest der Seiten-Lebensdauer dieselbe Ablehnung liefern, selbst wenn die Ursache
      // längst behoben ist. Stattdessen: dbPromise zurücksetzen, damit der nächste Aufruf einen frischen
      // Versuch startet, und den ursprünglichen Fehler an den aktuellen Aufrufer weiterreichen.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}
