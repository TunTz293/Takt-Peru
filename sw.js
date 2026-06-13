/* Service worker de JARVIS: cachea la app para que abra al instante
   y funcione sin conexión (las skills que usan internet — clima, monedas,
   modo IA — siguen necesitando red). */

const CACHE = "jarvis-v3";
const ARCHIVOS = [
  "./",
  "./index.html",
  "./style.css",
  "./jarvis.js",
  "./skills.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  // Las llamadas a APIs externas (Claude, Open-Meteo, etc.) van siempre a la red
  if (new URL(e.request.url).origin !== location.origin) return;

  // App: red primero (para recibir actualizaciones), caché si no hay conexión
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
