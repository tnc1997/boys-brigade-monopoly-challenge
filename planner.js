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

/**
 * Options for planning a route, the same as {@link RouteOptions} except that
 * `points` are the candidate locations in any order, rather than `stops` in
 * visiting order.
 *
 * @typedef {Omit<RouteOptions, 'stops'> & { points: LatLng[] }} PlanOptions
 */

/**
 * Builds a route by greedy insertion. It repeatedly adds the unvisited point
 * that adds the least time at its cheapest position in the route, for as long
 * as the route still fits within the deadline minus the safety margin. With a
 * finish, the route runs start → … → finish. Without one, it runs start → … →
 * last stop, so adding a point at the end costs only the walk to it.
 *
 * @param {PlanOptions} options The candidate points and the settings to plan with.
 * @returns {number[]} Indexes into `points`, in visiting order. Points that don't fit are left out.
 * @example
 * greedyInsertion({
 *   start: { lat: 51.4556, lng: -2.5894 },
 *   points: [{ lat: 51.4549, lng: -2.6278 }, { lat: 51.4492, lng: -2.5813 }],
 *   startTime: Date.parse('2026-10-03T11:00:00+01:00'),
 *   deadline: Date.parse('2026-10-03T16:00:00+01:00'),
 * }); // [1, 0]
 */
export function greedyInsertion({
  start,
  points,
  finish = null,
  startTime,
  deadline,
  speedKmh = 4.5,
  detourFactor = 1.3,
  dwellSeconds = 180,
  safetyMarginSeconds = 900,
}) {
  // Nodes are the start, then each point, then the finish (if there is one).
  const nodes = [start, ...points, ...(finish ? [finish] : [])];
  const walk = nodes.map((a) => nodes.map((b) => walkSeconds(a, b, { speedKmh, detourFactor })));
  const startNode = 0;
  const finishNode = finish ? nodes.length - 1 : null;
  const budgetSeconds = (deadline - startTime) / 1000 - safetyMarginSeconds;

  // The route holds point nodes (1 to points.length) in visiting order.
  const route = [];
  let routeSeconds = finishNode === null ? 0 : walk[startNode][finishNode];
  const unvisited = new Set(points.map((_, index) => index + 1));

  while (unvisited.size > 0) {
    let best = null;
    for (const node of unvisited) {
      for (let position = 0; position <= route.length; position += 1) {
        const previous = position === 0 ? startNode : route[position - 1];
        const next = position === route.length ? finishNode : route[position];
        const addedSeconds =
          dwellSeconds +
          walk[previous][node] +
          (next === null ? 0 : walk[node][next] - walk[previous][next]);
        if (best === null || addedSeconds < best.addedSeconds) {
          best = { node, position, addedSeconds };
        }
      }
    }
    if (routeSeconds + best.addedSeconds > budgetSeconds) {
      break;
    }
    route.splice(best.position, 0, best.node);
    routeSeconds += best.addedSeconds;
    unvisited.delete(best.node);
  }

  return route.map((node) => node - 1);
}

/**
 * A planned route.
 *
 * @typedef {object} Plan
 * @property {number[]} order Indexes into `points` in visiting order.
 * @property {number[]} arrivalTimes When the team arrives at each stop in `order`, in milliseconds since the Unix epoch.
 * @property {number} endEta When the route ends, in milliseconds since the Unix epoch. With a finish, this is the arrival time at the finish. Without one, it's when the last selfie is taken.
 * @property {number} spareSeconds Time left between `endEta` and the deadline minus the safety margin. Negative only when even the walk to the finish doesn't fit.
 * @property {number[]} skipped Indexes into `points` that aren't in `order`, in ascending order.
 */

/**
 * Plans the route that visits as many points as possible before the deadline
 * minus the safety margin, ending at the finish if there is one.
 *
 * @param {PlanOptions} options The candidate points and the settings to plan with.
 * @returns {Plan} The visiting order, the timings and the points left out.
 * @throws {RangeError} If `speedKmh` isn't greater than 0 or `detourFactor` is less than 1.
 * @example
 * const { order, skipped } = plan({
 *   start: { lat: 51.4556, lng: -2.5894 },
 *   points: [{ lat: 51.4549, lng: -2.6278 }, { lat: 51.4492, lng: -2.5813 }],
 *   finish: null,
 *   startTime: Date.parse('2026-10-03T11:00:00+01:00'),
 *   deadline: Date.parse('2026-10-03T16:00:00+01:00'),
 * });
 * order; // [1, 0]
 * skipped; // []
 */
export function plan(options) {
  const order = greedyInsertion(options);
  const { arrivalTimes, endEta, spareSeconds } = evaluateRoute({
    ...options,
    stops: order.map((index) => options.points[index]),
  });
  const visited = new Set(order);
  const skipped = options.points.map((_, index) => index).filter((index) => !visited.has(index));
  return { order, arrivalTimes, endEta, spareSeconds, skipped };
}
