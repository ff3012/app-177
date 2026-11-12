import type { McpPrincipal } from '../auth';

/** Fehler, die dem Aufrufer (der KI) als verständliche Meldung zurückgegeben werden. denied = fehlendes Recht. */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly kind: 'denied' | 'invalid' = 'invalid',
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
export const denied = (message: string) => new ToolError(message, 'denied');
export const invalid = (message: string) => new ToolError(message, 'invalid');

export interface ToolContext {
  principal: McpPrincipal;
}

/** `audit` gesetzt = der Aufruf kommt ins Prüfprotokoll (Schreibaktionen). */
export interface ToolResult {
  data: unknown;
  audit?: { targetUserId?: string | null; summary: string };
}

const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 50;

export function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, 'base64url').toString());
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** `rows` wurden mit take: limit + 1 und skip: offset geladen; ein Überhang bedeutet "es gibt eine Folgeseite". */
export function toPage<T>(rows: T[], limit: number, offset: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  return { items: hasMore ? rows.slice(0, limit) : rows, nextCursor: hasMore ? encodeCursor(offset + limit) : null };
}
