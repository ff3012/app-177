import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(_request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const image = await prisma.facebookPostImage.findUnique({ where: { postId } });
  if (!image) {
    return NextResponse.json({ error: 'nicht gefunden' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(image.data), {
    headers: { 'Content-Type': image.mimeType, 'Cache-Control': 'public, max-age=3600, immutable' },
  });
}
