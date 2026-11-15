'use server';

import { requireUser } from '@/lib/auth/session';
import { assertPermission, canCreateReportFor } from '@/lib/auth/permissions';
import {
  submitReportCore,
  type SubmitReportInput,
  type SubmitReportResult,
} from '@/lib/heimatfeuerwehr/submit-report-core';

/**
 * Legt einen Bericht aus der App an (angemeldeter Benutzer, seine Heimatfeuerwehr). Die gesamte
 * Prüfung und das Anlegen liegen in submitReportCore (geteilt mit der iPad-Schnellerfassung), siehe dort.
 */
export async function submitReport(input: SubmitReportInput): Promise<SubmitReportResult> {
  const user = await requireUser();
  assertPermission(canCreateReportFor(user, user.homeOrganizationId));
  return submitReportCore({ fireDepartmentId: user.homeOrganizationId, createdById: user.id, input });
}
