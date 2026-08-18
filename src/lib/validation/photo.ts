export const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const ALLOWED_SHARP_PHOTO_FORMATS = ['jpeg', 'png', 'webp', 'gif'];

export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export const MAX_PHOTOS_PER_BATCH = 30;

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
    default:
      return 'bin';
  }
}

export function buildPhotoStorageKeys(
  photoUploadId: string,
  photoId: string,
  mimeType: string,
): { storageKey: string; previewKey: string; thumbKey: string } {
  const ext = extensionForMimeType(mimeType);
  return {
    storageKey: `photo-uploads/${photoUploadId}/${photoId}/original.${ext}`,
    previewKey: `photo-uploads/${photoUploadId}/${photoId}/view.webp`,
    thumbKey: `photo-uploads/${photoUploadId}/${photoId}/thumb.webp`,
  };
}
