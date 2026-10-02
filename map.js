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
 * @property {() => void} refresh Updates the map's size after its container has been shown or resized.
 */

/**
 * Creates a Leaflet map with OpenStreetMap tiles, showing central Bristol.
 * Leaflet is loaded from a CDN as the global `L`.
 *
 * @param {HTMLElement} container The element to show the map in. It must be visible and have a height.
 * @returns {RouteMap | null} The map, or `null` if Leaflet couldn't be loaded (for example, without signal).
 */
export function createMap(container) {
  const { L } = globalThis;
  if (!L) {
    return null;
  }
  const map = L.map(container);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
  map.fitBounds(BRISTOL_BOUNDS);
  return { map, refresh: () => map.invalidateSize() };
}
