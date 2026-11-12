import { hasMcpAccess, type McpAccessLevel } from '@/lib/mcp/access';

export const MCP_SCOPES = ['mcp:read', 'mcp:write'] as const;
type McpScope = (typeof MCP_SCOPES)[number];

export function parseScope(scope: string | null | undefined): string[] {
  const requested = (scope ?? '').split(/\s+/).filter(Boolean);
  return Array.from(new Set(requested.filter((s): s is McpScope => (MCP_SCOPES as readonly string[]).includes(s))));
}

/** Anfrage ∩ eigene Stufe. Ohne Anfrage: alles, was die Stufe erlaubt. Leerstring = nichts gewährbar. */
export function grantedScope(requested: string | null | undefined, access: McpAccessLevel): string {
  const parsed = parseScope(requested);
  const wanted: string[] = parsed.length > 0 ? parsed : [...MCP_SCOPES];
  return wanted
    .filter((scope) => hasMcpAccess(access, scope === 'mcp:write' ? 'WRITE' : 'READ'))
    .join(' ');
}

export function scopeLevel(scope: string): McpAccessLevel {
  const scopes = parseScope(scope);
  if (scopes.includes('mcp:write')) return 'WRITE';
  if (scopes.includes('mcp:read')) return 'READ';
  return 'NONE';
}
