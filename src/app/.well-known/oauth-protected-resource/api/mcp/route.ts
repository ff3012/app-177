export { GET, OPTIONS } from '../../route';

// Segment-Konfiguration muss in der Route-Datei selbst stehen (Re-Export wird von Next.js nicht ausgewertet).
export const dynamic = 'force-dynamic';
