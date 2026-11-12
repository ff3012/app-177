import type { z } from 'zod';
import type { ToolContext, ToolResult } from './context';

/*
 * Hinweis für Werkzeuge: Die Meldungen von `denied()`/`invalid()` landen bei Schreibwerkzeugen wörtlich im
 * Prüfprotokoll (und bei `denied()` auch bei Lesewerkzeugen) - sie müssen daher statische Texte sein und dürfen
 * nie Eingaben des Aufrufers wiedergeben.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** Mindeststufe: READ-Werkzeuge sehen alle, WRITE-Werkzeuge nur Benutzer mit WRITE. */
  access: 'READ' | 'WRITE';
  inputSchema: z.ZodRawShape;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: ToolContext, input: any) => Promise<ToolResult>;
}

/** Typisiert den Handler anhand des zod-Schemas; das Ergebnis ist für die Registrierung typgelöscht. */
export function defineTool<S extends z.ZodRawShape>(def: {
  name: string;
  description: string;
  access: 'READ' | 'WRITE';
  inputSchema: S;
  handler: (ctx: ToolContext, input: z.infer<z.ZodObject<S>>) => Promise<ToolResult>;
}): ToolDefinition {
  return def as ToolDefinition;
}
