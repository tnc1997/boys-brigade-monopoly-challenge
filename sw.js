/*
 * Service worker that keeps the app working without signal.
 *
 * The app's own files and Leaflet are saved when the service worker
 * installs. The app's files are then fetched from the network first, so a
 * new deploy is picked up whenever there's signal, with the saved copy used
 * offline. Leaflet is versioned, so the saved copy is used first.
 *
 * Map tiles and address searches are left alone. OpenStreetMap's tile usage
 * policy doesn't allow saving tiles for offline use, so they're only cached
 * by the browser as usual: https://operations.osmfoundation.org/policies/tiles/
 */

/** Change this to replace every saved file, for example when the list below changes. */
const CACHE_NAME = 'monopoly-challenge-planner-v1';

/** The app's own files, relative to this script. Every top-level module must be listed. */
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'locations.js',
  'map.js',
  'planner.js',
  'route.js',
  'search.js',
  'settings.js',
  'setup.js',
  'storage.js',
];

/** Versioned files from cdnjs, which never change once published. */
const LIBRARY_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all([
          cache.addAll(APP_FILES),
          // Leaflet is loaded with crossorigin="anonymous", so save it with a matching CORS request.
          ...LIBRARY_FILES.map((url) => fetch(url, { mode: 'cors' }).then((response) => cache.put(url, response))),
        ]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);

  if (LIBRARY_FILES.includes(url.href)) {
    event.respondWith(caches.match(url.href).then((saved) => saved ?? fetch(request)));
    return;
  }

  // Only the app's own files are handled; tiles and searches go to the network as usual.
  if (url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((saved) => saved ?? caches.match('index.html'))),
  );
});
