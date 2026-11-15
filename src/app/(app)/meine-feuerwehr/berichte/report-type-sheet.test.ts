import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ReportTypeSheet } from './report-type-sheet';

function render(enabledTypes: string[]): string {
  return renderToStaticMarkup(createElement(ReportTypeSheet, { onClose: () => undefined, enabledTypes }));
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
    const html = render([]);
    expect(html.match(/disabled=""/g)?.length).toBe(3);
  });
});
