import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { minOccurredOn, viennaToday } from '@/lib/heimatfeuerwehr/notification-input';
import { NotificationFormView } from './notification-form-view';

const noop = async () => ({ ok: true as const });

function render(props: Partial<Parameters<typeof NotificationFormView>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(NotificationFormView, {
      form: 'DRINKS',
      products: ['Bier', 'Spritzer', 'Eistee', 'Spezi'],
      layout: 'mobile',
      onSubmit: noop,
      onDone: () => undefined,
      onCancel: () => undefined,
      ...props,
    }),
  );
}

describe('NotificationFormView: Getränkeautomat', () => {
  it('zeigt die Produkte als Auswahl, den Zähler "0 / 1" und ein gesperrtes Absenden', () => {
    const html = render();
    for (const product of ['Bier', 'Spritzer', 'Eistee', 'Spezi']) expect(html).toContain(product);
    expect(html).toContain('Welche Produkte fehlen?');
    expect(html).toContain('Anmerkung');
    expect(html).toContain('0 / 1 Pflichtfelder ausgefüllt');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Meldung absenden<\/button>/);
    expect(html).toContain('Abbrechen');
  });
});

describe('NotificationFormView: Schadensmeldung', () => {
  it('zeigt Datum, Gerät, akut/nicht akut und Beschreibung, mit dem Zähler "1 / 3" (Datum ist vorbelegt)', () => {
    const html = render({ form: 'DAMAGE', products: [] });
    expect(html).toContain('Betroffenes Gerät / Ausrüstung');
    expect(html).toContain('Ist der Schaden akut?');
    expect(html).toContain('Akut');
    expect(html).toContain('Nicht akut');
    expect(html).toContain('Beschreibung des Schadens');
    expect(html).toContain('type="date"');
    const today = viennaToday();
    expect(html).toContain(`min="${minOccurredOn(today)}"`);
    expect(html).toContain(`max="${today}"`);
    expect(html).toContain('1 / 3 Pflichtfelder ausgefüllt');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Meldung absenden<\/button>/);
  });
});

describe('NotificationFormView: Layouts', () => {
  it('kennzeichnet das Layout und unterscheidet die Fußleisten', () => {
    const mobile = render({ layout: 'mobile' });
    const tablet = render({ layout: 'tablet' });
    expect(mobile).toContain('data-layout="mobile"');
    expect(tablet).toContain('data-layout="tablet"');
    expect(mobile).toContain('pb-safe-tabbar');
    expect(tablet).not.toContain('pb-safe-tabbar');
    expect(tablet).toContain('sticky');
  });

  it('gibt der Tablet-Fußleiste den Safe-Area-Abstand unten', () => {
    const tablet = render({ layout: 'tablet' });
    expect(tablet).toContain('padding-bottom:max(12px, env(safe-area-inset-bottom, 0px))');
  });

  it('zeigt ohne Fehler kein role="alert" (der Serverfehler ist interner Zustand nach dem Absenden und statisch nicht erzeugbar)', () => {
    expect(render({ layout: 'mobile' })).not.toContain('role="alert"');
    expect(render({ layout: 'tablet' })).not.toContain('role="alert"');
  });
});
