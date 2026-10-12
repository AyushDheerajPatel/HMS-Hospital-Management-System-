const CACHE_NAME = "hms-shell-v2";

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME);
  const shell = await fetch("/");
  if (!shell.ok) {
    throw new Error("Unable to cache the HMS application shell.");
  }

  await cache.put("/", shell.clone());
  const html = await shell.text();
  const assets = Array.from(
    html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
    (match) => new URL(match[1], self.location.origin),
  ).filter((url) => url.origin === self.location.origin);

  for (const assetUrl of assets) {
    const response = await fetch(assetUrl);
    if (!response.ok) continue;
    await cache.put(assetUrl, response.clone());
    if (assetUrl.pathname.endsWith(".css")) {
      const css = await response.text();
      const fonts = Array.from(
        css.matchAll(/url\(["']?([^"')]+)["']?\)/g),
        (match) => new URL(match[1], assetUrl),
      ).filter((url) => url.origin === self.location.origin);
      await Promise.all(
        fonts.map(async (fontUrl) => {
          const font = await fetch(fontUrl);
          if (font.ok) await cache.put(fontUrl, font);
        }),
      );
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheApplicationShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("hms-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match("/");
        if (!cached) {
          throw new Error("The cached HMS application shell is unavailable.");
        }
        return cached;
      }),
    );
    return;
  }

  if (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font" ||
    request.destination === "image"
  ) {
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) return cached;

        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      }),
    );
  }
});
