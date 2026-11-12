/** Stufen des MCP-Zugriffs (spiegelt das Prisma-Enum McpAccess, bleibt aber frei von Datenbank-Importen). */
export const MCP_ACCESS_LEVELS = ['NONE', 'READ', 'WRITE'] as const;
export type McpAccessLevel = (typeof MCP_ACCESS_LEVELS)[number];

const RANK: Record<McpAccessLevel, number> = { NONE: 0, READ: 1, WRITE: 2 };

export function mcpRank(level: McpAccessLevel): number {
  return RANK[level];
}

/** WRITE schließt READ ein. */
export function hasMcpAccess(have: McpAccessLevel, need: McpAccessLevel): boolean {
  return RANK[have] >= RANK[need];
}

/** Nur exakt 'NONE' | 'READ' | 'WRITE'; sonst undefined - ein fehlendes Formularfeld darf nie als NONE gelten. */
export function parseMcpAccess(value: unknown): McpAccessLevel | undefined {
  return typeof value === 'string' && (MCP_ACCESS_LEVELS as readonly string[]).includes(value)
    ? (value as McpAccessLevel)
    : undefined;
}
