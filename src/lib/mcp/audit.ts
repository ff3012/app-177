import { prisma } from '@/lib/db/prisma';

export interface McpAuditEntry {
  userId: string | null;
  clientId: string | null;
  tool: string;
  outcome: 'OK' | 'DENIED' | 'ERROR';
  targetUserId?: string | null;
  /** Kurzer Text OHNE Freitexte (Telefonnummer, Anmerkungen); Namen und E-Mail des Ziels sind erlaubt. */
  summary: string;
}

/** Schreibt einen Prüfprotokoll-Eintrag. Wirft nie: ein Protokollfehler darf die Aktion selbst nicht kippen. */
export async function recordMcpAudit(entry: McpAuditEntry): Promise<void> {
  try {
    await prisma.mcpAuditLog.create({
      data: {
        userId: entry.userId,
        clientId: entry.clientId,
        tool: entry.tool,
        outcome: entry.outcome,
        targetUserId: entry.targetUserId ?? null,
        summary: entry.summary.slice(0, 500),
      },
    });
  } catch (error) {
    // Nie das ganze Fehlerobjekt loggen: Prisma-Fehler können Argumentwerte (z. B. summary mit Name/E-Mail) enthalten.
    const code = (error as { code?: unknown } | null)?.code;
    const safe =
      typeof code === 'string'
        ? code
        : error instanceof Error
          ? error.message.slice(0, 200)
          : 'unbekannter Fehler';
    console.error('MCP-Prüfprotokoll konnte nicht geschrieben werden:', safe);
  }
}

/** Anzahl erfolgreicher Aufrufe eines Werkzeugs durch den Benutzer in den letzten sinceMs Millisekunden. */
export async function countRecentOk(userId: string, tool: string, sinceMs: number, now: Date = new Date()): Promise<number> {
  return prisma.mcpAuditLog.count({
    where: { userId, tool, outcome: 'OK', createdAt: { gt: new Date(now.getTime() - sinceMs) } },
  });
}
