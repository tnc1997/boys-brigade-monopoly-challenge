/**
 * A point on the Earth's surface in decimal degrees.
 *
 * @typedef {object} LatLng
 * @property {number} lat Latitude, from -90 to 90.
 * @property {number} lng Longitude, from -180 to 180.
 */

/** Mean radius of the Earth in metres. */
const EARTH_RADIUS_METRES = 6371000;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Calculates the great-circle (straight-line) distance between two points
 * using the haversine formula.
 *
 * @param {LatLng} a The first point.
 * @param {LatLng} b The second point.
 * @returns {number} The distance between the points in metres.
 * @example
 * haversineMetres({ lat: 51.4556, lng: -2.5894 }, { lat: 51.4549, lng: -2.6278 }); // ≈ 2662
 */
export function haversineMetres(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Options for estimating walking time.
 *
 * @typedef {object} WalkOptions
 * @property {number} [speedKmh=4.5] Walking speed of the whole group in km/h. Must be greater than 0.
 * @property {number} [detourFactor=1.3] How much longer the walk along streets is than the straight line. Must be at least 1.
 */

/**
 * Estimates the time taken to walk between two points. Streets aren't
 * straight, so the straight-line distance is multiplied by a detour factor.
 *
 * @param {LatLng} a Where the walk starts.
 * @param {LatLng} b Where the walk ends.
 * @param {WalkOptions} [options] Walking speed and detour factor.
 * @returns {number} The estimated walking time in seconds.
 * @throws {RangeError} If `speedKmh` isn't greater than 0 or `detourFactor` is less than 1.
 * @example
 * walkSeconds({ lat: 51.4556, lng: -2.5894 }, { lat: 51.4492, lng: -2.5813 }); // ≈ 943 (about 16 minutes)
 */
export function walkSeconds(a, b, { speedKmh = 4.5, detourFactor = 1.3 } = {}) {
  if (!(speedKmh > 0)) {
    throw new RangeError(`speedKmh must be greater than 0, but was ${speedKmh}`);
  }
  if (!(detourFactor >= 1)) {
    throw new RangeError(`detourFactor must be at least 1, but was ${detourFactor}`);
  }
  const metresPerSecond = (speedKmh * 1000) / 3600;
  return (haversineMetres(a, b) * detourFactor) / metresPerSecond;
}
