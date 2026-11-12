import type { ToolDefinition } from './define';
import { listDienstgrade, listOrganizations } from './reference';

/** Alle Werkzeuge. Neue Werkzeuge werden hier eingetragen; die Stufe (READ/WRITE) steht am Werkzeug selbst. */
export const TOOLS: ToolDefinition[] = [listOrganizations, listDienstgrade];
