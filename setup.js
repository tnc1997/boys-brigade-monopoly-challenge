import { parseLocation, parseLocations } from './locations.js';
import { plan } from './planner.js';

/**
 * A plan together with the locations and times it was made from, so it can
 * be shown again after the setup form has changed or the page has reloaded.
 *
 * @typedef {import('./planner.js').Plan & {
 *   points: import('./locations.js').Location[],
 *   start: import('./locations.js').Location,
 *   finish: import('./locations.js').Location | null,
 *   startTime: number,
 *   deadline: number,
 *   settings: Pick<import('./storage.js').Settings, 'speedKmh' | 'detourFactor' | 'dwellSeconds' | 'safetyMarginSeconds'>,
 *   isFromPosition: boolean,
 * }} SavedPlan
 * `isFromPosition` is whether the plan starts from the team's position (Re-plan from here) rather than the Start field.
 */

/**
 * The result of planning from the setup form.
 *
 * @typedef {object} SetupResult
 * @property {SavedPlan | null} plan The plan, or `null` if the form has a problem that stops planning.
 * @property {string | null} error What stops planning, or `null` if a plan was made.
 * @property {import('./locations.js').ParsedLocationLine[]} lines Every non-blank line of the location list with the result of parsing it.
 * @property {import('./locations.js').ParsedLocationLine[]} invalidLines Lines of the location list that couldn't be used. They don't stop planning.
 * @property {SearchMatch[]} matches What the Start and Finish fields matched when they're addresses or place names, so the team can check them. Lines of the location list show their own matches.
 */

/**
 * What an address or place name in the Start or Finish field matched.
 *
 * @typedef {object} SearchMatch
 * @property {'Start' | 'Finish'} source Which field it was typed in.
 * @property {string} label The location's label.
 * @property {string} matchedName The name of the place that was found.
 */

/**
 * Converts an `HH:MM` time to a moment on the same local day as `now`.
 *
 * @param {string} time The time as `HH:MM`, from a time input.
 * @param {number} now The current time, in milliseconds since the Unix epoch.
 * @returns {number | null} The moment in milliseconds since the Unix epoch, or `null` if `time` isn't a valid `HH:MM` time.
 * @example
 * timeToday('16:00', Date.parse('2026-10-03T10:45:00+01:00')); // Date.parse('2026-10-03T16:00:00+01:00')
 */
export function timeToday(time, now) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) {
    return null;
  }
  const date = new Date(now);
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date.getTime();
}

/**
 * Parses the setup form and plans the route. Lines of the location list
 * that can't be used are returned so they can be shown, but don't stop the
 * rest from being planned. Locations whose selfie is done are kept in the
 * plan's `points` but left out of the route.
 *
 * To re-plan during the challenge, pass the team's position as `from`: the
 * route then starts there and now, instead of at the Start field and start
 * time.
 *
 * @param {object} options The setup form and settings.
 * @param {import('./storage.js').Setup} options.setup What was entered in the setup form.
 * @param {import('./storage.js').Settings} options.settings Settings for planning.
 * @param {number} options.now The current time, in milliseconds since the Unix epoch.
 * @param {string[]} [options.doneKeys=[]] Keys of the locations whose selfie has been taken.
 * @param {import('./search.js').SearchResults} [options.searchResults={}] Search results for addresses and place names, by `searchKey`.
 * @param {import('./planner.js').LatLng | null} [options.from=null] The team's current position, to re-plan from.
 * @returns {SetupResult} The plan, or what stops planning, and any unusable lines.
 */
export function planFromSetup({ setup, settings, now, doneKeys = [], from = null, searchResults = {} }) {
  const lines = parseLocations(setup.locationsText, { searchResults });
  const invalidLines = lines.filter(({ result }) => !result.isValid);
  // The Start and Finish fields are parsed first, so what they matched can be
  // shown even when planning stops because of the location list.
  const start = from
    ? { isValid: true, location: { lat: from.lat, lng: from.lng, label: 'Your position', key: `${from.lat.toFixed(6)},${from.lng.toFixed(6)}` } }
    : parseLocation(setup.startText, { searchResults });
  const finish = setup.finishText.trim() === '' ? null : parseLocation(setup.finishText, { searchResults });
  /** @type {SearchMatch[]} */
  const matches = [];
  for (const [source, parsed] of /** @type {const} */ ([
    ['Start', from ? null : start],
    ['Finish', finish],
  ])) {
    if (parsed?.isValid && parsed.location.matchedName) {
      matches.push({ source, label: parsed.location.label, matchedName: parsed.location.matchedName });
    }
  }
  const failure = (error) => ({ plan: null, error, lines, invalidLines, matches });

  const points = lines.filter(({ result }) => result.isValid).map(({ result }) => result.location);
  if (points.length === 0) {
    return failure('Add at least one location with its coordinates.');
  }

  if (!start.isValid) {
    return failure(`Start: ${start.error}`);
  }
  if (finish && !finish.isValid) {
    return failure(`Finish: ${finish.error}`);
  }

  const startTime = from || setup.startTimeText.trim() === '' ? now : timeToday(setup.startTimeText, now);
  if (startTime === null) {
    return failure('Start time: Enter a time like 11:00, or leave it blank to start now.');
  }
  const deadline = timeToday(settings.deadline, now);
  if (deadline === null) {
    return failure('Deadline: Enter a time like 16:00.');
  }
  if (deadline <= startTime) {
    return failure('Deadline: The deadline must be after the start time.');
  }
  if (!(settings.speedKmh > 0)) {
    return failure('Walking speed: Enter a speed greater than 0 km/h.');
  }
  if (!(settings.dwellSeconds >= 0)) {
    return failure('Selfie time: Enter a time of 0 minutes or more.');
  }

  const planSettings = {
    speedKmh: settings.speedKmh,
    detourFactor: settings.detourFactor,
    dwellSeconds: settings.dwellSeconds,
    safetyMarginSeconds: settings.safetyMarginSeconds,
  };
  // Plan only the locations still to visit, then map the result back to
  // indexes into every location, leaving done ones out of `skipped`.
  const done = new Set(doneKeys);
  const remaining = points.map((point, index) => ({ point, index })).filter(({ point }) => !done.has(point.key));
  const result = plan({
    start: start.location,
    points: remaining.map(({ point }) => point),
    finish: finish?.location ?? null,
    startTime,
    deadline,
    ...planSettings,
  });
  const toPointIndex = (index) => remaining[index].index;

  return {
    plan: {
      ...result,
      order: result.order.map(toPointIndex),
      skipped: result.skipped.map(toPointIndex),
      points,
      start: start.location,
      finish: finish?.location ?? null,
      startTime,
      deadline,
      settings: planSettings,
      isFromPosition: from !== null,
    },
    error: null,
    lines,
    invalidLines,
    matches,
  };
}

/**
 * Lists the addresses and place names in the setup form that still need
 * looking up: lines of the location list, the Start field (unless
 * re-planning from the team's position) and the Finish field.
 *
 * @param {object} options The setup form.
 * @param {import('./storage.js').Setup} options.setup What was entered in the setup form.
 * @param {import('./search.js').SearchResults} [options.searchResults={}] Search results already known, by `searchKey`.
 * @param {boolean} [options.isFromPosition=false] Whether the route starts from the team's position, so the Start field isn't used.
 * @returns {string[]} The addresses and place names to look up.
 */
export function searchesNeeded({ setup, searchResults = {}, isFromPosition = false }) {
  const parsed = [
    ...parseLocations(setup.locationsText, { searchResults }).map(({ result }) => result),
    ...(isFromPosition ? [] : [parseLocation(setup.startText, { searchResults })]),
    ...(setup.finishText.trim() === '' ? [] : [parseLocation(setup.finishText, { searchResults })]),
  ];
  return parsed.filter((result) => !result.isValid && result.query).map((result) => result.query);
}
