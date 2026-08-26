import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email/mailjet';
import { escapeHtml } from '@/lib/email/escape-html';
import { getExpiryStatus, getFinnentestExpiryDate } from './atemschutz-status';

interface AtemschutzWarning {
  name: string;
  untersuchungBald: boolean;
  finnentestBald: boolean;
  atemschutzGueltigBis: Date | null;
  finnentestExpiryDate: Date | null;
}

/**
 * Täglich vom Cron-Job (/api/cron/atemschutz-warnung) aufgerufen. Anders als
 * notify-system-check.ts/notify-flight-created.ts (ein globaler Empfänger) ist der Empfänger hier
 * pro Feuerwehr hinterlegt (Organization.atemschutzSachbearbeiterEmail) - daher eine Schleife über
 * alle Feuerwehren statt eines einzelnen Sends, mit eigenem try/catch pro Org, damit ein
 * Mailjet-Fehler bei einer Feuerwehr die anderen nicht blockiert. Pro Org komplett stiller No-op,
 * wenn keine Adresse hinterlegt ist ODER nichts bald abläuft - keine Leer-Mails.
 */
export async function checkAndNotifyAtemschutzWarnungen(): Promise<void> {
  const orgs = await prisma.organization.findMany({
    where: { type: 'FEUERWEHR', atemschutzSachbearbeiterEmail: { not: null }, featureAtemschutz: true },
    select: { id: true, name: true, shortName: true, atemschutzSachbearbeiterEmail: true },
  });

  for (const org of orgs) {
    const recipient = org.atemschutzSachbearbeiterEmail;
    if (!recipient) continue;

    const members = await prisma.user.findMany({
      where: { homeOrganizationId: org.id, isActive: true, istAtemschutzgeraeteTraeger: true },
      select: {
        firstName: true,
        lastName: true,
        atemschutzGueltigBis: true,
        atemschutzFinnentestAm: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const warnings: AtemschutzWarning[] = members
      .map((member) => {
        const finnentestExpiryDate = getFinnentestExpiryDate(member.atemschutzFinnentestAm);
        return {
          name: `${member.lastName} ${member.firstName}`,
          untersuchungBald: getExpiryStatus(member.atemschutzGueltigBis) === 'laeuft_bald_ab',
          finnentestBald: getExpiryStatus(finnentestExpiryDate) === 'laeuft_bald_ab',
          atemschutzGueltigBis: member.atemschutzGueltigBis,
          finnentestExpiryDate,
        };
      })
      .filter((w) => w.untersuchungBald || w.finnentestBald);

    if (warnings.length === 0) continue;

    const orgLabel = org.shortName ?? org.name;

    try {
      await sendEmail({
        to: recipient,
        subject: `Atemschutz-Fristen laufen bald ab: ${orgLabel}`,
        textPart: [
          `Bei folgenden Mitgliedern von ${orgLabel} läuft demnächst eine Atemschutz-Frist ab:`,
          '',
          ...warnings.map((w) => {
            const parts: string[] = [];
            if (w.untersuchungBald) parts.push(`Untersuchung gültig bis ${w.atemschutzGueltigBis!.toLocaleDateString('de-AT')}`);
            if (w.finnentestBald) parts.push(`Finnentest gültig bis ${w.finnentestExpiryDate!.toLocaleDateString('de-AT')}`);
            return `- ${w.name}: ${parts.join(', ')}`;
          }),
          '',
          'Bezirksfeuerwehrkommando St. Pölten',
        ].join('\n'),
        htmlPart: [
          `<p>Bei folgenden Mitgliedern von ${escapeHtml(orgLabel)} läuft demnächst eine Atemschutz-Frist ab:</p>`,
          '<ul>',
          ...warnings.map((w) => {
            const parts: string[] = [];
            if (w.untersuchungBald) {
              parts.push(`Untersuchung gültig bis ${escapeHtml(w.atemschutzGueltigBis!.toLocaleDateString('de-AT'))}`);
            }
            if (w.finnentestBald) {
              parts.push(`Finnentest gültig bis ${escapeHtml(w.finnentestExpiryDate!.toLocaleDateString('de-AT'))}`);
            }
            return `<li>${escapeHtml(w.name)}: ${parts.join(', ')}</li>`;
          }),
          '</ul>',
          '<p>Bezirksfeuerwehrkommando St. Pölten</p>',
        ].join(''),
      });
    } catch (error) {
      console.error(`Atemschutz-Warnungs-E-Mail für ${orgLabel} fehlgeschlagen:`, error);
    }
  }
}
