import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { canDownloadChecklistPdf } from '@/lib/auth/permissions';
import { getChecklistView } from '@/lib/drone/checklist/queries';
import { loadChecklistPdfData } from '@/lib/drone/checklist/delivery';
import { checklistPdfFileName } from '@/lib/drone/checklist/mail';
import { generateChecklistPdf } from '@/lib/drone/checklist/pdf';

/** PDF einer ABGEGEBENEN Checkliste. Wird aus den gespeicherten Daten erzeugt (nicht aus dem Archiv), damit
 * der Download auch ohne S3-Zugriff funktioniert und immer zum aktuellen Datenstand passt. Nicht sichtbar
 * wird genauso beantwortet wie nicht vorhanden. */
export async function GET(_request: Request, { params }: { params: Promise<{ checklistId: string }> }) {
  const { checklistId } = await params;
  const user = await requireUser();
  const view = await getChecklistView(user, checklistId);
  if (!view || !canDownloadChecklistPdf(user, view.checklist, view.droneGroup)) {
    return NextResponse.json({ error: 'Checkliste nicht gefunden.' }, { status: 404 });
  }
  const data = await loadChecklistPdfData(checklistId);
  if (!data) return NextResponse.json({ error: 'Checkliste nicht gefunden.' }, { status: 404 });
  const pdf = await generateChecklistPdf(data);
  const fileName = checklistPdfFileName(view.checklist.flightAt, view.checklist.area);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
