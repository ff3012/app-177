import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildChecklistMail,
  checklistMailSubject,
  checklistPdfFileName,
  getMailMode,
  resolveMailRecipients,
  sendChecklistMails,
} from './mail';

describe('checklistPdfFileName', () => {
  it('baut den Namen aus Datum (Wien) und Fluggebiet', () => {
    expect(checklistPdfFileName(new Date('2026-06-15T08:05:00Z'), 'Steinbruch')).toBe('Checkliste_Drohnenflug_2026-06-15_Steinbruch.pdf');
  });

  it('ersetzt Sonderzeichen und Umlaute durch ASCII', () => {
    expect(checklistPdfFileName(new Date('2026-06-15T08:05:00Z'), 'St. Pölten / Süd')).toBe('Checkliste_Drohnenflug_2026-06-15_St_Poelten_Sued.pdf');
  });

  it('nutzt "ohne_Fluggebiet", wenn kein Gebiet gesetzt ist', () => {
    expect(checklistPdfFileName(new Date('2026-06-15T08:05:00Z'), null)).toBe('Checkliste_Drohnenflug_2026-06-15_ohne_Fluggebiet.pdf');
  });

  it('rechnet das Datum in Wiener Ortszeit (23:30 UTC ist schon der nächste Tag)', () => {
    expect(checklistPdfFileName(new Date('2026-12-15T23:30:00Z'), 'X')).toBe('Checkliste_Drohnenflug_2026-12-16_X.pdf');
  });
});

describe('checklistMailSubject', () => {
  it('folgt dem Schema aus dem Brief', () => {
    expect(checklistMailSubject({ purpose: 'EINSATZ', area: 'Steinbruch', flightAt: new Date('2026-06-15T08:05:00Z') })).toBe(
      'Checkliste Drohnenflug · Einsatz · Steinbruch · 15.06.2026 10:05',
    );
  });

  it('übersetzt TRAINING und kennt Ersatztexte', () => {
    expect(checklistMailSubject({ purpose: 'TRAINING', area: null, flightAt: new Date('2026-12-15T09:00:00Z') })).toBe(
      'Checkliste Drohnenflug · Training · ohne Fluggebiet · 15.12.2026 10:00',
    );
    expect(checklistMailSubject({ purpose: null, area: 'A', flightAt: new Date('2026-12-15T09:00:00Z') })).toContain('· Flug ·');
  });
});

describe('resolveMailRecipients', () => {
  it('behält gültige Adressen, trimmt, entfernt Doppelte und ungültige', () => {
    expect(resolveMailRecipients([' a@ff.gv.at ', 'a@ff.gv.at', 'kaputt', '', 'b@ff.gv.at'])).toEqual(['a@ff.gv.at', 'b@ff.gv.at']);
  });
});

describe('buildChecklistMail', () => {
  const base = {
    groupName: 'AFKDO Purkersdorf',
    pilotName: 'Lukas Pichler',
    droneNames: ['Drohne 1', 'Drohne 3'],
    grundlage: 'open' as const,
    openKat: 'A2' as const,
    hoehe: 60,
    flightCount: 2,
    openComments: [{ label: 'Vorflugkontrolle Nr. 15–16', comment: 'Akku defekt' }],
    link: 'https://app.example/drohnen/checkliste/abc/fertig',
  };

  it('nennt Gruppe, Pilot, Drohnen, Grundlage, Höhe samt Abstand, Flüge, Kommentar und Link', () => {
    const { text, html } = buildChecklistMail(base);
    for (const part of ['AFKDO Purkersdorf', 'Lukas Pichler', 'Drohne 1, Drohne 3', 'Kategorie OPEN A2', '60 m', 'Abstand Menschenansammlungen: 192,0 m', '2', 'Akku defekt', base.link]) {
      expect(text).toContain(part);
    }
    expect(html).toContain('Akku defekt');
  });

  it('maskiert HTML in Freitexten', () => {
    const { html } = buildChecklistMail({ ...base, openComments: [{ label: 'x', comment: '<script>alert(1)</script>' }] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('lässt den Abschnitt offene Punkte weg, wenn es keine gibt', () => {
    expect(buildChecklistMail({ ...base, openComments: [] }).text).not.toContain('Offene Punkte');
  });
});

describe('getMailMode', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('ist live, solange nichts gesetzt ist - Testbetrieb muss ausdrücklich eingeschaltet werden', () => {
    vi.stubEnv('MAIL_MODE', '');
    expect(getMailMode()).toBe('live');
  });

  it('erkennt log (unabhängig von Groß-/Kleinschreibung)', () => {
    vi.stubEnv('MAIL_MODE', 'LOG');
    expect(getMailMode()).toBe('log');
  });
});

describe('sendChecklistMails', () => {
  afterEach(() => vi.unstubAllEnvs());
  const pdf = Buffer.from('%PDF-test');
  const mail = { subject: 'S', text: 'T', html: '<p>T</p>', fileName: 'x.pdf', pdf };

  it('sendet im log-Modus nichts, meldet das aber als nicht versendet', async () => {
    vi.stubEnv('MAIL_MODE', 'log');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sender = vi.fn();
    const result = await sendChecklistMails(['a@ff.gv.at', 'b@ff.gv.at'], mail, sender);
    expect(sender).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0].join(' ')).toContain('a@ff.gv.at');
    expect(result).toEqual({ mode: 'log', attempted: 2, failed: 0, sentTo: [] });
    log.mockRestore();
  });

  it('sendet im live-Modus je Adresse eine eigene Mail mit PDF-Anhang', async () => {
    vi.stubEnv('MAIL_MODE', 'live');
    const sender = vi.fn().mockResolvedValue(undefined);
    const result = await sendChecklistMails(['a@ff.gv.at', 'b@ff.gv.at'], mail, sender);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[0][0]).toMatchObject({ to: 'a@ff.gv.at', subject: 'S', attachments: [{ filename: 'x.pdf', contentType: 'application/pdf', content: pdf }] });
    expect(result).toEqual({ mode: 'live', attempted: 2, failed: 0, sentTo: ['a@ff.gv.at', 'b@ff.gv.at'] });
  });

  it('zählt Fehler einzelner Empfänger, ohne die übrigen zu blockieren', async () => {
    vi.stubEnv('MAIL_MODE', 'live');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sender = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const result = await sendChecklistMails(['a@ff.gv.at', 'b@ff.gv.at'], mail, sender);
    expect(result).toEqual({ mode: 'live', attempted: 2, failed: 1, sentTo: ['b@ff.gv.at'] });
    err.mockRestore();
  });
});
