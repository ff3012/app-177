import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import sharp from 'sharp';
import { prisma } from '@/lib/db/prisma';

const WASTL_DATA_URL = 'https://www.feuerwehr-krems.at/CodePages/Wastl/GetDaten/GetWastlMain.asp';
const FETCH_TIMEOUT_MS = 8000;

/**
 * Live-Recherche (Subagent, per curl gegen die echte Quelle verifiziert): die farbcodierten
 * Bezirks-Overlays, die auf ShowOverview.asp per Client-JS eingeblendet werden (siehe die ältere,
 * unten noch stehende Einschränkung "nur die statische Kartengrundlage"), kommen NICHT aus
 * client-seitig gerendertem Canvas, sondern sind selbst fertige, transparente GIFs - der Browser
 * stapelt sie per `position:absolute;top:0;left:0` exakt über der Kartengrundlage. Die Seite pollt
 * dafür `GetWastlMain.asp?Time=<beliebiger Cache-Buster>` per AJAX (kein Auth/Cookie nötig, reines
 * öffentliches XML). Jeder `<aBAZID>`-Block (ein Bezirk) trägt ein `<nLayer>`-Element mit dem
 * Dateinamen des jeweiligen Overlay-GIFs (leer = kein Vorfall = kein Overlay für diesen Bezirk),
 * abrufbar unter `<cLayP>` (Basis-URL) + Dateiname. Wir reproduzieren serverseitig exakt dieselbe
 * Stapelung: Kartengrundlage (`<cBackground>`) + alle aktiven Overlays werden geladen und per
 * sharp (einzige Bildverarbeitungs-Abhängigkeit dieser Codebase) an Position (0,0) übereinander
 * zu einem einzigen PNG zusammengesetzt - kein Puppeteer/Headless-Browser nötig, da die Quelle
 * selbst nur öffentliche, fertig eingefärbte Bild-Dateien liefert.
 */
function extractCData(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  const value = match?.[1]?.trim();
  return value ? value : null;
}

async function fetchBuffer(url: string, signal: AbortSignal): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function fetchWastlImage(): Promise<{ dataBase64: string; mimeType: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const xmlResponse = await fetch(`${WASTL_DATA_URL}?Time=${Date.now()}`, { signal: controller.signal });
    if (!xmlResponse.ok) return null;
    const xml = await xmlResponse.text();

    const backgroundUrl = extractCData(xml, 'cBackground');
    const layerBasePath = extractCData(xml, 'cLayP');
    if (!backgroundUrl) return null;

    const overlayFilenames = layerBasePath
      ? Array.from(xml.matchAll(/<aBAZID\b[^>]*>([\s\S]*?)<\/aBAZID>/g))
          .map((match) => extractCData(match[1], 'nLayer'))
          .filter((name): name is string => Boolean(name))
      : [];

    const backgroundBuffer = await fetchBuffer(backgroundUrl, controller.signal);
    if (!backgroundBuffer) return null;

    // Ein einzelnes fehlgeschlagenes Overlay (z. B. ein Bezirk mit ungewöhnlichem Dateinamen) darf
    // die restliche Karte nicht verhindern - fehlgeschlagene Overlays werden einfach weggelassen.
    const overlayBuffers = (
      await Promise.all(overlayFilenames.map((name) => fetchBuffer(`${layerBasePath}${name}`, controller.signal)))
    ).filter((buffer): buffer is Buffer => buffer !== null);

    const composited = await sharp(backgroundBuffer)
      .composite(overlayBuffers.map((input) => ({ input, top: 0, left: 0 })))
      .png()
      .toBuffer();

    return { dataBase64: composited.toString('base64'), mimeType: 'image/png' };
  } catch (error) {
    console.error('WASTL-Abruf fehlgeschlagen:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * unstable_cache-gewrapptes Live-Fetch, 120s Toleranz - dasselbe Muster wie
 * getAdminSidebarStatus() in lib/system/system-check.ts. Bei Fehlschlag null statt zu werfen; der
 * Route-Handler entscheidet dann, ob das letzte erfolgreiche Bild aus WastlImageCache verwendet wird.
 *
 * WICHTIG, per Live-Test gefunden (nicht nur theoretisch): unstable_cache persistiert den Rückgabewert
 * über Next' Data Cache als JSON. Ein `Buffer` überlebt diese JSON-Runde NICHT als Buffer-Instanz - er
 * kommt als reines `{ type: "Buffer", data: [...] }`-Objekt zurück, sobald der Wert aus dem Cache (statt
 * frisch berechnet) gelesen wird; nur der allererste, komplett kalte Aufruf liefert noch eine echte
 * Buffer-Instanz direkt aus der Funktion. Ein Prisma-`upsert` mit so einem Objekt statt einem echten
 * Buffer/Uint8Array wirft "Argument `data`: Invalid value provided. Expected Bytes, provided Object." -
 * live reproduziert, indem der Dev-Server neu gestartet wurde (der on-disk Data Cache aus dem ersten,
 * erfolgreichen Request blieb über den Neustart hinweg gültig) und der zweite Request genau diesen Fehler
 * warf. Deshalb überquert hier nur ein Base64-String (JSON-sicher) die unstable_cache-Grenze; der
 * eigentliche Buffer wird im Route-Handler selbst aus diesem String rekonstruiert, bei jedem Aufruf neu.
 */
const getCachedWastlImage = unstable_cache(fetchWastlImage, ['wastl-overview-image'], { revalidate: 120 });

export async function GET() {
  const fresh = await getCachedWastlImage();

  if (fresh) {
    const data = Buffer.from(fresh.dataBase64, 'base64');
    // Erfolgreichen Abruf als neuen Fallback für künftige Ausfälle sichern.
    await prisma.wastlImageCache.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', data, mimeType: fresh.mimeType },
      update: { data, mimeType: fresh.mimeType, fetchedAt: new Date() },
    });
    return new NextResponse(new Uint8Array(data), {
      // 'no-cache' statt 's-maxage=120': s-maxage gilt nur für Shared/CDN-Caches, von denen es vor
      // dieser App keinen gibt (Caddy ist ein reiner Reverse-Proxy, kein Cache) - es sagte dem
      // Kiosk-Browser selbst (einem Private Cache) nichts über Frische, und ohne max-age/Expires/
      // Last-Modified griff dessen eigene Heuristik, die das Bild über Tage hinweg im HTTP-Cache
      // des Kiosk-Tabs festfrieren konnte ("Karte aktualisiert sich nicht" - reales Nutzer-Feedback).
      // Die eigentliche 120s-Drosselung gegen zu häufige Abrufe der echten WASTL-Quelle passiert
      // bereits serverseitig über unstable_cache, unabhängig von diesem Header.
      headers: { 'Content-Type': fresh.mimeType, 'Cache-Control': 'no-cache' },
    });
  }

  const cached = await prisma.wastlImageCache.findUnique({ where: { id: 'singleton' } });
  if (!cached) {
    return NextResponse.json({ error: 'WASTL derzeit nicht verfügbar' }, { status: 503 });
  }
  return new NextResponse(new Uint8Array(cached.data), {
    headers: {
      'Content-Type': cached.mimeType,
      'Cache-Control': 'no-cache',
      'X-Wastl-Stale-Since': cached.fetchedAt.toISOString(),
    },
  });
}
