/** Client-deklarierte MIME-Typen, die presign überhaupt akzeptiert - eine erste, NICHT
 * vertrauenswürdige Filterung (siehe complete-Route für die echte Prüfung per sharp-Dekodierung,
 * gleiches Muster wie die Wappen-Upload-Härtung, Security-Review S3). HEIC/HEIF zusätzlich zur
 * bestehenden Wappen-Allowlist, da iPhones standardmäßig dieses Format liefern. */
export const ALLOWED_INCIDENT_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
];

/** Von sharp erkannte Formate, die als "echtes Bild" akzeptiert werden - die tatsächliche
 * Sicherheitsprüfung (complete-Route). sharp meldet HEIC/HEIF-Dateien als 'heif' (libheif). */
export const ALLOWED_SHARP_PHOTO_FORMATS = ['jpeg', 'png', 'webp', 'gif', 'heif'];

export const MAX_INCIDENT_PHOTO_BYTES = 50 * 1024 * 1024;
export const MAX_INCIDENT_PHOTOS_PER_BATCH = 30;

export function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/heic':
    case 'image/heif':
      return 'heic';
    default:
      return 'bin';
  }
}

export function buildIncidentPhotoStorageKeys(
  incidentId: string,
  photoId: string,
  mimeType: string,
): { storageKey: string; previewKey: string; thumbnailKey: string } {
  const ext = extensionForMimeType(mimeType);
  return {
    storageKey: `incidents/${incidentId}/${photoId}/original.${ext}`,
    previewKey: `incidents/${incidentId}/${photoId}/view.webp`,
    thumbnailKey: `incidents/${incidentId}/${photoId}/thumb.webp`,
  };
}
