import QRCode from 'qrcode';

/** Gleiches env-var-/Trailing-Slash-Muster wie baseUrl() in src/lib/email/templates.ts und
 * buildDashboardLink() in admin/heimatfeuerwehr/page.tsx - eine einzige Quelle für die öffentliche
 * App-URL statt separat hardcodierter Kopien. Fällt nur auf den Literal-Wert zurück, falls AUTH_URL
 * nicht gesetzt ist. */
export const APP_URL = process.env.AUTH_URL?.replace(/\/$/, '') || 'https://app-177.ff-wolfsgraben.at/';

/** Erzeugt den QR-Code für eine beliebige URL als SVG-Data-URI, serverseitig - Design-Spec §7:
 * Fehlerkorrektur M, Ruhezone 4 Module. */
export async function generateQrCodeDataUri(url: string): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
  });
  const base64 = Buffer.from(svg, 'utf-8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

/** Erzeugt den QR-Code für den App-Download-Link - wird auf dem öffentlichen Dashboard verwendet.
 * Dünner Wrapper um generateQrCodeDataUri für Rückwärtskompatibilität; die Verwaltung (Task 13)
 * erzeugt stattdessen pro Dashboard-Token einen eigenen QR-Code über generateQrCodeDataUri direkt,
 * siehe admin/heimatfeuerwehr/page.tsx. */
export async function generateAppQrCodeDataUri(): Promise<string> {
  return generateQrCodeDataUri(APP_URL);
}
