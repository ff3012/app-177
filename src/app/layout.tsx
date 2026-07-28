import type { Metadata, Viewport } from 'next';
import { Noto_Sans } from 'next/font/google';
import './globals.css';
import { PwaRegister } from '@/components/pwa-register';

// Matches the font used on afkdopurkersdorf.at.
const notoSans = Noto_Sans({ subsets: ['latin', 'latin-ext'], weight: ['400', '700'], variable: '--font-noto-sans' });

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
  themeColor: '#333333',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className={`${notoSans.variable} min-h-screen font-sans antialiased`}>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
