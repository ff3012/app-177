import { describe, expect, it } from 'vitest';
import { buildNotificationMail } from './notify-notification-form';

const SENT_AT = new Date('2026-11-15T11:13:00Z'); // 12:13 in Wien

describe('buildNotificationMail', () => {
  it('Getränkeautomat: Betreff, Produkte, Anmerkung, Absender und Zeitpunkt', () => {
    const mail = buildNotificationMail({
      organizationName: 'FF Wolfsgraben',
      senderName: 'Franz Bichler',
      senderEmail: 'franz@example.local',
      sentAt: SENT_AT,
      input: { form: 'DRINKS', products: ['Bier', 'Eistee'], note: 'Automat blinkt' },
    });
    expect(mail.subject).toBe('Getränkeautomat: Produkte fehlen – FF Wolfsgraben');
    expect(mail.textPart).toContain('FF Wolfsgraben');
    expect(mail.textPart).toContain('Gemeldet von: Franz Bichler');
    expect(mail.textPart).toContain('12:13');
    expect(mail.textPart).toContain('Fehlende Produkte: Bier, Eistee');
    expect(mail.textPart).toContain('Anmerkung: Automat blinkt');
    expect(mail.htmlPart).toContain('Bier, Eistee');
  });

  it('Getränkeautomat ohne Anmerkung nennt keine Anmerkung', () => {
    const mail = buildNotificationMail({
      organizationName: 'FF X',
      senderName: 'A B',
      senderEmail: null,
      sentAt: SENT_AT,
      input: { form: 'DRINKS', products: ['Spezi'], note: null },
    });
    expect(mail.textPart).not.toContain('Anmerkung');
  });

  it('Schadensmeldung: AKUT-Vorsatz nur bei akut, "nicht angegeben" bei null, Datum im österreichischen Format', () => {
    const base = {
      organizationName: 'FF Wolfsgraben',
      senderName: 'Florian Krebs',
      senderEmail: 'f@example.local',
      sentAt: SENT_AT,
    };
    const acute = buildNotificationMail({
      ...base,
      input: { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Atemschutzgerät 3', acute: true, description: 'Maske undicht' },
    });
    expect(acute.subject).toBe('AKUT: Schadensmeldung: Atemschutzgerät 3 – FF Wolfsgraben');
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
      organizationName: 'FF <b>X</b>',
      senderName: 'A <script>',
      senderEmail: null,
      sentAt: SENT_AT,
      input: { form: 'DAMAGE', occurredOn: '2026-11-15', equipment: 'Rohr <i>', acute: null, description: 'Zeile 1\nZeile <2>' },
    });
    expect(mail.htmlPart).not.toContain('<script>');
    expect(mail.htmlPart).not.toContain('<b>X</b>');
    expect(mail.htmlPart).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(mail.htmlPart).toContain('Zeile 1<br>Zeile &lt;2&gt;');
  });
});
