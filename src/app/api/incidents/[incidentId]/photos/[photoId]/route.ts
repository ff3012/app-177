import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewIncidentsFor } from '@/lib/auth/permissions';
import { presignPhotoDownload } from '@/lib/storage/incident-photos-s3';

type Variant = 'original' | 'view' | 'thumbnail';

export async function GET(request: Request, { params }: { params: Promise<{ incidentId: string; photoId: string }> }) {
  const user = await requireUser();
  const { incidentId, photoId } = await params;

  const photo = await prisma.incidentPhoto.findUnique({ where: { id: photoId }, include: { incident: true } });
  // Zusätzlich zur reinen Modul-Sichtbarkeit muss das Foto auch zum in der URL genannten Einsatz
  // gehören - sonst könnte eine erratene/bekannte Foto-Id eines fremden Einsatzes über eine falsche
  // incidentId in der URL trotzdem funktionieren, obwohl die Detailseite korrekt filtert. Gleiches
  // Muster wie drohnen/unterlagen/[id]/route.ts.
  if (!photo || photo.incidentId !== incidentId || !canViewIncidentsFor(user, photo.incident.fireDepartmentId)) {
    return NextResponse.json({ error: 'Foto wurde nicht gefunden.' }, { status: 404 });
  }
  if (photo.status !== 'READY') {
    return NextResponse.json({ error: 'Foto ist noch nicht verfügbar.' }, { status: 404 });
  }

  const variant = (new URL(request.url).searchParams.get('variant') as Variant | null) ?? 'view';
  const key =
    variant === 'original' ? photo.storageKey : variant === 'thumbnail' ? photo.thumbnailKey : photo.previewKey;
  if (!key) return NextResponse.json({ error: 'Foto wurde nicht gefunden.' }, { status: 404 });

  const safeFilename = photo.originalName.replace(/["\r\n]/g, '');
  const contentDisposition = variant === 'original' ? `attachment; filename="${safeFilename}"` : undefined;
  const presignedUrl = await presignPhotoDownload(key, { contentDisposition });

  return NextResponse.redirect(presignedUrl, 307);
}
