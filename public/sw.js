const CACHE_NAME = 'ff-purkersdorf-shell-v2';
const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
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

// Nur GET-Navigationen abfangen: Network-first mit Offline-Fallback. Alles andere (API-Calls,
// Server Actions, POST) unangetastet durchreichen, damit keine veralteten Daten/Formulare
// zwischengespeichert werden.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL))
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
