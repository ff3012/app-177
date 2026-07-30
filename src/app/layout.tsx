import type { Metadata, Viewport } from 'next';
import { Barlow, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { PwaRegister } from '@/components/pwa-register';

// "Signalrot" design pass: Barlow (body) + IBM Plex Mono (tokens/codes/timestamps) replace the
// previous Noto Sans / default monospace, matching the new color palette below.
const barlow = Barlow({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow',
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
});

export const metadata: Metadata = {
  title: 'Feuerwehr Abschnitt Purkersdorf',
  description: 'Terminplanung und Drohnengruppe für den Abschnitt Purkersdorf',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Abschnitt Purkersdorf',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1c1c1e',
  // Android Chrome auto-darkens web content specifically when this meta tag is missing (the CSS
  // color-scheme property alone doesn't stop it) — this app has no dark theme, so opt out entirely.
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className={`${barlow.variable} ${ibmPlexMono.variable} min-h-screen font-sans antialiased`}>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
