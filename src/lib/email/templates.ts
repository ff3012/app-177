import { sendEmail } from './mailjet';

function baseUrl(): string {
  return process.env.AUTH_URL?.replace(/\/$/, '') ?? '';
}

export async function sendActivationEmail(user: { email: string; firstName: string; lastName: string }, token: string) {
  const link = `${baseUrl()}/aktivieren/${token}`;
  const faqLink = `${baseUrl()}/how-to.html`;
  await sendEmail({
    to: user.email,
    toName: `${user.firstName} ${user.lastName}`,
    subject: 'BFKDO St. Pölten - Benutzerkonto aktivieren',
    textPart: [
      `Hallo ${user.firstName},`,
      '',
      'für dich wurde ein Benutzerkonto für die Feuerwehr-App BFKDO St. Pölten angelegt.',
      '',
      'Bitte aktiviere dein Konto und lege dein Passwort fest:',
      link,
      'Der Link ist 7 Tage gültig.',
      '',
      'In der neuen App hast du folgende Funktionen',
      '',
      '* Kalender für alle Termine im Bezirk, Abschnitt und Feuerwehr',
      '* Verwaltung Drohnengruppe BFKDO St. Pölten',
      '',
      'Es freut uns dich in der neuen App bald zu sehen.',
      '',
      'Häufige Fragen (z. B. wie du die App aufs Handy installierst oder ein neues Passwort setzt) findest du hier:',
      faqLink,
      '',
      'Feedback kannst du gerne direkt in der App mit uns teilen.',
      '',
      'Mit kameradschaftlichen Grüßen',
      'AFKDO Purkersdorf',
      '',
      'Diese App wird vom Abschnittsfeuerwehrkommando Purkersdorf zur Verfügung gestellt. Fragen an Florian Krebs florian.krebs@feuerwehr.gv.at',
    ].join('\n'),
    htmlPart: [
      `<p>Hallo ${user.firstName},</p>`,
      '<p>für dich wurde ein Benutzerkonto für die Feuerwehr-App BFKDO St. Pölten angelegt.</p>',
      `<p>Bitte aktiviere dein Konto und lege dein Passwort fest:<br><a href="${link}">${link}</a><br>Der Link ist 7 Tage gültig.</p>`,
      '<p>In der neuen App hast du folgende Funktionen</p>',
      '<ul><li>Kalender für alle Termine im Bezirk, Abschnitt und Feuerwehr</li><li>Verwaltung Drohnengruppe BFKDO St. Pölten</li></ul>',
      '<p>Es freut uns dich in der neuen App bald zu sehen.</p>',
      `<p>Häufige Fragen (z. B. wie du die App aufs Handy installierst oder ein neues Passwort setzt) findest du hier:<br><a href="${faqLink}">${faqLink}</a></p>`,
      '<p>Feedback kannst du gerne direkt in der App mit uns teilen.</p>',
      '<p>Mit kameradschaftlichen Grüßen<br>AFKDO Purkersdorf</p>',
      '<p>Diese App wird vom Abschnittsfeuerwehrkommando Purkersdorf zur Verfügung gestellt. Fragen an Florian Krebs ' +
        '<a href="mailto:florian.krebs@feuerwehr.gv.at">florian.krebs@feuerwehr.gv.at</a></p>',
    ].join(''),
  });
}

export async function sendPasswordResetEmail(user: { email: string; firstName: string; lastName: string }, token: string) {
  const link = `${baseUrl()}/passwort-zuruecksetzen/${token}`;
  const faqLink = `${baseUrl()}/how-to.html`;
  await sendEmail({
    to: user.email,
    toName: `${user.firstName} ${user.lastName}`,
    subject: 'Passwort zurücksetzen',
    textPart: `Hallo ${user.firstName},\n\ndu hast ein neues Passwort angefordert. Über folgenden Link kannst du ein neues Passwort setzen:\n\n${link}\n\nDer Link ist 1 Stunde gültig. Falls du das nicht warst, kannst du diese E-Mail ignorieren.\n\nHäufige Fragen zur App findest du hier:\n${faqLink}\n\nDiese E-Mail wurde automatisch versendet, bitte nicht direkt darauf antworten. Bei Fragen wende dich an florian.krebs@feuerwehr.gv.at.\n\nAbschnittsfeuerwehrkommando Purkersdorf`,
    htmlPart: `<p>Hallo ${user.firstName},</p><p>du hast ein neues Passwort angefordert. Über folgenden Link kannst du ein neues Passwort setzen:</p><p><a href="${link}">${link}</a></p><p>Der Link ist 1 Stunde gültig. Falls du das nicht warst, kannst du diese E-Mail ignorieren.</p><p>Häufige Fragen zur App findest du hier:<br><a href="${faqLink}">${faqLink}</a></p><p>Diese E-Mail wurde automatisch versendet, bitte nicht direkt darauf antworten. Bei Fragen wende dich an <a href="mailto:florian.krebs@feuerwehr.gv.at">florian.krebs@feuerwehr.gv.at</a>.</p><p>Abschnittsfeuerwehrkommando Purkersdorf</p>`,
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
      'Code und Link sind 5 Minuten gültig und einmalig verwendbar (beide gehören zur selben Anmeldung -',
      'sobald einer verwendet wurde, wird auch der andere ungültig). Falls du das nicht warst, kannst du',
      'diese E-Mail ignorieren.',
      '',
      'Diese E-Mail wurde automatisch versendet, bitte nicht direkt darauf antworten. Bei Fragen wende dich an',
      'florian.krebs@feuerwehr.gv.at.',
      '',
      'Abschnittsfeuerwehrkommando Purkersdorf',
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
      '<p>Code und Link sind 5 Minuten gültig und einmalig verwendbar (beide gehören zur selben Anmeldung - ' +
        'sobald einer verwendet wurde, wird auch der andere ungültig). Falls du das nicht warst, kannst du diese ' +
        'E-Mail ignorieren.</p>',
      '<p>Diese E-Mail wurde automatisch versendet, bitte nicht direkt darauf antworten. Bei Fragen wende dich an ' +
        '<a href="mailto:florian.krebs@feuerwehr.gv.at">florian.krebs@feuerwehr.gv.at</a>.</p>',
      '<p>Abschnittsfeuerwehrkommando Purkersdorf</p>',
    ].join(''),
  });
}
