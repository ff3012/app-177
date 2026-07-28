'use server';

import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, isSiteAdmin } from '@/lib/auth/permissions';
import { checkMailjetConnection } from '@/lib/email/mailjet';

export interface SystemCheckResult {
  server: boolean;
  docker: boolean;
  mailjet: boolean;
  checkedAt: string;
}

async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * "Docker läuft" wird indirekt über die Datenbankverbindung geprüft: App und Postgres laufen
 * als getrennte Docker-Compose-Container, verbunden über den Servicenamen "postgres" in
 * DATABASE_URL – eine erfolgreiche Query beweist, dass dieser Container erreichbar ist.
 */
export async function runSystemCheck(): Promise<SystemCheckResult> {
  const user = await requireUser();
  assertPermission(isSiteAdmin(user));

  const [docker, mailjet] = await Promise.all([checkDatabaseConnection(), checkMailjetConnection()]);

  return {
    server: true,
    docker,
    mailjet,
    checkedAt: new Date().toISOString(),
  };
}
