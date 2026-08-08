self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || "Mesa Viva", {
    body: data.body || "Há uma atualização no seu pedido.",
    tag: data.tag || "mesa-viva",
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
