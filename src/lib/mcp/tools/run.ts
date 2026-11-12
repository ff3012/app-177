import { recordMcpAudit } from '../audit';
import type { McpPrincipal } from '../auth';
import { checkRateLimit } from '../rate-limit';
import { ToolError } from './context';
import type { ToolDefinition } from './define';

export const RATE_LIMIT_PER_MINUTE = 120;

interface RunResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const text = (value: string): RunResult['content'] => [{ type: 'text', text: value }];

/**
 * Führt ein Werkzeug aus: Mengenbegrenzung je Token, Fehlerabbildung auf MCP-Werkzeugfehler (deutsch, ohne
 * Stacktrace) und Prüfprotokoll. Protokolliert werden alle abgelehnten Zugriffe (DENIED), alle Schreibaktionen
 * (OK über ToolResult.audit, ERROR bei Fehlern) und alle unerwarteten Fehler.
 */
export async function runTool(
  principal: McpPrincipal,
  tool: ToolDefinition,
  args: unknown,
  deps: { audit?: typeof recordMcpAudit } = {},
): Promise<RunResult> {
  const audit = deps.audit ?? recordMcpAudit;
  const base = { userId: principal.user.id, clientId: principal.clientId, tool: tool.name };

  const limit = checkRateLimit(`mcp:${principal.tokenId}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!limit.allowed) {
    await audit({ ...base, outcome: 'DENIED', summary: 'Mengenbegrenzung überschritten' });
    return { isError: true, content: text(`Zu viele Anfragen. Bitte in ${limit.retryAfterSeconds} Sekunden erneut versuchen.`) };
  }

  try {
    const result = await tool.handler({ principal }, args);
    if (result.audit) {
      await audit({ ...base, outcome: 'OK', targetUserId: result.audit.targetUserId ?? null, summary: result.audit.summary });
    }
    return { content: text(JSON.stringify(result.data, null, 2)) };
  } catch (error) {
    if (error instanceof ToolError) {
      if (error.kind === 'denied') {
        await audit({ ...base, outcome: 'DENIED', summary: error.message });
      } else if (tool.access === 'WRITE') {
        await audit({ ...base, outcome: 'ERROR', summary: error.message });
      }
      return { isError: true, content: text(error.message) };
    }
    console.error(`MCP-Werkzeug ${tool.name} ist fehlgeschlagen:`, error);
    await audit({ ...base, outcome: 'ERROR', summary: 'Unerwarteter Fehler' });
    return { isError: true, content: text('Die Anfrage konnte nicht verarbeitet werden. Bitte später erneut versuchen.') };
  }
}
