/**
 * Grober Proxy-Check für "läuft die Server-Uhr synchron": ein Docker-Container hat keine eigene
 * Uhr, er teilt sich den System-Takt mit dem Host - eine dedizierte NTP-Client-Prüfung *im
 * Container* würde also nichts über den Host aussagen. Stattdessen wird die eigene Systemzeit
 * gegen einen externen, dynamisch berechneten Zeitstempel verglichen, ohne eine eigene
 * NTP-Bibliothek/-Abhängigkeit einzubinden.
 *
 * Cloudflares `/cdn-cgi/trace`-Diagnose-Endpunkt liefert genau dafür ein `ts=<unix-epoch>`-Feld
 * im Klartext-Body, pro Anfrage frisch von der Edge berechnet - bewusst NICHT mehr Mailjet: ein
 * echter Vorfall (2026-09-01) zeigte, dass `https://api.mailjet.com` hinter CloudFront lief und
 * dessen Antwort (inkl. Date-Header) über Stunden hinweg gecacht wurde (`age: 77592`,
 * `x-cache: Hit from cloudfront`, live gegen den Produktions-Container verifiziert - ein
 * Cache-Busting-Query-Parameter half nicht, diese Distribution ignoriert den Query-String für den
 * Cache-Key). Ein Wechsel auf Mailjets authentifizierte REST-API hätte das zwar behoben (CloudFront
 * cacht keine Anfragen mit Authorization-Header), aber diesen ohnehin zweckfremden Uhr-Check enger
 * an Mailjet-Zugangsdaten gekoppelt - ein Uhr-Check hat konzeptionell nichts mit E-Mail-Versand zu
 * tun. `/cdn-cgi/trace` ist als reiner Diagnose-Endpunkt gebaut (breit für genau diesen Zweck
 * genutzt, z. B. von Netzwerk-Tools), dynamisch, nie gecacht und braucht keine Zugangsdaten.
 */
export async function checkNtpDrift(): Promise<{ ok: boolean; driftSeconds: number | null }> {
  try {
    const response = await fetch('https://cloudflare.com/cdn-cgi/trace', { method: 'GET', cache: 'no-store' });
    const body = await response.text();
    const match = body.match(/^ts=([\d.]+)$/m);
    if (!match) return { ok: false, driftSeconds: null };

    const remoteTime = parseFloat(match[1]) * 1000;
    if (Number.isNaN(remoteTime)) return { ok: false, driftSeconds: null };

    const driftSeconds = Math.round(Math.abs(remoteTime - Date.now()) / 1000);
    return { ok: driftSeconds <= 10, driftSeconds };
  } catch (error) {
    console.error('NTP-Drift-Check fehlgeschlagen:', error);
    return { ok: false, driftSeconds: null };
  }
}
