/**
 * OpenStreetMap's standard tiles, which are free within the tile usage
 * policy: https://operations.osmfoundation.org/policies/tiles/
 *
 * Keep to the policy when changing this module. Keep the attribution
 * visible on the map, don't prefetch or download tiles for offline use, and
 * let the browser cache tiles normally. If asked to stop using the service,
 * change this URL and redeploy.
 */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** The attribution the tile usage policy requires, shown in a corner of the map. */
export const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Central Bristol, as `[[south, west], [north, east]]`, shown before there's a route. */
export const BRISTOL_BOUNDS = [
  [51.44, -2.63],
  [51.47, -2.56],
];

/**
 * A map of the route.
 *
 * @typedef {object} RouteMap
 * @property {import('leaflet').Map} map The Leaflet map.
 * @property {import('leaflet').LayerGroup} routeLayer The layer the route is drawn on.
 * @property {import('leaflet').LayerGroup} positionLayer The layer the team's position is drawn on.
 * @property {() => void} refresh Updates the map's size after its container has been shown or resized.
 */

/**
 * A place to mark on the map.
 *
 * @typedef {object} MapMarker
 * @property {'start' | 'stop' | 'done' | 'finish' | 'skipped'} kind What the place is, which sets how it looks.
 * @property {import('./planner.js').LatLng} location Where it is.
 * @property {string} label What the marker shows: the stop's number, or a short symbol.
 * @property {string} title A description for its tooltip and screen readers, like "1. Old Kent Road, ETA 11:02".
 */

/** How each kind of marker looks, as Tailwind classes. */
const MARKER_CLASSES = {
  start: 'bg-ink text-surface',
  stop: 'bg-accent text-white',
  done: 'bg-accent-line text-accent-ink',
  finish: 'bg-ink text-surface',
  skipped: 'bg-field text-ink opacity-80',
};

/**
 * Creates a Leaflet map with OpenStreetMap tiles, showing central Bristol.
 * Leaflet is loaded from a CDN as the global `L`.
 *
 * @param {HTMLElement} container The element to show the map in. It must be visible and have a height.
 * @param {object} [options] Callbacks.
 * @param {() => void} [options.onTilesFailed] Called when map tiles fail to load, for example without signal.
 * @param {() => void} [options.onTilesLoaded] Called when map tiles load again.
 * @returns {RouteMap | null} The map, or `null` if Leaflet couldn't be loaded (for example, without signal).
 */
export function createMap(container, { onTilesFailed = () => {}, onTilesLoaded = () => {} } = {}) {
  const { L } = globalThis;
  if (!L) {
    return null;
  }
  const map = L.map(container);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION })
    .on('tileerror', onTilesFailed)
    .on('tileload', onTilesLoaded)
    .addTo(map);
  map.fitBounds(BRISTOL_BOUNDS);
  const routeLayer = L.layerGroup().addTo(map);
  // The team's position goes in its own pane above the markers (600), so a
  // stop's marker never hides it.
  map.createPane('position').style.zIndex = '650';
  const positionLayer = L.layerGroup().addTo(map);
  return { map, routeLayer, positionLayer, refresh: () => map.invalidateSize() };
}

/**
 * Draws the route: a line through the start, the stops in order and the
 * finish, and a marker for each place, with skipped locations greyed out.
 * Anything drawn before is replaced.
 *
 * @param {RouteMap} routeMap The map.
 * @param {object} route What to draw.
 * @param {import('./planner.js').LatLng[]} route.path The start, the stops in order and the finish (if there is one), for the line.
 * @param {MapMarker[]} route.markers The places to mark.
 * @param {boolean} shouldFit Whether to zoom the map to fit the route (not counting skipped locations), as after planning.
 */
export function showRoute({ map, routeLayer }, { path, markers }, shouldFit) {
  const { L } = globalThis;
  routeLayer.clearLayers();
  if (path.length > 1) {
    // Leaflet sets the line's colour as an SVG attribute, which can't use the
    // theme's CSS variables, so the colour comes from a class instead.
    L.polyline(
      path.map(({ lat, lng }) => [lat, lng]),
      { className: 'stroke-accent', weight: 4, opacity: 0.8, interactive: false },
    ).addTo(routeLayer);
  }
  // Skipped locations go underneath, so they don't hide the route.
  const ordered = [...markers.filter(({ kind }) => kind === 'skipped'), ...markers.filter(({ kind }) => kind !== 'skipped')];
  for (const { kind, location, label, title } of ordered) {
    const size = kind === 'skipped' ? 22 : 30;
    const icon = document.createElement('span');
    icon.className = `flex size-full items-center justify-center rounded-full text-xs font-bold shadow ring-2 ring-surface ${MARKER_CLASSES[kind]}`;
    icon.textContent = label;
    const marker = L.marker([location.lat, location.lng], {
      icon: L.divIcon({ html: icon, className: '', iconSize: [size, size] }),
      title,
      alt: title,
      keyboard: true,
      zIndexOffset: kind === 'skipped' ? -1000 : 0,
    });
    const popup = document.createElement('p');
    popup.className = 'm-0 text-sm';
    popup.textContent = title;
    marker.bindPopup(popup).addTo(routeLayer);
  }
  // Fit the route itself, so far-off skipped locations don't zoom the map
  // out so far that the stops overlap.
  const onRoute = markers.filter(({ kind }) => kind !== 'skipped');
  const fitted = onRoute.length > 1 ? onRoute : markers;
  if (shouldFit && fitted.length > 0) {
    map.fitBounds(
      fitted.map(({ location }) => [location.lat, location.lng]),
      { padding: [24, 24], maxZoom: 16 },
    );
  }
}

/**
 * The team's position from the browser.
 *
 * @typedef {object} Position
 * @property {number} lat Latitude.
 * @property {number} lng Longitude.
 * @property {number} accuracy How far off the position might be, in metres.
 * @property {number} time When the position was found, in milliseconds since the Unix epoch.
 */

/**
 * Shows the team's position as a dot, with a circle showing how accurate it
 * is. Anything drawn before is replaced.
 *
 * @param {RouteMap} routeMap The map.
 * @param {Position | null} position The position, or `null` to remove it.
 */
export function showPosition({ positionLayer }, position) {
  const { L } = globalThis;
  positionLayer.clearLayers();
  if (!position) {
    return;
  }
  const centre = [position.lat, position.lng];
  const options = { pane: 'position', interactive: false };
  L.circle(centre, { ...options, radius: position.accuracy, className: 'fill-position stroke-position', weight: 1, fillOpacity: 0.15 }).addTo(positionLayer);
  L.circleMarker(centre, { ...options, radius: 7, className: 'fill-position stroke-surface', weight: 3, fillOpacity: 1 }).addTo(positionLayer);
}
