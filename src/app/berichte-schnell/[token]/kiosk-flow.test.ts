import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: (props: { href: string; children?: unknown }) => createElement('a', { href: props.href }, props.children as never),
}));
vi.mock('./actions', () => ({ submitReportViaKiosk: vi.fn(), submitNotificationViaKiosk: vi.fn() }));
vi.mock('@/app/(app)/meine-feuerwehr/berichte/submit-actions', () => ({ submitReport: vi.fn() }));

import { KioskFlow } from './kiosk-flow';

const props: Parameters<typeof KioskFlow>[0] = {
  token: 't'.repeat(32),
  organizationName: 'FF Wolfsgraben',
  deviceName: 'Tablet Feuerwehr EG',
  enabledTypes: ['ACTIVITY', 'EXERCISE'],
  notificationForms: {
    DRINKS: { state: 'available', products: ['Bier', 'Spritzer'] },
    DAMAGE: { state: 'norecipient', products: [] },
  },
  members: [
    { id: '1', firstName: 'Bernd', lastName: 'Bauer' },
    { id: '2', firstName: 'Anna', lastName: 'Huber' },
  ],
  vehicles: [],
  recentKindsByType: { ACTIVITY: [], EXERCISE: [] },
};

function render(over: Partial<Parameters<typeof KioskFlow>[0]> = {}): string {
  return renderToStaticMarkup(createElement(KioskFlow, { ...props, ...over }));
}

function buttonFor(html: string, title: string): string {
  const match = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${title}(?:(?!</button>).)*</button>`));
  return match ? match[0] : '';
}

describe('KioskFlow: Startbildschirm', () => {
  it('beginnt mit "Welches Formular ausfüllen?", Feuerwehrname und Gerätename, ohne Namensliste', () => {
    const html = render();
    expect(html).toContain('Welches Formular ausfüllen?');
    expect(html).toContain('FF Wolfsgraben');
    expect(html).toContain('Tablet Feuerwehr EG');
    expect(html).not.toContain('Bauer Bernd');
    expect(html).not.toContain('Wer schreibt den Bericht?');
    expect(html).not.toContain('data-layout="tablet"');
  });

  it('zeigt alle fünf Kacheln; Tätigkeits- und Übungsbericht sind antippbar, der Einsatzbericht gesperrt mit Hinweis', () => {
    const html = render();
    for (const title of ['Tätigkeitsbericht', 'Übungsbericht', 'Einsatzbericht', 'Getränkeautomat', 'Schadensmeldung']) {
      expect(buttonFor(html, title)).not.toBe('');
    }
    expect(buttonFor(html, 'Tätigkeitsbericht')).not.toContain('disabled=""');
    expect(buttonFor(html, 'Übungsbericht')).not.toContain('disabled=""');
    expect(buttonFor(html, 'Einsatzbericht')).toContain('disabled=""');
    expect(buttonFor(html, 'Einsatzbericht')).toContain('Bald verfügbar');
  });

  it('zeigt die Meldekacheln: Getränkeautomat antippbar, Schadensmeldung ohne Empfänger gesperrt mit Hinweis', () => {
    const html = render();
    expect(buttonFor(html, 'Getränkeautomat')).not.toContain('disabled=""');
    expect(buttonFor(html, 'Schadensmeldung')).toContain('disabled=""');
    expect(buttonFor(html, 'Schadensmeldung')).toContain('Kein Empfänger hinterlegt');
    expect(buttonFor(html, 'Einsatzbericht')).toContain('Bald verfügbar');
  });

  it('zeigt ein abgeschaltetes Meldeformular als "Nicht aktiviert"', () => {
    const html = render({
      notificationForms: { DRINKS: { state: 'off', products: [] }, DAMAGE: { state: 'available', products: [] } },
    });
    expect(buttonFor(html, 'Getränkeautomat')).toContain('disabled=""');
    expect(buttonFor(html, 'Getränkeautomat')).toContain('Nicht aktiviert');
    expect(buttonFor(html, 'Schadensmeldung')).not.toContain('disabled=""');
  });

  it('zeigt eine abgeschaltete Art gesperrt mit "Nicht aktiviert"', () => {
    const html = render({ enabledTypes: ['ACTIVITY'] });
    expect(buttonFor(html, 'Übungsbericht')).toContain('disabled=""');
    expect(buttonFor(html, 'Übungsbericht')).toContain('Nicht aktiviert');
  });

  it('weist darauf hin, wenn kein Formular verfügbar ist', () => {
    const html = render({
      enabledTypes: [],
      notificationForms: { DRINKS: { state: 'off', products: [] }, DAMAGE: { state: 'norecipient', products: [] } },
    });
    expect(html).toContain('Aktuell ist kein Formular verfügbar.');
  });

  it('lässt die Gerätekarte ohne Gerätenamen aus', () => {
    const html = render({ deviceName: null });
    expect(html).not.toContain('Tablet Feuerwehr EG');
    expect(html).not.toContain('Gerät');
  });
});
