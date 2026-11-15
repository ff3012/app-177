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
  members: [
    { id: '1', firstName: 'Bernd', lastName: 'Bauer' },
    { id: '2', firstName: 'Anna', lastName: 'Huber' },
  ],
  vehicles: [],
  recentKindsByType: { ACTIVITY: [], EXERCISE: [], INCIDENT: [] },
};

describe('KioskFlow', () => {
  it('beginnt mit der Namenswahl der Feuerwehr, in der übergebenen Reihenfolge', () => {
    const html = renderToStaticMarkup(createElement(KioskFlow, props));
    expect(html).toContain('FF Wolfsgraben');
    expect(html).toContain('Wer schreibt den Bericht?');
    expect(html.indexOf('Bauer Bernd')).toBeGreaterThan(-1);
    expect(html.indexOf('Bauer Bernd')).toBeLessThan(html.indexOf('Huber Anna'));
  });

  it('zeigt am Anfang noch keine Berichtsart und keinen Assistenten', () => {
    const html = renderToStaticMarkup(createElement(KioskFlow, props));
    expect(html).not.toContain('Welcher Bericht?');
    expect(html).not.toContain('data-layout="tablet"');
  });
});
