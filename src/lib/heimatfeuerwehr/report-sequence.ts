import type { Prisma } from '@prisma/client';

/**
 * Vergibt die nächste fortlaufende Berichtsnummer für eine Feuerwehr/Jahr-Kombination - MUSS mit dem
 * Transaction-Client aus submitReports prisma.$transaction aufgerufen werden (Task 7), nicht mit dem
 * globalen prisma-Client, sonst ist die Atomarität nicht gegeben. Postgres serialisiert konkurrierende
 * upserts auf denselben Primärschlüssel automatisch (INSERT ... ON CONFLICT) - keine Lücken, keine
 * Duplikate, auch bei zwei gleichzeitigen Abgaben derselben Feuerwehr im selben Jahr.
 */
export async function getNextReportNumber(
  tx: Prisma.TransactionClient,
  fireDepartmentId: string,
  year: number,
): Promise<number> {
  const sequence = await tx.reportSequence.upsert({
    where: { fireDepartmentId_year: { fireDepartmentId, year } },
    create: { fireDepartmentId, year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return sequence.lastNumber;
}
