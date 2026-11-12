import type { ToolDefinition } from './define';
import { listDienstgrade, listOrganizations } from './reference';
import { getUser, listUsers } from './users';

/** Alle Werkzeuge. Neue Werkzeuge werden hier eingetragen; die Stufe (READ/WRITE) steht am Werkzeug selbst. */
export const TOOLS: ToolDefinition[] = [listOrganizations, listDienstgrade, listUsers, getUser];
