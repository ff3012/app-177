import { ZipArchive } from 'archiver';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { canViewPhotoUploadsFor } from '@/lib/auth/permissions';
import { getPhotoObjectBytes } from '@/lib/storage/photo-uploads-s3';

/** Fügt bei doppeltem Dateinamen (z.B. zwei Fotos "IMG_0001.jpg" von unterschiedlichen Handys)
 * einen Zähler-Suffix an, statt dass eine Datei im ZIP eine andere stillschweigend überschreibt. */
function uniqueFilename(originalName: string, used: Set<string>): string {
  const safe = originalName.replace(/[\r\n]/g, '').trim() || 'foto';
  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }
  const dotIndex = safe.lastIndexOf('.');
  const base = dotIndex > 0 ? safe.slice(0, dotIndex) : safe;
  const ext = dotIndex > 0 ? safe.slice(dotIndex) : '';
  let counter = 2;
  let candidate = `${base} (${counter})${ext}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${base} (${counter})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Bündelt alle READY-Fotos eines Foto Uploads als ein ZIP - für den raschen Sammel-Download statt
 * einzeln pro Foto. Dieselbe Berechtigungsprüfung (canViewPhotoUploadsFor) wie die bestehende
 * Einzelfoto-Route (photos/[photoId]/route.ts), da "alle herunterladen" wie "ein Foto herunterladen"
 * eine reine Lese-Aktion ist, kein Verwaltungsrecht braucht.
 *
 * Die Einzelfoto-Route löst pro Foto einen 307-Redirect auf eine presigned S3-URL aus - das
 * funktioniert hier nicht, weil ein ZIP mehrere S3-Objekte zu einer Antwort zusammenführen muss.
 * Stattdessen wird - exakt demselben Buffer-erst-dann-Response-Muster wie die bestehenden
 * Excel-Export-Routen (z.B. admin/benutzer/export/route.ts) folgend - das ZIP komplett im Speicher
 * aufgebaut (jedes Originalfoto einzeln per getPhotoObjectBytes von S3 geladen, dieselbe Funktion,
 * die schon die Thumbnail/Vorschau-Generierung nutzt) und erst danach als eine Antwort gesendet.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ photoUploadId: string }> }) {
  const user = await requireUser();
  const { photoUploadId } = await params;

  const photoUpload = await prisma.photoUpload.findUnique({
    where: { id: photoUploadId },
    include: { photos: { where: { status: 'READY' }, orderBy: { createdAt: 'asc' } } },
  });
  if (!photoUpload || !canViewPhotoUploadsFor(user, photoUpload.fireDepartmentId)) {
    return NextResponse.json({ error: 'Foto Upload wurde nicht gefunden.' }, { status: 404 });
  }
  if (photoUpload.photos.length === 0) {
    return NextResponse.json({ error: 'Keine Fotos zum Herunterladen vorhanden.' }, { status: 404 });
  }

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('error', reject);
  });

  const usedNames = new Set<string>();
  for (const photo of photoUpload.photos) {
    const bytes = await getPhotoObjectBytes(photo.storageKey);
    archive.append(bytes, { name: uniqueFilename(photo.originalName, usedNames) });
  }
  await archive.finalize();
  await finished;

  const safeDescription = photoUpload.description.replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, '').trim() || 'fotos';
  return new NextResponse(Buffer.concat(chunks), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeDescription}.zip"`,
    },
  });
}
