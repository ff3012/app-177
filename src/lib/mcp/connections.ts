import { prisma } from '@/lib/db/prisma';
import { isMcpEnabled } from './enabled';
import { revokeTokensOfUser } from './oauth/service';

export interface McpConnection {
  oauthClientId: string;
  clientName: string;
  scope: string;
  connectedAt: Date;
  lastUsedAt: Date | null;
}

/** Eine Verbindung je Client: gültig = nicht widerrufen und Refresh-Token nicht abgelaufen. */
export async function listConnections(userId: string, now: Date = new Date()): Promise<McpConnection[]> {
  const tokens = await prisma.oauthToken.findMany({
    where: { userId, revokedAt: null, refreshExpiresAt: { gt: now } },
    include: { oauthClient: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const byClient = new Map<string, McpConnection>();
  for (const token of tokens) {
    const existing = byClient.get(token.oauthClientId);
    if (!existing) {
      byClient.set(token.oauthClientId, {
        oauthClientId: token.oauthClientId,
        clientName: token.oauthClient.name,
        scope: token.scope,
        connectedAt: token.createdAt,
        lastUsedAt: token.lastUsedAt,
      });
    } else {
      if (token.createdAt < existing.connectedAt) existing.connectedAt = token.createdAt;
      if (token.lastUsedAt && (!existing.lastUsedAt || token.lastUsedAt > existing.lastUsedAt)) existing.lastUsedAt = token.lastUsedAt;
    }
  }
  return [...byClient.values()];
}

/**
 * Beendet die Verbindung eines Clients - nur Token des angegebenen Benutzers (nie fremde). Gibt die Anzahl zurück.
 * Eine leere Client-ID wird abgewiesen: revokeTokensOfUser würde sie als "kein Filter" lesen und ALLE Token des
 * Benutzers widerrufen.
 */
export async function revokeConnection(userId: string, oauthClientId: string): Promise<number> {
  if (!oauthClientId) return 0;
  return revokeTokensOfUser(userId, oauthClientId);
}

/** Soll der Menüeintrag "Verbundene KI-Apps" erscheinen? Schalter an UND der Benutzer hat ein MCP-Recht. */
export async function getKiAppsVisibility(userId: string): Promise<boolean> {
  const [enabled, user] = await Promise.all([
    isMcpEnabled(),
    prisma.user.findUnique({ where: { id: userId }, select: { mcpAccess: true } }),
  ]);
  return enabled && !!user && user.mcpAccess !== 'NONE';
}
