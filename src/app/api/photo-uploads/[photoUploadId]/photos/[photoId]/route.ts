import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewPhotoUploadsFor } from '@/lib/auth/permissions';
import { presignPhotoDownload } from '@/lib/storage/photo-uploads-s3';

type Variant = 'original' | 'view' | 'thumbnail';

export async function GET(request: Request, { params }: { params: Promise<{ photoUploadId: string; photoId: string }> }) {
  const user = await requireUser();
  const { photoUploadId, photoId } = await params;

  const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { photoUpload: true } });
  if (!photo || photo.photoUploadId !== photoUploadId || !canViewPhotoUploadsFor(user, photo.photoUpload.fireDepartmentId)) {
    return NextResponse.json({ error: 'Foto wurde nicht gefunden.' }, { status: 404 });
  }
  if (photo.status !== 'READY') {
    return NextResponse.json({ error: 'Foto ist noch nicht verfügbar.' }, { status: 404 });
  }

  const variant = (new URL(request.url).searchParams.get('variant') as Variant | null) ?? 'view';
  const key = variant === 'original' ? photo.storageKey : variant === 'thumbnail' ? photo.thumbKey : photo.previewKey;
  if (!key) return NextResponse.json({ error: 'Foto wurde nicht gefunden.' }, { status: 404 });

  const safeFilename = photo.originalName.replace(/["\r\n]/g, '');
  const contentDisposition = variant === 'original' ? `attachment; filename="${safeFilename}"` : undefined;
  const presignedUrl = await presignPhotoDownload(key, { contentDisposition });

  return NextResponse.redirect(presignedUrl, 307);
}
