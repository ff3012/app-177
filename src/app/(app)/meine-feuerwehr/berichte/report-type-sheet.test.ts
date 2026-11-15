import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ReportTypeSheet } from './report-type-sheet';

function render(
  enabledTypes: string[],
  notificationStates: Record<string, 'available' | 'norecipient' | 'off'> = { DRINKS: 'available', DAMAGE: 'available' },
): string {
  return renderToStaticMarkup(createElement(ReportTypeSheet, { onClose: () => undefined, enabledTypes, notificationStates }));
}

describe('ReportTypeSheet', () => {
  it('zeigt eingeschaltete Arten antippbar und die übrigen gesperrt', () => {
    const html = render(['ACTIVITY']);
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Tätigkeitsbericht/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Tätigkeitsbericht/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Übungsbericht/);
  });

  it('beschriftet eine abgeschaltete freigeschaltete Art mit "Nicht aktiviert" und eine nicht freigeschaltete mit "Bald verfügbar"', () => {
    const html = render(['ACTIVITY']);
    expect(html).toContain('Nicht aktiviert');
    expect(html).toContain('Bald verfügbar');
  });

  it('sperrt alle Arten, wenn keine eingeschaltet ist', () => {
    const html = render([], { DRINKS: 'off', DAMAGE: 'off' });
    expect(html.match(/disabled=""/g)?.length).toBe(5);
  });
});

describe('ReportTypeSheet: Abschnitt Meldungen', () => {
  function buttonFor(html: string, title: string): string {
    const match = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${title}(?:(?!</button>).)*</button>`));
    return match ? match[0] : '';
  }

  it('zeigt den Abschnitt "Meldungen" mit beiden Formularen antippbar, wenn sie verfügbar sind', () => {
    const html = render(['ACTIVITY']);
    expect(html).toContain('Meldungen');
    expect(buttonFor(html, 'Getränkeautomat')).not.toBe('');
    expect(buttonFor(html, 'Getränkeautomat')).not.toContain('disabled=""');
    expect(buttonFor(html, 'Schadensmeldung')).not.toContain('disabled=""');
  });

  it('sperrt ein Formular ohne Empfänger ("Kein Empfänger hinterlegt") und ein abgeschaltetes ("Nicht aktiviert")', () => {
    const html = render(['ACTIVITY'], { DRINKS: 'norecipient', DAMAGE: 'off' });
    expect(buttonFor(html, 'Getränkeautomat')).toContain('disabled=""');
    expect(buttonFor(html, 'Getränkeautomat')).toContain('Kein Empfänger hinterlegt');
    expect(buttonFor(html, 'Schadensmeldung')).toContain('disabled=""');
    expect(buttonFor(html, 'Schadensmeldung')).toContain('Nicht aktiviert');
  });
});
