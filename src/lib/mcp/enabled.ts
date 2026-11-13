import { prisma } from '@/lib/db/prisma';

const SETTINGS_ID = 'singleton';

/** Funktionsschalter des MCP-Connectors. Ohne AppSettings-Zeile gilt "aus". */
export async function isMcpEnabled(): Promise<boolean> {
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID }, select: { mcpEnabled: true } });
  return settings?.mcpEnabled ?? false;
}

export async function setMcpEnabled(enabled: boolean): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, mcpEnabled: enabled },
    update: { mcpEnabled: enabled },
  });
}
