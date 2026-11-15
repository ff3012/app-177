import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: (props: { href: string; className?: string; children?: ReactNode }) =>
    createElement('a', { href: props.href, className: props.className }, props.children),
}));
vi.mock('../submit-actions', () => ({ submitReport: vi.fn() }));

import { ReportWizard } from './report-wizard';

type WizardProps = ComponentProps<typeof ReportWizard>;

const base = {
  type: 'ACTIVITY' as const,
  filledById: 'u1',
  members: [
    { id: 'u1', firstName: 'Anna', lastName: 'Huber' },
    { id: 'u2', firstName: 'Bernd', lastName: 'Bauer' },
  ],
  vehicles: [{ id: 'v1', taktischeBezeichnung: 'KLF', kennzeichen: 'PL-1F' }],
  recentActivityKinds: [] as string[],
};

function render(props: Partial<WizardProps> = {}): string {
  return renderToStaticMarkup(createElement(ReportWizard, { ...base, ...props }));
}

describe('ReportWizard (Handy-Layout, Standard)', () => {
  it('zeigt Schrittkopf, Ausfüller-Auswahl und die feste untere Leiste', () => {
    const html = render();
    expect(html).toContain('Schritt 1 von 3');
    expect(html).toContain('Ausgefüllt von');
    expect(html).toContain('pb-safe-tabbar');
    expect(html).toContain('href="/meine-feuerwehr"');
  });

  it('hat bei einem Übungsbericht vier Schritte', () => {
    expect(render({ type: 'EXERCISE' })).toContain('Schritt 1 von 4');
  });

  it('ersetzt mit onCancel den Abbrechen-Link durch eine Schaltfläche', () => {
    const html = render({ onCancel: () => undefined });
    expect(html).toContain('‹ Abbrechen');
    expect(html).not.toContain('href="/meine-feuerwehr"');
  });
});

describe('ReportWizard (Tablet-Layout)', () => {
  const tablet = {
    layout: 'tablet' as const,
    tabletHeader: { title: 'Tätigkeitsbericht', subtitle: 'FF Wolfsgraben · Ausfüller: Anna Huber' },
  };

  it('rendert eine eigene Seite mit Schrittleiste, ohne die feste Handy-Leiste', () => {
    const html = render(tablet);
    expect(html).toContain('data-layout="tablet"');
    expect(html).toContain('Grunddaten');
    expect(html).toContain('Fahrzeuge / Mitglieder');
    expect(html).toContain('Abschluss');
    expect(html).toContain('FF Wolfsgraben · Ausfüller: Anna Huber');
    expect(html).not.toContain('pb-safe-tabbar');
    expect(html).not.toContain('Schritt 1 von');
  });

  it('zeigt bei einem Übungsbericht zusätzlich den Schritt Übungsdetails', () => {
    expect(render({ ...tablet, type: 'EXERCISE' })).toContain('Übungsdetails');
    expect(render(tablet)).not.toContain('Übungsdetails');
  });

  it('sperrt "Weiter", solange Eigene Tätigkeit und Tätigkeitsart fehlen', () => {
    expect(render(tablet)).toMatch(/<button[^>]*disabled=""[^>]*>Weiter<\/button>/);
  });

  it('blendet mit lockFilledBy die Auswahl "Ausgefüllt von" aus, sonst zeigt sie sie', () => {
    expect(render({ ...tablet, lockFilledBy: true })).not.toContain('Ausgefüllt von');
    expect(render(tablet)).toContain('Ausgefüllt von');
  });

  it('bietet am Tablet statt des Abbrechen-Links die Abbrechen-Schaltfläche (onCancel) im Fuß', () => {
    const html = render({ ...tablet, onCancel: () => undefined });
    expect(html).toContain('Abbrechen');
    expect(html).not.toContain('href="/meine-feuerwehr"');
  });
});
