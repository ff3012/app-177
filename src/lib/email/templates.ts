import { sendEmail } from './mailjet';

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

export async function sendActivationEmail(user: { email: string; firstName: string; lastName: string }, token: string) {
  const link = `${baseUrl()}/aktivieren/${token}`;
  await sendEmail({
    to: user.email,
    toName: `${user.firstName} ${user.lastName}`,
    subject: 'Willkommen – Benutzerkonto aktivieren',
    textPart: `Hallo ${user.firstName},\n\nfür dich wurde ein Benutzerkonto für die Feuerwehr-App Abschnitt Purkersdorf angelegt. Bitte aktiviere dein Konto und lege dein Passwort fest:\n\n${link}\n\nDer Link ist 7 Tage gültig.\n\nFeuerwehr Abschnitt Purkersdorf`,
    htmlPart: `<p>Hallo ${user.firstName},</p><p>für dich wurde ein Benutzerkonto für die Feuerwehr-App Abschnitt Purkersdorf angelegt. Bitte aktiviere dein Konto und lege dein Passwort fest:</p><p><a href="${link}">${link}</a></p><p>Der Link ist 7 Tage gültig.</p><p>Feuerwehr Abschnitt Purkersdorf</p>`,
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
