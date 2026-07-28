/**
 * Grober Proxy-Check für "läuft die Server-Uhr synchron": ein Docker-Container hat keine eigene
 * Uhr, er teilt sich den System-Takt mit dem Host - eine dedizierte NTP-Client-Prüfung *im
 * Container* würde also nichts über den Host aussagen. Stattdessen wird die eigene Systemzeit
 * gegen den Date-Response-Header eines externen HTTPS-Calls verglichen (jeder HTTP-Server setzt
 * diesen Header selbst), ohne eine eigene NTP-Bibliothek/-Abhängigkeit einzubinden.
 */
export async function checkNtpDrift(): Promise<{ ok: boolean; driftSeconds: number | null }> {
  try {
    const response = await fetch('https://api.mailjet.com', { method: 'GET', cache: 'no-store' });
    const dateHeader = response.headers.get('date');
    if (!dateHeader) return { ok: false, driftSeconds: null };

    const remoteTime = new Date(dateHeader).getTime();
    if (Number.isNaN(remoteTime)) return { ok: false, driftSeconds: null };

    const driftSeconds = Math.round(Math.abs(remoteTime - Date.now()) / 1000);
    return { ok: driftSeconds <= 10, driftSeconds };
  } catch (error) {
    console.error('NTP-Drift-Check fehlgeschlagen:', error);
    return { ok: false, driftSeconds: null };
  }
}
