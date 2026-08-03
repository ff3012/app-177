import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { hashPassword } from '@/lib/password';

const ICS_SYNC_EMAIL = 'kalender-ics-sync@system.local';

/**
 * Technischer Platzhalter-Benutzer für Termine, die per ICS-Sync importiert wurden (siehe
 * ics-import.ts) - kein echter Ersteller, sondern der createdById-Eintrag, da Event.createdById
 * eine Pflichtangabe ist. isActive=false, damit ein Login über das normale Anmeldeformular
 * ausgeschlossen ist - genau dasselbe Muster wie der QR-Schnellerfassungs-Benutzer der
 * Drohnengruppe (src/lib/drone/quick-register-user.ts).
 */
export async function getOrCreateIcsSyncUser() {
  const existing = await prisma.user.findUnique({ where: { email: ICS_SYNC_EMAIL } });
  if (existing) return existing;

  const homeOrganization = await prisma.organization.findFirstOrThrow({
    where: { type: 'ABSCHNITTSKOMMANDO' },
  });
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));

  return prisma.user.create({
    data: {
      email: ICS_SYNC_EMAIL,
      passwordHash,
      firstName: 'Kalender-Import',
      lastName: '(ICS-Sync)',
      isActive: false,
      homeOrganizationId: homeOrganization.id,
    },
  });
}
