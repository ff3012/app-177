import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { hashPassword } from '@/lib/password';

const QUICK_REGISTER_EMAIL = 'drohnen-schnellerfassung@system.local';

/**
 * Technischer Platzhalter-Benutzer für Flüge, die über den QR-Code-Schnellerfassungslink
 * angelegt werden (kein echter Pilot, sondern der "registeredBy" Eintrag). isActive=false,
 * damit ein Login über das normale Anmeldeformular ausgeschlossen ist — dieser Weg läuft
 * komplett am Auth.js-Session-Flow vorbei (siehe /drohnen-schnell/[token]).
 */
export async function getOrCreateQuickRegisterUser() {
  const existing = await prisma.user.findUnique({ where: { email: QUICK_REGISTER_EMAIL } });
  if (existing) return existing;

  const homeOrganization = await prisma.organization.findFirstOrThrow({
    where: { type: 'ABSCHNITTSKOMMANDO' },
  });
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));

  return prisma.user.create({
    data: {
      email: QUICK_REGISTER_EMAIL,
      passwordHash,
      firstName: 'Schnellerfassung',
      lastName: '(QR-Code)',
      isActive: false,
      homeOrganizationId: homeOrganization.id,
    },
  });
}
