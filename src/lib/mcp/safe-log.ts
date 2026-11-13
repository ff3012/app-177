/** Prisma rendert bei Fehlern die gesamte Abfrage (Namen, E-Mail-Adressen, Suchtexte) an den Anfang der Meldung. */
const PRISMA_MESSAGE_PREFIX = /^\s*Invalid\s+`?prisma\./;

/**
 * Harmlose Kurzfassung eines Fehlers fürs Log. Prisma-Fehler beginnen mit der gerenderten Abfrage (Namen, E-Mail-
 * Adressen, Suchtexte) - bei `PrismaClient*`-Fehlern oder einer Meldung, die mit "Invalid `prisma." beginnt (auch bei
 * umbenannter Fehlerklasse), deshalb nie die Meldung, nur Name und Code.
 */
export function safeErrorSummary(error: unknown): string {
  if (!(error instanceof Error)) return 'unbekannter Fehler';
  const code = (error as { code?: unknown }).code;
  let summary = error.name;
  if (typeof code === 'string') summary += ` code=${code}`;
  const looksLikePrisma =
    error.name.startsWith('PrismaClient') ||
    error.constructor?.name?.startsWith('PrismaClient') ||
    PRISMA_MESSAGE_PREFIX.test(error.message);
  if (!looksLikePrisma) summary += `: ${error.message.slice(0, 200)}`;
  return summary;
}
