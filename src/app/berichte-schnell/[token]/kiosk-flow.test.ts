import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: (props: { href: string; children?: unknown }) => createElement('a', { href: props.href }, props.children as never),
}));
vi.mock('./actions', () => ({ submitReportViaKiosk: vi.fn() }));
vi.mock('@/app/(app)/meine-feuerwehr/berichte/submit-actions', () => ({ submitReport: vi.fn() }));

import { KioskFlow } from './kiosk-flow';

const props = {
  token: 't'.repeat(32),
  organizationName: 'FF Wolfsgraben',
  deviceName: 'Tablet Feuerwehr EG' as string | null,
  enabledTypes: ['ACTIVITY', 'EXERCISE'],
  members: [
    { id: '1', firstName: 'Bernd', lastName: 'Bauer' },
    { id: '2', firstName: 'Anna', lastName: 'Huber' },
  ],
  vehicles: [],
  recentKindsByType: { ACTIVITY: [], EXERCISE: [] },
};

function render(over: Partial<typeof props> = {}): string {
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

  it('zeigt alle fünf Kacheln; Tätigkeits- und Übungsbericht sind antippbar, die übrigen gesperrt mit Hinweis', () => {
    const html = render();
    for (const title of ['Tätigkeitsbericht', 'Übungsbericht', 'Einsatzbericht', 'Getränkeautomat', 'Schadensmeldung']) {
      expect(buttonFor(html, title)).not.toBe('');
    }
    expect(buttonFor(html, 'Tätigkeitsbericht')).not.toContain('disabled=""');
    expect(buttonFor(html, 'Übungsbericht')).not.toContain('disabled=""');
    for (const title of ['Einsatzbericht', 'Getränkeautomat', 'Schadensmeldung']) {
      expect(buttonFor(html, title)).toContain('disabled=""');
      expect(buttonFor(html, title)).toContain('Bald verfügbar');
    }
  });

  it('zeigt eine abgeschaltete Art gesperrt mit "Nicht aktiviert"', () => {
    const html = render({ enabledTypes: ['ACTIVITY'] });
    expect(buttonFor(html, 'Übungsbericht')).toContain('disabled=""');
    expect(buttonFor(html, 'Übungsbericht')).toContain('Nicht aktiviert');
  });

  it('weist darauf hin, wenn kein Formular verfügbar ist', () => {
    const html = render({ enabledTypes: [] });
    expect(html).toContain('Aktuell ist kein Formular verfügbar.');
  });

  it('lässt die Gerätekarte ohne Gerätenamen aus', () => {
    const html = render({ deviceName: null });
    expect(html).not.toContain('Tablet Feuerwehr EG');
    expect(html).not.toContain('Gerät');
  });
});
