const CACHE_NAME = 'ff-purkersdorf-shell-v3';
const OFFLINE_URL = '/offline.html';
const OFFLINE_KALENDER_URL = '/offline-kalender';
const STATIC_PRECACHE_URLS = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

// Next.js baut /offline-kalender mit inhaltsgehashten JS/CSS-Dateien (_next/static/...) - die
// exakten Dateinamen sind erst zur Build-Zeit bekannt, nicht vorher fest eintragbar. Statt eines
// zusätzlichen Build-Schritts (Workbox o.ä., bewusst nicht eingeführt - siehe root CLAUDE.md,
// "hand-written, no next-pwa/similar dependency") liest dieser Schritt die tatsächlich
// ausgelieferte HTML-Antwort und cached jede darin referenzierte /_next/-Datei mit. Fragil
// gegenüber Änderungen an Next.js' HTML-Struktur, aber für diesen Piloten bewusst akzeptiert -
// siehe docs/superpowers/specs/2026-08-28-android-offline-kalender-design.md.
async function precacheOfflineKalender(cache) {
  try {
    const response = await fetch(OFFLINE_KALENDER_URL);
    if (!response.ok) return;
    const html = await response.clone().text();
    await cache.put(OFFLINE_KALENDER_URL, response);
    const assetUrls = [...html.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)].map((m) => m[1]);
    await Promise.all(
      assetUrls.map((url) =>
        fetch(url)
          .then((res) => res.ok && cache.put(url, res))
          .catch(() => {})
      )
    );
  } catch {
    // best-effort - siehe Kommentar oben. Ohne vollständigen Precache zeigt der Offline-Fallback
    // ggf. eine unvollständig gestylte Seite, aber keinen Absturz.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_PRECACHE_URLS).then(() => precacheOfflineKalender(cache)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Navigationen: network-first mit Offline-Fallback (bevorzugt /offline-kalender, sonst die alte
// bare offline.html). /_next/-Assets: ebenfalls network-first, aber bei Fehlschlag aus dem Cache
// bedient, falls sie beim Precache-Schritt oben mitgesichert wurden - das deckt genau die JS/CSS-
// Dateien ab, die /offline-kalender zum Rendern braucht. Alles andere (API-Calls, Server Actions,
// POST, Bilder, sonstige Assets) bleibt unangetastet, damit keine veralteten Daten/Formulare
// zwischengespeichert werden.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const isNavigation = event.request.mode === 'navigate';
  const isNextStaticAsset = new URL(event.request.url).pathname.startsWith('/_next/');
  if (!isNavigation && !isNextStaticAsset) return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      if (isNavigation) {
        const kalender = await caches.match(OFFLINE_KALENDER_URL);
        return kalender || (await caches.match(OFFLINE_URL));
      }
      return caches.match(event.request);
    })
  );
});

// News-Modul: eingehende Web-Push-Nachricht als Benachrichtigung anzeigen. data.url (falls vorhanden)
// wird an showNotification durchgereicht, damit notificationclick unten weiß, wohin ein Tap führen soll.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = { title: 'BFKDO St. Pölten', body: '' };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: payload.data,
    })
  );
});

// Klick auf die Benachrichtigung: öffnet/fokussiert data.url (die konkrete News-Meldung), fällt auf
// /kalender zurück, falls keine data.url mitgeschickt wurde (z. B. der ältere, News-unabhängige
// Kalender-Sofortversand). Ein bereits offenes Fenster wird fokussiert UND zur Ziel-URL navigiert -
// focus() allein würde die zuvor geöffnete Seite unverändert lassen. navigate() kann ablehnen (z. B. bei
// einem Fenster, das dieser Service Worker nicht kontrolliert) - in dem Fall auf openWindow() zurückfallen
// statt den Nutzer stillschweigend auf der alten Seite sitzen zu lassen (genau der Bug, den dieses
// Feature eigentlich beheben soll).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/kalender';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        return existing
          .focus()
          .then(() => existing.navigate(url))
          .catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    })
  );
});
