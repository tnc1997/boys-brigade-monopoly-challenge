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

/**
 * Options for timing a route.
 *
 * @typedef {object} RouteOptions
 * @property {LatLng} start Where the team is at `startTime`.
 * @property {LatLng[]} stops The locations to visit, in order.
 * @property {LatLng | null} [finish=null] Where the team must end up, or `null` if there's no physical finish.
 * @property {number} startTime When the route starts, in milliseconds since the Unix epoch (as from `Date.now()`).
 * @property {number} deadline When the team must have finished, in milliseconds since the Unix epoch.
 * @property {number} [speedKmh=4.5] Walking speed of the whole group in km/h.
 * @property {number} [detourFactor=1.3] How much longer the walk along streets is than the straight line.
 * @property {number} [dwellSeconds=180] Time spent at each stop taking the selfie, in seconds.
 * @property {number} [safetyMarginSeconds=900] Spare time to keep before the deadline, in seconds.
 */

/**
 * The timings of a route.
 *
 * @typedef {object} RouteTimeline
 * @property {number[]} arrivalTimes When the team arrives at each stop, in milliseconds since the Unix epoch, in the same order as `stops`.
 * @property {number} endEta When the route ends, in milliseconds since the Unix epoch. With a finish, this is the arrival time at the finish. Without one, it's when the last selfie is taken (or `startTime` if there are no stops).
 * @property {number} spareSeconds Time left between `endEta` and the deadline minus the safety margin. Negative when the route doesn't fit.
 * @property {boolean} isWithinBudget Whether the route ends no later than the deadline minus the safety margin.
 */

/**
 * Works out when the team reaches each stop on a route, when the route ends
 * and whether it ends in time. Each stop takes the walk to it plus the selfie
 * time there.
 *
 * @param {RouteOptions} options The route and the settings to time it with.
 * @returns {RouteTimeline} The arrival times, end ETA and whether the route fits the time budget.
 * @example
 * const startTime = Date.parse('2026-10-03T11:00:00+01:00');
 * evaluateRoute({
 *   start: { lat: 51.4556, lng: -2.5894 },
 *   stops: [{ lat: 51.4492, lng: -2.5813 }],
 *   startTime,
 *   deadline: Date.parse('2026-10-03T16:00:00+01:00'),
 * }).isWithinBudget; // true
 */
export function evaluateRoute({
  start,
  stops,
  finish = null,
  startTime,
  deadline,
  speedKmh = 4.5,
  detourFactor = 1.3,
  dwellSeconds = 180,
  safetyMarginSeconds = 900,
}) {
  const walkOptions = { speedKmh, detourFactor };
  const arrivalTimes = [];
  let position = start;
  let time = startTime;

  for (const [index, stop] of stops.entries()) {
    if (index > 0) {
      time += dwellSeconds * 1000;
    }
    time += walkSeconds(position, stop, walkOptions) * 1000;
    arrivalTimes.push(time);
    position = stop;
  }

  if (stops.length > 0) {
    time += dwellSeconds * 1000;
  }
  if (finish) {
    time += walkSeconds(position, finish, walkOptions) * 1000;
  }

  const spareSeconds = (deadline - safetyMarginSeconds * 1000 - time) / 1000;
  return { arrivalTimes, endEta: time, spareSeconds, isWithinBudget: spareSeconds >= 0 };
}
