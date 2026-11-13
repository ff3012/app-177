import { prisma } from '@/lib/db/prisma';

/** Aufbewahrung des Prüfprotokolls. Wird auch auf /admin/mcp angezeigt - dort bewusst aus dieser einen Konstante gelesen. */
export const MCP_AUDIT_RETENTION_DAYS = 180;
/**
 * Schonfrist für Token und Clients: Ein Token wird erst 30 Tage nach Widerruf bzw. nach Ablauf des Refresh-Tokens
 * gelöscht. Das hält die Verbindungsübersichten (Profil, Admin) stimmig und lässt die Wiederverwendung eines durch
 * Rotation ersetzten Refresh-Tokens noch lange nach der Rotation erkennbar (die Kette wird über Benutzer + Client
 * widerrufen, dafür muss die Zeile noch existieren). Registrierte, aber nie benutzte Clients werden nach derselben Frist entfernt.
 */
export const MCP_TOKEN_RETENTION_DAYS = 30;
/** Autorisierungscodes leben 60 Sekunden; einen Tag nach Ablauf sind sie (auch eingelöst) wertlos. */
const CODE_GRACE_DAYS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

export type McpPurgeResult = { audit: number; tokens: number; codes: number; clients: number };

/**
 * Tägliches Aufräumen. Jede Löschung hat einen expliziten, nie leeren Datumsfilter.
 * Reihenfolge: erst Token und Codes, DANACH verwaiste Clients - sonst wären Clients, deren letzte Token gerade
 * gelöscht wurden, in diesem Lauf noch "belegt".
 */
export async function purgeMcpData(now: Date = new Date()): Promise<McpPurgeResult> {
  const auditCutoff = new Date(now.getTime() - MCP_AUDIT_RETENTION_DAYS * DAY_MS);
  const tokenCutoff = new Date(now.getTime() - MCP_TOKEN_RETENTION_DAYS * DAY_MS);
  const codeCutoff = new Date(now.getTime() - CODE_GRACE_DAYS * DAY_MS);
  const clientCutoff = new Date(now.getTime() - MCP_TOKEN_RETENTION_DAYS * DAY_MS);

  const audit = await prisma.mcpAuditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } });
  const tokens = await prisma.oauthToken.deleteMany({
    where: { OR: [{ revokedAt: { lt: tokenCutoff } }, { refreshExpiresAt: { lt: tokenCutoff } }] },
  });
  const codes = await prisma.oauthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: codeCutoff } } });
  // Die Client-Registrierung ist unauthentifiziert; ohne diesen Schritt würden ungenutzte Clients unbegrenzt anwachsen.
  const clients = await prisma.oauthClient.deleteMany({
    where: { createdAt: { lt: clientCutoff }, tokens: { none: {} }, authCodes: { none: {} } },
  });
  return { audit: audit.count, tokens: tokens.count, codes: codes.count, clients: clients.count };
}
