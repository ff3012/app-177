import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasMcpAccess } from './access';
import type { McpPrincipal } from './auth';
import { TOOLS } from './tools';
import { runTool } from './tools/run';

/**
 * Baut für EINE Anfrage einen zustandslosen MCP-Server. Nur Werkzeuge, die die Stufe des Aufrufers erlaubt, werden
 * registriert (ein READ-Token sieht weder in tools/list noch beim Aufruf ein Schreibwerkzeug).
 */
export function createMcpServer(principal: McpPrincipal): McpServer {
  const server = new McpServer({ name: 'feuerwehr-app-bezirk-17', version: '1.0.0' });
  for (const tool of TOOLS) {
    if (!hasMcpAccess(principal.access, tool.access)) continue;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.access === 'READ',
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args: unknown) => runTool(principal, tool, args),
    );
  }
  return server;
}
