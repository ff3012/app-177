import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

// Session-gated (nicht in middleware.ts's PUBLIC_PATH_PREFIXES), aber ohne weitere
// Berechtigungsprüfung - ein Feuerwehr-Wappen ist kein Geheimnis, jeder angemeldete Benutzer darf
// jedes Wappen sehen (z. B. für abschnittsweite Termine einer fremden Feuerwehr). 404 statt eines
// kaputten <img>, wenn kein Bild hinterlegt ist - die Tab-Bar fragt das über hasWappen ohnehin
// vorher ab und zeigt sonst gleich das neutrale Ersatzsymbol, aber ein direkter Aufruf dieser
// Route soll trotzdem korrekt 404en.
export async function GET(_request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  await requireUser();
  const { organizationId } = await params;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { wappenImageData: true, wappenImageMimeType: true },
  });

  if (!organization?.wappenImageData || !organization.wappenImageMimeType) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(organization.wappenImageData, {
    headers: {
      'Content-Type': organization.wappenImageMimeType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
