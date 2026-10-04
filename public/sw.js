/*
 * StallionCRM service worker (prompt 14).
 *
 * It deliberately caches NO application data and NO authenticated page: records live in the page's IndexedDB
 * store, which belongs to one user and is wiped on logout / change of access. The worker only
 *   - keeps the static, user-independent offline shell (/offline and the hashed /_next/static files it needs),
 *   - answers a failed navigation with that shell,
 *   - shows web-push notifications and opens their link.
 */
const CACHE = "stallion-shell-v1";
const SHELL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(warm().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Caches the offline shell and every static asset its HTML refers to. */
async function warm() {
  try {
    const cache = await caches.open(CACHE);
    const res = await fetch(SHELL, { credentials: "omit" });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put(SHELL, res);
    const assets = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\\s)]+/g)].map((m) => m[0]))];
    await Promise.all(assets.map((url) => cache.add(url).catch(() => undefined)));
  } catch {
    /* offline during install: the shell is cached on the next warm-up */
  }
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "warm") event.waitUntil(warm());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // hashed build assets are immutable and identical for every user: cache first
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res.clone();
          }),
      ),
    );
    return;
  }
  // pages: always the network (they are per user and never stored); offline → the static shell
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(SHELL).then((hit) => hit || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } }))));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(self.registration.showNotification(data.title || "StallionCRM", { icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { href: data.href || "/notifications" } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => "focus" in c);
      if (open) return open.navigate(href).then((c) => (c ? c.focus() : undefined));
      return self.clients.openWindow(href);
    }),
  );
});
