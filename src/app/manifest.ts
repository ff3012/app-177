import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Feuerwehr Abschnitt Purkersdorf',
    short_name: 'Abschnitt Purkersdorf',
    description: 'Terminplanung und Drohnengruppe für den Abschnitt Purkersdorf',
    start_url: '/kalender',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#333333',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
