import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { presignReportPdfDownload } from '@/lib/storage/report-pdf-s3';
import { reportPdfStorageKey } from '@/lib/heimatfeuerwehr/report-pdf';

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const user = await requireUser();

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report || report.status !== 'SUBMITTED' || !report.number || !report.submittedAt) {
    return NextResponse.json({ error: 'Bericht nicht gefunden.' }, { status: 404 });
  }
  assertPermission(canManageHeimatfeuerwehrFor(user, report.fireDepartmentId));

  const storageKey = reportPdfStorageKey(report.fireDepartmentId, report.number, report.submittedAt);
  const url = await presignReportPdfDownload(storageKey);
  return NextResponse.redirect(url);
}
