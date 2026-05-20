const CACHE_VERSION = "studyflow-v24";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const BASE_URL = new URL("./", self.location.href);
const NAVIGATION_FALLBACK = new URL("offline.html", BASE_URL).pathname;

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./login.html",
  "./signup.html",
  "./student.html",
  "./profile.html",
  "./offline.html",
  "./styles.css",
  "./theme.js",
  "./auth.js",
  "./app.js",
  "./student.js",
  "./profile.js",
  "./pwa-register.js",
  "./push-client.js",
  "./manifest.webmanifest",
  "./assets/studyflow-icon.svg",
  "./assets/studyflow-logo.svg",
  "./assets/logo.svg",
  "./assets/logo_icon.svg",
  "./assets/logo_text.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json?.() || {};
  } catch {
    data = { body: event.data?.text?.() || "" };
  }
  const title = data.title || "StudyFlow";
  const options = {
    body: data.body || "",
    icon: "./assets/icon-192.png",
    badge: "./assets/icon-192.png",
    data: {
      url: data.url || "./"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./", self.location.href).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const client = clients.find((item) => item.url === url);
      if (client) return client.focus();
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("studyflow-") && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin ||
      !url.pathname.startsWith(BASE_URL.pathname) ||
      url.pathname.includes("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(NAVIGATION_FALLBACK)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
