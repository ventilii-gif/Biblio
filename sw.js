/* Service worker di Biblio.
   Strategia "network-first" per i file dell'app: quando c'è connessione
   viene servita sempre la versione più recente (così gli aggiornamenti
   arrivano subito), con ricaduta sulla cache quando si è offline.
   Le chiamate alle API dei libri e alle copertine passano sempre dalla rete. */

const CACHE = 'biblio-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './vendor/zxing.min.js',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // esterne: rete diretta

  // Network-first: prova la rete, aggiorna la cache, e usa la cache solo se offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
