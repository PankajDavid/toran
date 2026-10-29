// Toran service worker: lets the app open fast and work offline, and makes it installable.
// Network first, so updates always arrive; the cache is only a fallback.
// API calls are never cached (plans are built fresh and never stored here).
const CACHE = "toran-v19";
const SHELL = [
  "/",
  "/app.css",
  "/fonts/fonts.css",
  "/favicon.svg",
  "/brand/toran-garland.svg",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/js/booking.js",
  "/js/costs.js",
  "/js/dom.js",
  "/js/files.js",
  "/js/format.js",
  "/js/ideas.js",
  "/js/install.js",
  "/js/interview.js",
  "/js/main.js",
  "/js/nav.js",
  "/js/plan.js",
  "/js/quote-read.js",
  "/js/quote-verdict.js",
  "/js/quote.js",
  "/js/share.js",
  "/js/store.js",
  "/js/suggest.js",
  "/js/vendor-contact.js",
  "/js/vendor-find.js",
  "/js/vendors.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/"))),
  );
});
