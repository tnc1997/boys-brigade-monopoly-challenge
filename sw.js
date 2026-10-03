/*
 * Service worker that keeps the app working without signal.
 *
 * The app's own files are saved when the service worker installs, and
 * Leaflet when it installs or activates, or else the first time the page
 * loads it. The app's files are then fetched from the network first, so a new
 * deploy is picked up whenever there's signal, with the saved copy used
 * offline. Leaflet is versioned, so the saved copy is used first.
 *
 * Map tiles and address searches are left alone. OpenStreetMap's tile usage
 * policy doesn't allow saving tiles for offline use, so they're only cached
 * by the browser as usual: https://operations.osmfoundation.org/policies/tiles/
 */

/** How long to wait for the network before using the saved copy of the app's files, in milliseconds. */
const NETWORK_TIMEOUT_MS = 4000;

/**
 * The start of this app's cache names. Other sites on tnc1997.github.io
 * share the same storage, so only caches with this prefix are ever deleted.
 */
const CACHE_PREFIX = 'monopoly-challenge-planner-';

/** Change this to replace every saved file, for example when the list below changes. */
const CACHE_NAME = `${CACHE_PREFIX}v1`;

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

/** The app's files as absolute URLs without query strings, which are the keys they're saved under. */
const APP_FILE_URLS = new Set(APP_FILES.map((file) => new URL(file, self.location.href).href));

/**
 * Saves a successful response in the cache. Failed responses aren't saved.
 *
 * @param {string} key The URL to save it under.
 * @param {Response} response The response, which is used up, so pass a clone if it's needed elsewhere.
 * @returns {Promise<void>} Resolves once it's saved, or straight away if it isn't.
 */
async function saveResponse(key, response) {
  if (response.ok) {
    await (await caches.open(CACHE_NAME)).put(key, response);
  }
}

/**
 * Makes sure a library file is saved in the current cache. It reuses a
 * copy from any cache, including the one from before a deploy, and only
 * downloads it if there isn't one. A failure doesn't throw, so the app's own
 * files can still be saved; it's tried again later.
 *
 * @param {string} url The library file's URL.
 * @returns {Promise<void>} Resolves once it's saved, or once saving it has failed.
 */
async function saveLibraryFile(url) {
  try {
    const cache = await caches.open(CACHE_NAME);
    if (await cache.match(url)) {
      return;
    }
    const existing = await caches.match(url);
    // Leaflet is loaded with crossorigin="anonymous", so save it with a matching CORS request.
    await saveResponse(url, existing ?? (await fetch(url, { mode: 'cors' })));
  } catch {
    // Tried again when the service worker activates, and when the page loads it.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Bypass the browser's HTTP cache, so the files match this deploy.
      await cache.addAll(APP_FILES.map((file) => new Request(file, { cache: 'reload' })));
      await Promise.all(LIBRARY_FILES.map(saveLibraryFile));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Try any library file that couldn't be saved at install, before the
      // old caches (which may still have a copy) are deleted.
      await Promise.all(LIBRARY_FILES.map(saveLibraryFile));
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);

  if (LIBRARY_FILES.includes(url.href)) {
    // Use the saved copy, or load it and save a copy if it wasn't saved yet.
    event.respondWith(
      caches.match(url.href).then(
        (saved) =>
          saved ??
          fetch(request).then((loaded) => {
            event.waitUntil(saveResponse(url.href, loaded.clone()).catch(() => {}));
            return loaded;
          }),
      ),
    );
    return;
  }

  // Only the app's own files are handled; tiles, searches and anything else
  // go to the network as usual.
  const key = `${url.origin}${url.pathname}`;
  if (!APP_FILE_URLS.has(key)) {
    return;
  }
  // Take a copy as soon as the response arrives, before anything reads it,
  // to refresh the saved copy. The service worker is kept alive until it's
  // written, even if the saved copy is used first on a weak signal.
  let copy;
  const network = fetch(request).then((loaded) => {
    copy = loaded.clone();
    return loaded;
  });
  event.waitUntil(network.then(() => saveResponse(key, copy)).catch(() => {}));
  // Without a saved copy, opening the page falls back to the saved page;
  // anything else fails as it would without the service worker.
  const saved = () =>
    caches.match(key).then((match) => match ?? (request.mode === 'navigate' ? caches.match(new URL('index.html', self.location.href).href) : undefined));
  // With a weak signal the network can hang, so use the saved copy after a
  // few seconds. The network request carries on and still refreshes it.
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS)).then(saved);
  // An error from the server (such as a 404 or 500 during a GitHub Pages
  // problem) is treated like no signal, using the saved copy if there is one.
  const usable = network.then(async (loaded) => (loaded.ok ? loaded : ((await saved()) ?? loaded)));
  event.respondWith(
    Promise.race([usable, timeout.then((match) => match ?? usable)])
      .catch(saved)
      .then((response) => response ?? Response.error()),
  );
});
