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

export async function sendLoginTokenEmail(user: { email: string; firstName: string; lastName: string }, token: string) {
  const link = `${baseUrl()}/login/token/${token}`;
  await sendEmail({
    to: user.email,
    toName: `${user.firstName} ${user.lastName}`,
    subject: 'Dein Anmeldelink',
    textPart: `Hallo ${user.firstName},\n\ndu hast eine Anmeldung per E-Mail-Link angefordert. Über folgenden Link kannst du dich anmelden:\n\n${link}\n\nDer Link ist 15 Minuten gültig und einmalig verwendbar. Falls du das nicht warst, kannst du diese E-Mail ignorieren.\n\nFeuerwehr Abschnitt Purkersdorf`,
    htmlPart: `<p>Hallo ${user.firstName},</p><p>du hast eine Anmeldung per E-Mail-Link angefordert. Über folgenden Link kannst du dich anmelden:</p><p><a href="${link}">${link}</a></p><p>Der Link ist 15 Minuten gültig und einmalig verwendbar. Falls du das nicht warst, kannst du diese E-Mail ignorieren.</p><p>Feuerwehr Abschnitt Purkersdorf</p>`,
  });
}
