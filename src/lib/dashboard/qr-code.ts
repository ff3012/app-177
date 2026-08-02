import QRCode from 'qrcode';

const APP_URL = 'https://app-177.ff-wolfsgraben.at/';

/** Erzeugt den QR-Code für den App-Download-Link als SVG-Data-URI, serverseitig - Design-Spec §7:
 * Fehlerkorrektur M, Ruhezone 4 Module. Wird sowohl auf dem öffentlichen Dashboard als auch (Task 13)
 * in der Verwaltung verwendet, damit ein Admin denselben Code vor dem Ausdrucken sehen kann. */
export async function generateAppQrCodeDataUri(): Promise<string> {
  const svg = await QRCode.toString(APP_URL, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
  });
  const base64 = Buffer.from(svg, 'utf-8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}
