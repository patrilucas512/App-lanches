const SHELL_CACHE = "masterapp-shell-v44";
const DATA_CACHE = "masterapp-safe-data-v44";
const SHELL = ["/", "/manifest.webmanifest", "/app-icon.svg", "/favicon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("masterapp-") && ![SHELL_CACHE, DATA_CACHE].includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/health")) { event.respondWith(fetch(request)); return; }
  if (url.pathname.startsWith("/api/offline") || url.pathname.startsWith("/api/self-service")) {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(DATA_CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request).then(response => response || new Response(JSON.stringify({ error: "offline_cache_unavailable" }), { status: 503, headers: { "content-type": "application/json" } }))));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request).then(response => response || caches.match("/"))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && ["style", "script", "image", "font"].includes(request.destination)) caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || "MasterApp", {
    body: data.body || "Há uma atualização no seu pedido.",
    tag: data.tag || "masterapp",
    renotify: true,
    vibrate: [500, 180, 500, 180, 500],
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: { url: data.url || "/" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(openClients => {
    const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
    const existing = openClients.find(client => client.url === target);
    if (existing) return existing.focus();
    return clients.openWindow(target);
  }));
});
