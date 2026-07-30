import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { canViewDroneModule } from '@/lib/auth/permissions';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canViewDroneModule(user)) {
    return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 404 });
  }

  const { id } = await params;
  const document = await prisma.droneDocument.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: 'Datei wurde nicht gefunden.' }, { status: 404 });
  }

  const safeFilename = document.filename.replace(/["\r\n]/g, '');

  return new NextResponse(document.data, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Content-Length': String(document.sizeBytes),
    },
  });
}
