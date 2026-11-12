import { getAtemschutzStatus } from './atemschutz';
import { listCalendarEvents } from './calendar';
import { createUserTool } from './create-user';
import type { ToolDefinition } from './define';
import { getDroneReadiness, listDroneFlights } from './drone';
import { listDienstgrade, listOrganizations } from './reference';
import { getUser, listUsers } from './users';

/** Alle Werkzeuge. Neue Werkzeuge werden hier eingetragen; die Stufe (READ/WRITE) steht am Werkzeug selbst. */
export const TOOLS: ToolDefinition[] = [listOrganizations, listDienstgrade, listUsers, getUser, getAtemschutzStatus, listDroneFlights, getDroneReadiness, listCalendarEvents, createUserTool];
