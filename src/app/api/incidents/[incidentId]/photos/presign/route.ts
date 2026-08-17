import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewIncidentsFor } from '@/lib/auth/permissions';
import {
  ALLOWED_INCIDENT_PHOTO_MIME_TYPES,
  MAX_INCIDENT_PHOTO_BYTES,
  buildIncidentPhotoStorageKeys,
} from '@/lib/validation/incident-photo';
import { presignPhotoUpload } from '@/lib/storage/incident-photos-s3';

export async function POST(request: Request, { params }: { params: Promise<{ incidentId: string }> }) {
  const user = await requireUser();
  const { incidentId } = await params;

  const incident = await prisma.incident.findUnique({ where: { id: incidentId }, select: { fireDepartmentId: true } });
  if (!incident || !canViewIncidentsFor(user, incident.fireDepartmentId)) {
    return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { fileName?: string; mimeType?: string; byteSize?: number } | null;
  if (!body?.fileName || !body.mimeType || typeof body.byteSize !== 'number') {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });
  }
  if (!ALLOWED_INCIDENT_PHOTO_MIME_TYPES.includes(body.mimeType)) {
    return NextResponse.json({ error: 'Dateityp nicht erlaubt.' }, { status: 400 });
  }
  if (body.byteSize <= 0 || body.byteSize > MAX_INCIDENT_PHOTO_BYTES) {
    return NextResponse.json({ error: 'Datei zu groß (maximal 50 MB).' }, { status: 400 });
  }

  const photo = await prisma.incidentPhoto.create({
    data: {
      incidentId,
      uploadedById: user.id,
      // storageKey wird gleich unten mit der echten photo.id überschrieben - Prisma benötigt die
      // id VOR dem Erzeugen der Schlüssel, daher zwei Schritte statt eines.
      storageKey: '',
      originalName: body.fileName,
      mimeType: body.mimeType,
      byteSize: body.byteSize,
      status: 'PENDING',
    },
  });

  const { storageKey } = buildIncidentPhotoStorageKeys(incidentId, photo.id, body.mimeType);
  await prisma.incidentPhoto.update({ where: { id: photo.id }, data: { storageKey } });

  const uploadUrl = await presignPhotoUpload(storageKey, body.mimeType);
  return NextResponse.json({ photoId: photo.id, uploadUrl, storageKey });
}
