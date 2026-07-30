import { sendEmail } from './mailjet';

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

export async function sendActivationEmail(user: { email: string; firstName: string; lastName: string }, token: string) {
  const link = `${baseUrl()}/aktivieren/${token}`;
  await sendEmail({
    to: user.email,
    toName: `${user.firstName} ${user.lastName}`,
    subject: 'AFKDO Purkersdorf - Benutzerkonto aktivieren',
    textPart: [
      `Hallo ${user.firstName},`,
      '',
      'für dich wurde ein Benutzerkonto für die Feuerwehr-App AFKDO Purkersdorf angelegt.',
      '',
      'Bitte aktiviere dein Konto und lege dein Passwort fest:',
      link,
      'Der Link ist 7 Tage gültig.',
      '',
      'In der neuen App hast du folgende Funktionen',
      '',
      '* Kalender für alle Termine im Abschnitt Purkersdorf',
      '* Verwaltung Drohnengruppe AFKDO Purkersdorf',
      '',
      'Es freut uns dich in der neuen AFKDO App bald zu sehen.',
      '',
      'Feedback kannst du gerne direkt in der App mit uns teilen.',
      '',
      'Mit kameradschaftlichen Grüßen',
      'Dein AFKDO Purkersdorf',
    ].join('\n'),
    htmlPart: [
      `<p>Hallo ${user.firstName},</p>`,
      '<p>für dich wurde ein Benutzerkonto für die Feuerwehr-App AFKDO Purkersdorf angelegt.</p>',
      `<p>Bitte aktiviere dein Konto und lege dein Passwort fest:<br><a href="${link}">${link}</a><br>Der Link ist 7 Tage gültig.</p>`,
      '<p>In der neuen App hast du folgende Funktionen</p>',
      '<ul><li>Kalender für alle Termine im Abschnitt Purkersdorf</li><li>Verwaltung Drohnengruppe AFKDO Purkersdorf</li></ul>',
      '<p>Es freut uns dich in der neuen AFKDO App bald zu sehen.</p>',
      '<p>Feedback kannst du gerne direkt in der App mit uns teilen.</p>',
      '<p>Mit kameradschaftlichen Grüßen<br>Dein AFKDO Purkersdorf</p>',
    ].join(''),
  });
}

export async function sendPasswordResetEmail(user: { email: string; firstName: string; lastName: string }, token: string) {
  const link = `${baseUrl()}/passwort-zuruecksetzen/${token}`;
  await sendEmail({
    to: user.email,
    toName: `${user.firstName} ${user.lastName}`,
    subject: 'Passwort zurücksetzen',
    textPart: `Hallo ${user.firstName},\n\ndu hast ein neues Passwort angefordert. Über folgenden Link kannst du ein neues Passwort setzen:\n\n${link}\n\nDer Link ist 1 Stunde gültig. Falls du das nicht warst, kannst du diese E-Mail ignorieren.\n\nFeuerwehr Abschnitt Purkersdorf`,
    htmlPart: `<p>Hallo ${user.firstName},</p><p>du hast ein neues Passwort angefordert. Über folgenden Link kannst du ein neues Passwort setzen:</p><p><a href="${link}">${link}</a></p><p>Der Link ist 1 Stunde gültig. Falls du das nicht warst, kannst du diese E-Mail ignorieren.</p><p>Feuerwehr Abschnitt Purkersdorf</p>`,
  });
}

export async function sendLoginTokenEmail(
  user: { email: string; firstName: string; lastName: string },
  token: string,
  shortCode: string,
) {
  const link = `${baseUrl()}/login/token/${token}`;
  await sendEmail({
    to: user.email,
    toName: `${user.firstName} ${user.lastName}`,
    subject: 'Dein Anmeldelink',
    textPart: [
      `Hallo ${user.firstName},`,
      '',
      'du hast eine Anmeldung per E-Mail angefordert.',
      '',
      'Am Computer oder im normalen Browser: Über folgenden Link kannst du dich anmelden:',
      link,
      '',
      'Nutzt du die App-177 vom Homescreen aus (iPhone/iPad)? Dann öffne den Link oben NICHT - er würde',
      'nur in Safari anmelden, nicht in der bereits installierten App. Gib stattdessen diesen Code',
      'direkt in der App im Feld "Code aus E-Mail einfügen" ein:',
      '',
      shortCode,
      '',
      'Code und Link sind 15 Minuten gültig und einmalig verwendbar (beide gehören zur selben Anmeldung -',
      'sobald einer verwendet wurde, wird auch der andere ungültig). Falls du das nicht warst, kannst du',
      'diese E-Mail ignorieren.',
      '',
      'Feuerwehr Abschnitt Purkersdorf',
    ].join('\n'),
    htmlPart: [
      `<p>Hallo ${user.firstName},</p>`,
      '<p>du hast eine Anmeldung per E-Mail angefordert.</p>',
      '<p>Am Computer oder im normalen Browser: Über folgenden Link kannst du dich anmelden:</p>',
      `<p><a href="${link}">${link}</a></p>`,
      '<p>Nutzt du die App-177 vom Homescreen aus (iPhone/iPad)? Dann öffne den Link oben <strong>nicht</strong> - ' +
        'er würde nur in Safari anmelden, nicht in der bereits installierten App. Gib stattdessen diesen Code ' +
        'direkt in der App im Feld „Code aus E-Mail einfügen" ein:</p>',
      `<p style="font-family: monospace; font-size: 24px; letter-spacing: 4px; background: #f4f4f4; padding: 12px 16px; border-radius: 4px; text-align: center;">${shortCode}</p>`,
      '<p>Code und Link sind 15 Minuten gültig und einmalig verwendbar (beide gehören zur selben Anmeldung - ' +
        'sobald einer verwendet wurde, wird auch der andere ungültig). Falls du das nicht warst, kannst du diese ' +
        'E-Mail ignorieren.</p>',
      '<p>Feuerwehr Abschnitt Purkersdorf</p>',
    ].join(''),
  });
}
