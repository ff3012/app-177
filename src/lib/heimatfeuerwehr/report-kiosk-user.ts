import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { hashPassword } from '@/lib/password';

const REPORT_KIOSK_EMAIL = 'berichte-schnellerfassung@system.local';

/** Ob eine E-Mail dem technischen Platzhalter der iPad-Schnellerfassung gehört (kein echter Mensch). */
export function isReportKioskEmail(email: string): boolean {
  return email === REPORT_KIOSK_EMAIL;
}

/**
 * Technischer Ersteller (`Report.createdById`) für Berichte der Schnellerfassung. `isActive: false`
 * und zufälliges Passwort: eine Anmeldung ist ausgeschlossen, der Weg läuft komplett an der Sitzung
 * vorbei (siehe /berichte-schnell/[token]). Die Heimatorganisation ist irgendein Abschnittskommando
 * (Pflichtfeld), nie eine Feuerwehr - der Platzhalter taucht deshalb in keiner Mitgliederliste einer
 * Feuerwehr auf.
 */
export async function getOrCreateReportKioskUser() {
  const existing = await prisma.user.findUnique({ where: { email: REPORT_KIOSK_EMAIL } });
  if (existing) return existing;

  const homeOrganization = await prisma.organization.findFirstOrThrow({ where: { type: 'ABSCHNITTSKOMMANDO' } });
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));

  try {
    return await prisma.user.create({
      data: {
        email: REPORT_KIOSK_EMAIL,
        passwordHash,
        firstName: 'Schnellerfassung',
        lastName: '(iPad)',
        isActive: false,
        homeOrganizationId: homeOrganization.id,
      },
    });
  } catch (error) {
    // Zwei gleichzeitige erste Abgaben: die zweite scheitert am Unique-Index der E-Mail - dann den
    // inzwischen angelegten Platzhalter laden.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.user.findUniqueOrThrow({ where: { email: REPORT_KIOSK_EMAIL } });
    }
    throw error;
  }
}
