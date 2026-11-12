import { buildSessionUser, findUserWithRelationsById } from '@/lib/auth/build-session-user';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/types/next-auth';
import { mcpRank, type McpAccessLevel } from './access';
import { scopeLevel } from './oauth/scopes';
import { hashSecret } from './oauth/secrets';
import { safeErrorSummary } from './safe-log';

export interface McpPrincipal {
  user: SessionUser;
  access: McpAccessLevel;
  clientId: string;
  clientName: string;
  tokenId: string;
}

export type McpAuthResult =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; status: 401 | 403; error: 'invalid_token' | 'insufficient_scope' };

const INVALID: McpAuthResult = { ok: false, status: 401, error: 'invalid_token' };
const LAST_USED_THROTTLE_MS = 60_000;

const lower = (a: McpAccessLevel, b: McpAccessLevel): McpAccessLevel => (mcpRank(a) <= mcpRank(b) ? a : b);

/**
 * Prüft das Bearer-Token einer MCP-Anfrage und baut den Benutzer LIVE aus der Datenbank (derselbe Weg wie der jwt()-
 * Callback in auth.config.ts). Stufe = Token-Umfang ∩ aktuelles mcpAccess - Rechteentzug, Deaktivierung und
 * Widerruf wirken dadurch bei der nächsten Anfrage.
 */
export async function authenticateBearer(authorization: string | null, now: Date = new Date()): Promise<McpAuthResult> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  if (!match) return INVALID;

  const token = await prisma.oauthToken.findUnique({
    where: { accessTokenHash: hashSecret(match[1]) },
    include: { oauthClient: true },
  });
  if (!token || token.revokedAt || token.expiresAt.getTime() <= now.getTime()) return INVALID;

  const dbUser = await findUserWithRelationsById(token.userId);
  if (!dbUser || !dbUser.isActive) return INVALID;

  const access = lower(scopeLevel(token.scope), dbUser.mcpAccess);
  if (access === 'NONE') return { ok: false, status: 403, error: 'insufficient_scope' };

  // Best-effort und gedrosselt (höchstens 1x/Minute je Token) - die Anzeige "zuletzt benutzt" ist nicht kritisch.
  if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    prisma.oauthToken.update({ where: { id: token.id }, data: { lastUsedAt: now } }).catch((error) => {
      console.error('[mcp] lastUsedAt des OAuth-Tokens konnte nicht aktualisiert werden:', safeErrorSummary(error));
    });
  }

  return {
    ok: true,
    principal: {
      user: await buildSessionUser(dbUser),
      access,
      clientId: token.oauthClient.clientId,
      clientName: token.oauthClient.name,
      tokenId: token.id,
    },
  };
}
