/**
 * Harmlose Kurzfassung eines Fehlers fürs Log. Prisma-Validierungsfehler beginnen mit der gerenderten Abfrage (Namen,
 * E-Mail-Adressen, Suchtexte) - bei `PrismaClient*`-Fehlern deshalb nie die Meldung, nur Name und Code.
 */
export function safeErrorSummary(error: unknown): string {
  if (!(error instanceof Error)) return 'unbekannter Fehler';
  const code = (error as { code?: unknown }).code;
  let summary = error.name;
  if (typeof code === 'string') summary += ` code=${code}`;
  if (!error.name.startsWith('PrismaClient')) summary += `: ${error.message.slice(0, 200)}`;
  return summary;
}
