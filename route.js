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
 */

/**
 * The route, ready to show.
 *
 * @typedef {object} RouteView
 * @property {RouteStop[]} stops The stops in visiting order.
 * @property {RouteStop | null} finish The walk to the finish, or `null` if there's no finish. Its `number` is 0.
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

/**
 * Describes a saved plan as a line and markers to draw on the map. Stops are
 * numbered in visiting order, as in the list. Done locations that aren't on
 * the route are marked as done, and skipped locations are included so they
 * can be greyed out.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan.
 * @param {string[]} doneKeys Keys of the locations whose selfie has been taken.
 * @param {(time: number) => string} formatTime Formats a time for the marker descriptions.
 * @returns {{ path: import('./planner.js').LatLng[], markers: import('./map.js').MapMarker[] }} The line and the markers.
 */
export function mapRoute(plan, doneKeys, formatTime) {
  const route = describeRoute(plan);
  const done = new Set(doneKeys);
  const routeKeys = new Set(route.stops.map(({ location }) => location.key));

  /** @type {import('./map.js').MapMarker[]} */
  const markers = [{ kind: 'start', location: plan.start, label: 'S', title: `Start: ${plan.start.label}` }];
  for (const { number, location, arrivalTime } of route.stops) {
    const isDone = done.has(location.key);
    markers.push({
      kind: isDone ? 'done' : 'stop',
      location,
      label: String(number),
      title: `${number}. ${location.label}, ETA ${formatTime(arrivalTime)}${isDone ? ', selfie done' : ''}`,
    });
  }
  for (const location of plan.points) {
    if (done.has(location.key) && !routeKeys.has(location.key)) {
      markers.push({ kind: 'done', location, label: '✓', title: `${location.label}, selfie done` });
    }
  }
  if (route.finish) {
    markers.push({
      kind: 'finish',
      location: route.finish.location,
      label: '🏁',
      title: `Finish: ${route.finish.location.label}, arrive ${formatTime(route.finish.arrivalTime)}`,
    });
  }
  for (const location of route.skipped) {
    markers.push({ kind: 'skipped', location, label: '', title: `${location.label}, skipped: not enough time` });
  }

  const path = [plan.start, ...route.stops.map(({ location }) => location), ...(route.finish ? [route.finish.location] : [])];
  return { path, markers };
}

/**
 * A warning that time is running out.
 *
 * @typedef {object} TimeWarning
 * @property {string} message What to tell the team, which depends on whether there's a finish.
 * @property {number} minutesLeft Minutes until the deadline, rounded up (0 once it has passed).
 * @property {number} minutesBehind Whole minutes the team is behind the plan (0 if on time).
 */

/**
 * Works out whether to warn the team that time is running out. It warns when
 * the time left before the deadline is down to the safety margin, or when
 * the team is running late for the next stop by enough to push the end of
 * the route into the safety margin.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan.
 * @param {string[]} doneKeys Keys of the locations whose selfie has been taken.
 * @param {number} now The current time, in milliseconds since the Unix epoch.
 * @returns {TimeWarning | null} The warning, or `null` if there's enough time.
 * @example
 * timeWarning(plan, [], deadline - 10 * 60_000);
 * // { message: 'Head to the finish now: 10 minutes until the deadline.', minutesLeft: 10, minutesBehind: 0 }
 */
export function timeWarning(plan, doneKeys, now) {
  const marginMs = plan.settings.safetyMarginSeconds * 1000;
  const leftMs = plan.deadline - now;
  const minutesLeft = Math.max(0, Math.ceil(leftMs / 60000));

  // How late the team is for the first stop that isn't done yet.
  const done = new Set(doneKeys);
  const next = plan.order.findIndex((index) => !done.has(plan.points[index].key));
  const behindMs = next === -1 ? 0 : Math.max(0, now - plan.arrivalTimes[next]);
  const minutesBehind = Math.floor(behindMs / 60000);

  const isShortOfTime = leftMs <= marginMs;
  const isRunningLate = plan.endEta + behindMs > plan.deadline - marginMs;
  // With every stop done and no finish to reach, there's nothing to hurry for.
  const isAllDone = next === -1 && !plan.finish;
  if ((!isShortOfTime && !isRunningLate) || (isAllDone && leftMs > 0)) {
    return null;
  }

  let message;
  if (leftMs <= 0) {
    message = plan.finish ? 'The deadline has passed. Head to the finish now.' : "The deadline has passed. Time's up.";
  } else {
    const time = `${minutesLeft} ${minutesLeft === 1 ? 'minute' : 'minutes'} until the deadline`;
    message = plan.finish ? `Head to the finish now: ${time}.` : `Last few selfies, time's nearly up: ${time}.`;
    if (!isShortOfTime) {
      message = `Running ${minutesBehind} ${minutesBehind === 1 ? 'minute' : 'minutes'} behind plan, so the route may not fit. Re-plan from here to see what still fits.`;
    }
  }
  return { message, minutesLeft, minutesBehind };
}

/**
 * Describes the time left until the deadline, for the countdown in the header.
 *
 * @param {number | null} deadline The deadline in milliseconds since the Unix epoch, or `null` if it isn't set.
 * @param {number} now The current time, in milliseconds since the Unix epoch.
 * @returns {string} The time left, like `3 h 12 min left`, or a message once the deadline has passed or if it isn't set.
 * @example
 * countdownText(Date.parse('2026-10-03T16:00:00'), Date.parse('2026-10-03T12:48:00')); // '3 h 12 min left'
 */
export function countdownText(deadline, now) {
  if (deadline === null || !Number.isFinite(deadline)) {
    return 'No deadline set';
  }
  const leftSeconds = (deadline - now) / 1000;
  if (leftSeconds <= 0) {
    return 'Deadline passed';
  }
  // Round up, so the countdown doesn't show "under 1 min" while a minute is left.
  return `${formatDuration(Math.ceil(leftSeconds / 60) * 60)} left`;
}
