/**
 * Grober Proxy-Check für "läuft die Server-Uhr synchron": ein Docker-Container hat keine eigene
 * Uhr, er teilt sich den System-Takt mit dem Host - eine dedizierte NTP-Client-Prüfung *im
 * Container* würde also nichts über den Host aussagen. Stattdessen wird die eigene Systemzeit
 * gegen den Date-Response-Header eines externen HTTPS-Calls verglichen (jeder HTTP-Server setzt
 * diesen Header selbst), ohne eine eigene NTP-Bibliothek/-Abhängigkeit einzubinden.
 *
 * Echter Vorfall (2026-09-01): `https://api.mailjet.com` läuft hinter CloudFront, das die Antwort
 * (inkl. Date-Header!) über Stunden hinweg cacht (`age: 77592`, `x-cache: Hit from cloudfront`,
 * bestätigt per direktem curl gegen den Container) - ein `cache: 'no-store'` auf UNSERER Seite
 * bewirkt nichts gegen einen CDN, der VOR Mailjets Ursprungsserver sitzt. Die App meldete dadurch
 * eine wachsende, komplett falsche Drift (>20h), obwohl die Server-Uhr die ganze Zeit korrekt war.
 * Ein einmaliger Cache-Busting-Query-Parameter erzwingt bei CloudFront (dessen Cache-Key den
 * Query-String einschließt) einen Cache-Miss und damit eine echte, frische Origin-Antwort.
 */
export async function checkNtpDrift(): Promise<{ ok: boolean; driftSeconds: number | null }> {
  try {
    const response = await fetch(`https://api.mailjet.com/?_=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
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
