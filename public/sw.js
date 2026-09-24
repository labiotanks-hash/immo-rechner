// Minimaler Service Worker: macht die App installierbar (Teilen-Ziel auf Android).
// Kein Offline-Cache — die App braucht ohnehin den Server und soll nie veraltet laden.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
