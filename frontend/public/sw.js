/// <reference lib="webworker" />

const CACHE_NAME = "pingy-v1";

// Shell files that make the app work offline.
// Vite hashed filenames are handled by the runtime cache below.
const SHELL_URLS = ["/", "/index.html"];

// ─── Install: pre-cache app shell ──────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// ─── Activate: clean up old caches ─────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Claim all open tabs immediately
  self.clients.claim();
});

// ─── Push / notification click (для пуш-уведомлений о новых сообщениях) ─
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url || "/chats";
  const fullUrl = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        const appClient = clientList.find((c) => c.url.startsWith(self.registration.scope));
        if (appClient) {
          appClient.navigate(fullUrl);
          appClient.focus();
        } else if (self.clients.openWindow) {
          self.clients.openWindow(fullUrl);
        }
      })
  );
});

// ─── Fetch strategy ────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, WebSocket, and chrome-extension requests
  if (
    request.method !== "GET" ||
    url.protocol === "ws:" ||
    url.protocol === "wss:" ||
    url.protocol === "chrome-extension:"
  ) {
    return;
  }

  // API/auth calls → network only (never cache sensitive data)
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
    return;
  }

  // Static assets with hashes (Vite build) → cache-first
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // Icons, fonts, sounds, stickers, animations → cache-first
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/sounds/") ||
    url.pathname.startsWith("/stickers/") ||
    url.pathname.startsWith("/animations/") ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // Navigation requests → network-first with fallback to cached shell
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Everything else → stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
