import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Feuerwehr BFKDO St. Pölten',
    short_name: 'BFKDO St. Pölten',
    description: 'Terminplanung und Drohnengruppe für den Bezirk 17 St. Pölten',
    start_url: '/kalender',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1c1c1e',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
