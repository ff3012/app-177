import { prisma } from '@/lib/db/prisma';

const SETTINGS_ID = 'singleton';

export async function getDroneFlightNotificationEmail(): Promise<string | null> {
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  return settings?.droneFlightNotificationEmail ?? null;
}

export async function setDroneFlightNotificationEmail(email: string): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, droneFlightNotificationEmail: email },
    update: { droneFlightNotificationEmail: email },
  });
}
