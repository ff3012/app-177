import { describe, expect, it } from 'vitest';
import { generateChecklistPdf, type ChecklistPdfData } from './pdf';

const base: ChecklistPdfData = {
  id: 'cl_test_1',
  groupName: 'AFKDO Purkersdorf',
  flightAt: new Date('2026-06-15T08:05:00Z'),
  pilotName: 'Lukas Pichler',
  teamleiterName: 'Anna Huber',
  abschnittsleiterName: null,
  helferNames: ['Max Muster'],
  droneNames: ['Drohne 1'],
  submittedAt: new Date('2026-06-15T09:00:00Z'),
  confirmedBy: { name: 'Lukas Pichler', forPilot: false },
  data: {
    art: 'Einsatz',
    gebiet: 'Steinbruch',
    gemeinde: 'Pressbaum',
    grundlage: 'open',
    openKat: 'A2',
    sicht: 'VLOS',
    hoehe: 60,
    hindernis: 25,
    checks: { p_gesund: true, p_fs: true, b_start: true },
    kommentar15: 'Akku der Fernsteuerung nur 18 %',
    fluege: [{ akku: 'A1', uVor: '100', uNach: '60', start: '10:05', landung: '10:20', zw: true }],
    abm: { el: '2026-06-15T09:30:00.000Z', lst: null },
    anmerkungen: 'Alles ohne Besonderheiten <b>fett</b> & "Anführungszeichen"',
    bestaetigt: true,
  },
};

describe('generateChecklistPdf', () => {
  it('erzeugt ein PDF mit Inhalt', async () => {
    const pdf = await generateChecklistPdf(base);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
  }, 30000);

  it('kommt auch mit einer fast leeren Checkliste zurecht', async () => {
    const pdf = await generateChecklistPdf({ ...base, data: {}, teamleiterName: null, helferNames: [], droneNames: [], confirmedBy: null });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);
});
