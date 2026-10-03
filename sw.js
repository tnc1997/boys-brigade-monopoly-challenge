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

/** How long to wait for the network before using the saved copy of the app's files, in milliseconds. */
const NETWORK_TIMEOUT_MS = 4000;

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

/**
 * Saves a library file if it loads successfully. Failing to load it doesn't
 * throw, so the app's own files can still be saved; it's saved later, the
 * first time the page loads it.
 *
 * @param {Cache} cache The cache to save it in.
 * @param {string} url The library file's URL.
 * @returns {Promise<void>} Resolves once it's saved, or once saving it has failed.
 */
function saveLibraryFile(cache, url) {
  // Leaflet is loaded with crossorigin="anonymous", so save it with a matching CORS request.
  return fetch(url, { mode: 'cors' })
    .then((response) => (response.ok ? cache.put(url, response) : undefined))
    .catch(() => {});
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.all([cache.addAll(APP_FILES), ...LIBRARY_FILES.map((url) => saveLibraryFile(cache, url))]))
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
    // Use the saved copy, or load it and save it if it wasn't saved at install.
    const saved = caches.match(url.href);
    const response = saved.then((match) => match ?? fetch(request));
    event.respondWith(response.then((match) => match.clone()));
    event.waitUntil(
      Promise.all([saved, response])
        .then(([match, loaded]) => (!match && loaded.ok ? caches.open(CACHE_NAME).then((cache) => cache.put(url.href, loaded)) : undefined))
        .catch(() => {}),
    );
    return;
  }

  // Only the app's own files are handled; tiles and searches go to the network as usual.
  if (url.origin !== self.location.origin) {
    return;
  }
  const network = fetch(request);
  // Refresh the saved copy, keeping the service worker alive until it's
  // written. The copy is taken before the response is used below.
  const refresh = network.then((response) => {
    if (!response.ok) {
      return undefined;
    }
    const copy = response.clone();
    return caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  });
  // Without a saved copy, opening the page falls back to the saved page;
  // anything else fails as it would without the service worker.
  const saved = () =>
    caches
      .match(request, { ignoreSearch: true })
      .then((match) => match ?? (request.mode === 'navigate' ? caches.match('index.html') : undefined));
  // With a weak signal the network can hang, so use the saved copy after a
  // few seconds. The network request carries on and still refreshes it.
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS)).then(saved);
  event.waitUntil(refresh.catch(() => {}));
  event.respondWith(
    Promise.race([network, timeout.then((match) => match ?? network)])
      .catch(saved)
      .then((response) => response ?? Response.error()),
  );
});
