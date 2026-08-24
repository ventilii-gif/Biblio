/* Service worker di Biblio.
   Mette in cache il "guscio" dell'app per l'uso offline.
   Le chiamate alle API dei libri e alle copertine passano sempre dalla rete. */

const CACHE = 'biblio-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Solo le risorse locali (stesso dominio) vengono servite dalla cache.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => cached)
      )
    );
  }
  // Le richieste esterne (Google Books, Open Library, copertine, ZXing) restano di rete.
});
