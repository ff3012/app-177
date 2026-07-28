import type { Metadata, Viewport } from 'next';
import { Noto_Sans } from 'next/font/google';
import './globals.css';

// Matches the font used on afkdopurkersdorf.at.
const notoSans = Noto_Sans({ subsets: ['latin', 'latin-ext'], weight: ['400', '700'], variable: '--font-noto-sans' });

export const metadata: Metadata = {
  title: 'Feuerwehr Abschnitt Purkersdorf',
  description: 'Terminplanung und Drohnengruppe für den Abschnitt Purkersdorf',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className={`${notoSans.variable} min-h-screen font-sans antialiased`}>{children}</body>
    </html>
  );
}
