import { prisma } from '@/lib/db/prisma';
import type { McpAccessLevel } from './access';

/** Aktuelle MCP-Stufe eines Benutzers aus der Datenbank (NONE, wenn es ihn nicht gibt). */
export async function getMcpAccessOf(userId: string): Promise<McpAccessLevel> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { mcpAccess: true } });
  return row?.mcpAccess ?? 'NONE';
}
