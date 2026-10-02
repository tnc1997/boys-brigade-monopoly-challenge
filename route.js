import { walkSeconds } from './planner.js';

/**
 * A stop on the route, ready to show.
 *
 * @typedef {object} RouteStop
 * @property {number} number The stop's position in the route, starting at 1.
 * @property {import('./locations.js').Location} location The location.
 * @property {number} arrivalTime When the team arrives, in milliseconds since the Unix epoch.
 * @property {number} walkSeconds How long the walk from the previous stop (or the start) takes, in seconds.
 * @property {string} directionsUrl A Google Maps link with walking directions to the location.
 * @property {string | null} what3wordsUrl A link to the location's what3words address, or `null` if it doesn't have one.
 */

/**
 * The route, ready to show.
 *
 * @typedef {object} RouteView
 * @property {RouteStop[]} stops The stops in visiting order.
 * @property {RouteStop | null} finish The walk to the finish, or `null` if there's no finish. Its `number` is 0 and its `what3wordsUrl` is `null` unless the finish has a what3words address.
 * @property {number} endEta When the route ends, in milliseconds since the Unix epoch.
 * @property {import('./locations.js').Location[]} skipped The locations that don't fit, in list order.
 */

/**
 * Creates a Google Maps link with walking directions from the current
 * position to a location.
 *
 * @param {import('./planner.js').LatLng} location Where to go.
 * @returns {string} The link.
 * @example
 * directionsUrl({ lat: 51.4545, lng: -2.5879 });
 * // 'https://www.google.com/maps/dir/?api=1&destination=51.4545%2C-2.5879&travelmode=walking'
 */
export function directionsUrl({ lat, lng }) {
  const params = new URLSearchParams({ api: '1', destination: `${lat},${lng}`, travelmode: 'walking' });
  return `https://www.google.com/maps/dir/?${params}`;
}

/**
 * Formats a duration as minutes, or hours and minutes, rounding to the
 * nearest minute.
 *
 * @param {number} seconds The duration in seconds.
 * @returns {string} The duration, like `16 min` or `1 h 5 min`.
 * @example
 * formatDuration(943); // '16 min'
 */
export function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) {
    return 'under 1 min';
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Describes a saved plan as stops to show, with walk times and links.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan.
 * @returns {RouteView} The stops, the walk to the finish, the end ETA and the skipped locations.
 */
export function describeRoute(plan) {
  const walkOptions = { speedKmh: plan.settings.speedKmh, detourFactor: plan.settings.detourFactor };
  const stop = (number, location, previous, arrivalTime) => ({
    number,
    location,
    arrivalTime,
    walkSeconds: walkSeconds(previous, location, walkOptions),
    directionsUrl: directionsUrl(location),
    what3wordsUrl: location.words ? `https://what3words.com/${location.words}` : null,
  });

  const stops = plan.order.map((index, position) =>
    stop(position + 1, plan.points[index], position === 0 ? plan.start : plan.points[plan.order[position - 1]], plan.arrivalTimes[position]),
  );
  const last = stops.length === 0 ? plan.start : stops[stops.length - 1].location;

  return {
    stops,
    finish: plan.finish ? stop(0, plan.finish, last, plan.endEta) : null,
    endEta: plan.endEta,
    skipped: plan.skipped.map((index) => plan.points[index]),
  };
}

/**
 * Marks a location's selfie as done, or as not done if it already was.
 *
 * @param {string[]} doneKeys Keys of the locations whose selfie has been taken.
 * @param {string} key The key of the location to toggle.
 * @returns {string[]} The new list of keys. The original isn't changed.
 * @example
 * toggleDone(['a'], 'b'); // ['a', 'b']
 * toggleDone(['a', 'b'], 'a'); // ['b']
 */
export function toggleDone(doneKeys, key) {
  return doneKeys.includes(key) ? doneKeys.filter((doneKey) => doneKey !== key) : [...doneKeys, key];
}

/**
 * Counts how many of a plan's locations have had their selfie taken.
 * Keys of locations that aren't in the plan (for example from an earlier
 * list) aren't counted.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan.
 * @param {string[]} doneKeys Keys of the locations whose selfie has been taken.
 * @returns {{ done: number, total: number }} The number of locations done, and the number in the list.
 */
export function progress(plan, doneKeys) {
  const done = new Set(doneKeys);
  return { done: plan.points.filter(({ key }) => done.has(key)).length, total: plan.points.length };
}
