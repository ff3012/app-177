import { afterEach, describe, expect, it } from 'vitest';
import { buildNotificationMail, type NotificationMailContext } from './notify-notification-form';

const SENT_AT = new Date('2026-11-15T11:13:00Z'); // 12:13 in Wien

const base: Omit<NotificationMailContext, 'input'> = {
  organizationName: 'FF Wolfsgraben',
  organizationShortName: 'Wolfsgraben',
  senderName: 'Franz Bichler',
  senderEmail: 'franz@example.local',
  sentAt: SENT_AT,
  recipientFirstName: 'Max',
  recipientEmails: ['max@example.local', 'anna@example.local'],
};

const originalAuthUrl = process.env.AUTH_URL;
afterEach(() => {
  if (originalAuthUrl === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = originalAuthUrl;
});

describe('buildNotificationMail', () => {
  it('Getränkeautomat: Betreff, Produkte, Anmerkung, Absender und Zeitpunkt', () => {
    const mail = buildNotificationMail({ ...base, input: { form: 'DRINKS', products: ['Bier', 'Eistee'], note: 'Automat blinkt' } });
    expect(mail.subject).toBe('Getränkeautomat: Produkte fehlen – FF Wolfsgraben');
    expect(mail.textPart).toContain('Gemeldet von: Franz Bichler');
    expect(mail.textPart).toContain('12:13');
    expect(mail.textPart).toContain('Fehlende Produkte: Bier, Eistee');
    expect(mail.textPart).toContain('Anmerkung: Automat blinkt');
    expect(mail.htmlPart).toContain('Bier, Eistee');
  });

  it('Getränkeautomat: Text in der vorgegebenen Reihenfolge (Anrede, Einleitung, Angaben, Gruß, Hinweis, Empfänger)', () => {
    process.env.AUTH_URL = 'https://app-17.example.test/';
    const mail = buildNotificationMail({ ...base, input: { form: 'DRINKS', products: ['Bier', 'Eistee'], note: 'Bitte bis Freitag auffüllen' } });
    expect(mail.textPart).toBe(
      [
        'Hallo Max,',
        '',
        'eine neue Meldung zum Getränkeautomat in Feuerwehr Wolfsgraben ist eingegangen.',
        '',
        'Gemeldet von: Franz Bichler',
        'Zeitpunkt: 15.11.2026, 12:13',
        'Fehlende Produkte: Bier, Eistee',
        'Anmerkung: Bitte bis Freitag auffüllen',
        '',
        'Vielen Dank',
        'App-17',
        'https://app-17.example.test/',
        '',
        'Dies ist eine automatische E-Mail, bitte nicht darauf antworten.',
        '',
        'Ergeht an: max@example.local, anna@example.local',
      ].join('\n'),
    );
    expect(mail.htmlPart).toContain('<p>Hallo Max,</p>');
    expect(mail.htmlPart).toContain('<a href="https://app-17.example.test/">https://app-17.example.test/</a>');
    expect(mail.htmlPart).toContain('Ergeht an: max@example.local, anna@example.local');
  });

  it('ohne bekannten Vornamen wird neutral begrüßt, ohne AUTH_URL gilt die feste App-Adresse', () => {
    delete process.env.AUTH_URL;
    const mail = buildNotificationMail({ ...base, recipientFirstName: null, input: { form: 'DRINKS', products: ['Spezi'], note: null } });
    expect(mail.textPart.startsWith('Hallo,\n')).toBe(true);
    expect(mail.textPart).toContain('https://app-17.bfkdo-stpoelten.at/');
  });

  it('Getränkeautomat ohne Anmerkung nennt keine Anmerkung', () => {
    const mail = buildNotificationMail({ ...base, senderEmail: null, input: { form: 'DRINKS', products: ['Spezi'], note: null } });
    expect(mail.textPart).not.toContain('Anmerkung');
  });

  it('Schadensmeldung: AKUT-Vorsatz nur bei akut, "nicht angegeben" bei null, Datum im österreichischen Format', () => {
    const acute = buildNotificationMail({
      ...base,
      input: { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Atemschutzgerät 3', acute: true, description: 'Maske undicht' },
    });
    expect(acute.subject).toBe('AKUT: Schadensmeldung: Atemschutzgerät 3 – FF Wolfsgraben');
    expect(acute.textPart).toContain('eine neue Schadensmeldung in Feuerwehr Wolfsgraben ist eingegangen.');
    expect(acute.textPart).toContain('Akut: Ja');
    expect(acute.textPart).toContain('15.11.2026');
    expect(acute.textPart).toContain('Gerät / Ausrüstung: Atemschutzgerät 3');
    expect(acute.textPart).toContain('Maske undicht');

    const notAcute = buildNotificationMail({ ...base, input: { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Schlauch', acute: false, description: 'Riss' } });
    expect(notAcute.subject).toBe('Schadensmeldung: Schlauch – FF Wolfsgraben');
    expect(notAcute.textPart).toContain('Akut: Nein');

    const unknown = buildNotificationMail({ ...base, input: { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Schlauch', acute: null, description: 'Riss' } });
    expect(unknown.textPart).toContain('Akut: nicht angegeben');
  });

  it('maskiert Benutzereingaben im HTML und erhält Zeilenumbrüche der Beschreibung', () => {
    const mail = buildNotificationMail({
      ...base,
      organizationName: 'FF <b>X</b>',
      organizationShortName: 'X <i>',
      senderName: 'A <script>',
      senderEmail: null,
      recipientFirstName: 'Mo <b>',
      recipientEmails: ['a<u>@example.local'],
      input: { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Rohr <i>', acute: null, description: 'Zeile 1\nZeile <2>' },
    });
    expect(mail.htmlPart).not.toContain('<script>');
    expect(mail.htmlPart).not.toContain('<b>X</b>');
    expect(mail.htmlPart).not.toContain('Mo <b>');
    expect(mail.htmlPart).not.toContain('<u>');
    expect(mail.htmlPart).toContain('Feuerwehr X &lt;i&gt;');
    expect(mail.htmlPart).toContain('Hallo Mo &lt;b&gt;,');
    expect(mail.htmlPart).toContain('Zeile 1<br>Zeile &lt;2&gt;');
  });
});
