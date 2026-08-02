import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/db/prisma';

const WASTL_PAGE_URL = 'https://www.feuerwehr-krems.at/CodePages/Wastl/wastlmain/ShowOverview.asp';
const FETCH_TIMEOUT_MS = 8000;

/**
 * Task-7-Rechercheergebnis (live per curl geprüft, siehe Implementierungsbericht):
 * ShowOverview.asp liefert HTML (kein direktes Bild), 200 OK, ~52KB. Die Seite enthält für praktisch
 * jedes <img> ZWEI Kopien im Quelltext - zuerst eine in einem <!-- ... --> HTML-Kommentar mit einer alten,
 * absoluten S3-Mirror-URL (`https://s3-eu-west-1.amazonaws.com/florian10/...`), danach die echte, aktuell
 * verwendete relative URL (`/CodePages/Wastl/Images/...`). Ein naiver "erstes <img src="..."> im Rohtext"-
 * Regex würde deshalb versehentlich die auskommentierte S3-Kopie treffen statt der echten - Kommentare
 * werden daher vor dem Regex-Match entfernt. Das eigentliche Übersichtsbild trägt `id="IMGB_ALL"`
 * (`bezirke.gif`, die statische Bezirks-Kartengrundlage); das wird gezielt gesucht, mit Fallback auf das
 * erste verbleibende <img>, falls sich das Markup künftig ändert.
 *
 * Wichtige Einschränkung (für Task 8 / den Seitenbetreiber, nicht Teil dieses Tasks): die farbcodierten
 * Alarmstufen-Overlays pro Bezirk (<img id="IMGB0".."IMGB23">, <img id="but1000".."but1028">) sind im
 * initialen HTML nur Platzhalter (`Unsichtbar.gif`/`ledgray.gif`) und werden erst clientseitig per
 * AJAX-Polling (`createAJAXconnection()`) eingefärbt. Ein serverseitiger Scrape wie hier liefert daher nur
 * die statische Kartengrundlage, nicht den Live-Status - das reicht für "irgendein Bild von der
 * Übersichtsseite anzeigen", aber nicht für farbcodierte Live-Alarmstufen ohne echte Browser-Ausführung.
 */
async function fetchWastlImage(): Promise<{ dataBase64: string; mimeType: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const pageResponse = await fetch(WASTL_PAGE_URL, { signal: controller.signal });
    if (!pageResponse.ok) return null;

    const contentType = pageResponse.headers.get('content-type') ?? '';
    if (contentType.startsWith('image/')) {
      // Quelle liefert direkt ein Bild - kein HTML-Wrapper zu parsen (siehe Task-7-Rechercheergebnis).
      const buffer = Buffer.from(await pageResponse.arrayBuffer());
      return { dataBase64: buffer.toString('base64'), mimeType: contentType };
    }

    const html = await pageResponse.text();
    // HTML-Kommentare zuerst entfernen (siehe Rechercheergebnis oben), sonst matcht der Regex die
    // auskommentierte alte S3-Kopie statt der echten, aktuell verwendeten Bild-URL.
    const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
    const overviewImgMatch = withoutComments.match(/<img[^>]+id="IMGB_ALL"[^>]+src="([^"]+)"/i);
    const anyImgMatch = withoutComments.match(/<img[^>]+src="([^"]+)"/i);
    const match = overviewImgMatch ?? anyImgMatch;
    if (!match) return null;
    const imageUrl = new URL(match[1], WASTL_PAGE_URL).toString();

    const imageResponse = await fetch(imageUrl, { signal: controller.signal });
    if (!imageResponse.ok) return null;
    const imageMimeType = imageResponse.headers.get('content-type') ?? 'image/png';
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    return { dataBase64: buffer.toString('base64'), mimeType: imageMimeType };
  } catch {
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
      headers: { 'Content-Type': fresh.mimeType, 'Cache-Control': 's-maxage=120' },
    });
  }

  const cached = await prisma.wastlImageCache.findUnique({ where: { id: 'singleton' } });
  if (!cached) {
    return NextResponse.json({ error: 'WASTL derzeit nicht verfügbar' }, { status: 503 });
  }
  return new NextResponse(new Uint8Array(cached.data), {
    headers: {
      'Content-Type': cached.mimeType,
      'Cache-Control': 's-maxage=120',
      'X-Wastl-Stale-Since': cached.fetchedAt.toISOString(),
    },
  });
}
