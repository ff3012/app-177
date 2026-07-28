import { randomBytes } from 'crypto';
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

export async function getDroneQuickRegisterToken(): Promise<string | null> {
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  return settings?.droneQuickRegisterToken ?? null;
}

/** Erzeugt (bzw. ersetzt) den Token für den QR-Code-Schnellerfassungslink. Ein bestehender Link/QR-Code wird dadurch sofort ungültig. */
export async function generateDroneQuickRegisterToken(): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, droneQuickRegisterToken: token },
    update: { droneQuickRegisterToken: token },
  });
  return token;
}
