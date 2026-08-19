const PUSH_TRUNCATE_LENGTH = 170;

/** Kürzt an der letzten Wortgrenze vor maxLength (nie mitten im Wort) und hängt eine Ellipse an - die
 * volle Nutzlast würde bei langen Texten das 4-KB-Payload-Limit von Web Push riskieren, und ein
 * Abschneiden mitten im Wort sähe auf dem Sperrbildschirm kaputt aus.
 *
 * In einer eigenen, import-freien Datei (statt in dispatch-news.ts, wo sie ursprünglich lag), weil
 * news-form.tsx ('use client') sie für die Live-Vorschau braucht: dispatch-news.ts importiert
 * prisma und web-push-client, beides mit Node-only-Abhängigkeiten (u.a. `net`/`tls` über
 * https-proxy-agent) - ein Client-Komponenten-Import von truncateForPush AUS dispatch-news.ts zieht
 * diese Kette mit ins Browser-Bundle und lässt `next build` mit "Module not found: Can't resolve
 * 'net'" fehlschlagen (live bestätigt). Diese Datei hat keine Imports und ist damit sicher sowohl
 * server- als auch client-seitig zu bündeln. */
export function truncateForPush(body: string, maxLength = PUSH_TRUNCATE_LENGTH): string {
  if (body.length <= maxLength) return body;
  const cut = body.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}
