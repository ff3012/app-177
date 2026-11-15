import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { loadKioskData } from '@/lib/heimatfeuerwehr/report-kiosk-data';
import { KioskFlow } from './kiosk-flow';

export const metadata: Metadata = {
  title: 'Berichte erfassen',
  robots: { index: false, follow: false },
};

// Kein Zoomen per Doppeltipp am gemeinsamen Gerät; Farbe und Sicherheitsbereiche wie im Rest der App.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#1c1c1e',
};

// Immer frisch: ein abgeschalteter oder neu erzeugter Link muss sofort 404 liefern.
export const dynamic = 'force-dynamic';

/** Öffentliche iPad-Schnellerfassung. Unbekannter, abgeschalteter oder neu erzeugter Link: 404. */
export default async function BerichteSchnellPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadKioskData(token);
  if (!data) notFound();

  return (
    <KioskFlow
      token={token}
      organizationName={data.organization.name}
      members={data.members}
      vehicles={data.vehicles}
      recentKindsByType={data.recentKindsByType}
    />
  );
}
