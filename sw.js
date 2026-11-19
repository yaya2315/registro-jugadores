// Service worker: permite instalar la app y abrir la "carcasa" aunque no haya señal.
// Los datos (Firestore) y el login (Google) siempre van directo a la red: no se guardan aquí.

const VERSION = 'v3';
const CACHE = `jugadores-${VERSION}`;
const CARCASA = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/parser.js',
  'js/images.js',
  'js/ocr.js',
  'js/rostro.js',
  'js/instalar.js',
  'js/backend-firebase.js',
  'js/firebase-config.js',
  'icon.svg',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CARCASA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Red primero (así las actualizaciones llegan de inmediato); si no hay red, lo guardado.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase, Google, CDN: no se tocan

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
