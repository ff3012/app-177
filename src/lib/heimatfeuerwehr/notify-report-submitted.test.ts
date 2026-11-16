import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from '@/lib/email/mailjet';
import { sendReportSubmittedEmail, type ReportSubmittedEmailContext } from './notify-report-submitted';

vi.mock('@/lib/email/mailjet', () => ({ sendEmail: vi.fn(async () => undefined) }));

const context: ReportSubmittedEmailContext = {
  number: 7,
  year: 2026,
  type: 'ACTIVITY',
  fireDepartmentName: 'FF Wolfsgraben',
  wappenDataUri: null,
  filledByName: 'Max Mustermann',
  filledByStbNr: '12',
  startAt: new Date('2026-11-15T08:00:00Z'),
  endAt: new Date('2026-11-15T10:00:00Z'),
  ownActivity: true,
  activityKinds: [],
  activityOther: 'Schlauchpflege',
  vehicles: [],
  remark: 'Alles in Ordnung',
  members: [],
  materials: [],
  equipment: [],
  uebungsleiterName: null,
  uebungsueberwachungName: null,
  uebungsbeobachterName: null,
  uebungsortStrasse: null,
  uebungsortNr: null,
  uebungsortPlz: null,
  uebungsortOrt: null,
  weitereFeuerwehren: null,
  uebungsziel: null,
  uebungslage: null,
  uebungsdarstellung: null,
  fuerUebungVerstaendigen: null,
  uebungserkenntnis: null,
  uebungszielsetzung: null,
  vorschlaege: null,
  fireDepartmentEmails: ['a@example.local', 'b@example.local'],
  filledByEmail: 'max@example.local',
};

const originalAuthUrl = process.env.AUTH_URL;

beforeEach(() => {
  vi.mocked(sendEmail).mockClear();
  process.env.AUTH_URL = 'https://app-17.example.test';
});
afterEach(() => {
  if (originalAuthUrl === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = originalAuthUrl;
});

describe('sendReportSubmittedEmail: Fuß', () => {
  for (const type of ['ACTIVITY', 'EXERCISE'] as const) {
    it(`${type}: Text und HTML enden mit Gruß, App-Link, Hinweis und Empfängerliste`, async () => {
      await sendReportSubmittedEmail({ ...context, type }, Buffer.from('pdf'), 'bericht.pdf');
      const calls = vi.mocked(sendEmail).mock.calls.map((call) => call[0]);
      expect(calls.map((call) => call.to)).toEqual(['a@example.local', 'b@example.local']);
      for (const call of calls) {
        expect(call.textPart?.endsWith(
          'Vielen Dank\nApp-17\nhttps://app-17.example.test/\n\nDies ist eine automatische E-Mail, bitte nicht darauf antworten.\n\nErgeht an: a@example.local, b@example.local',
        )).toBe(true);
        expect(call.htmlPart?.endsWith('<p>Ergeht an: a@example.local, b@example.local</p>')).toBe(true);
        expect(call.htmlPart).toContain('<a href="https://app-17.example.test/">');
        expect(call.replyTo).toBe('max@example.local');
      }
    });
  }
});
