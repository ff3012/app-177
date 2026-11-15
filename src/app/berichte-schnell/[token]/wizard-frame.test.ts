import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WizardFrame } from './wizard-frame';

describe('WizardFrame', () => {
  it.each(['tablet', 'mobile'] as const)('rendert im Layout %s ein äußeres div mit dem Kind darin', (layout) => {
    const html = renderToStaticMarkup(createElement(WizardFrame, { layout, children: createElement('span', null, 'Inhalt') }));
    expect(html.startsWith('<div')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
    expect(html).toContain('<span>Inhalt</span>');
    expect(html).toContain('touch-manipulation');
  });

  it('Handy-Layout hat den schmalen Rahmen, Tablet-Layout nicht', () => {
    const mobile = renderToStaticMarkup(createElement(WizardFrame, { layout: 'mobile', children: 'x' }));
    const tablet = renderToStaticMarkup(createElement(WizardFrame, { layout: 'tablet', children: 'x' }));
    expect(mobile).toContain('max-w-lg');
    expect(tablet).not.toContain('max-w-lg');
  });
});
