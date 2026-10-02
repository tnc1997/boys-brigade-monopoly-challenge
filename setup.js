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
 * }} SavedPlan
 */

/**
 * The result of planning from the setup form.
 *
 * @typedef {object} SetupResult
 * @property {SavedPlan | null} plan The plan, or `null` if the form has a problem that stops planning.
 * @property {string | null} error What stops planning, or `null` if a plan was made.
 * @property {import('./locations.js').ParsedLocationLine[]} invalidLines Lines of the location list that couldn't be used. They don't stop planning.
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
 * rest from being planned.
 *
 * @param {object} options The setup form and settings.
 * @param {import('./storage.js').Setup} options.setup What was entered in the setup form.
 * @param {import('./storage.js').Settings} options.settings Settings for planning.
 * @param {number} options.now The current time, in milliseconds since the Unix epoch.
 * @returns {SetupResult} The plan, or what stops planning, and any unusable lines.
 */
export function planFromSetup({ setup, settings, now }) {
  const lines = parseLocations(setup.locationsText);
  const invalidLines = lines.filter(({ result }) => !result.isValid);
  const failure = (error) => ({ plan: null, error, invalidLines });

  const points = lines.filter(({ result }) => result.isValid).map(({ result }) => result.location);
  if (points.length === 0) {
    return failure('Add at least one location with its coordinates.');
  }

  const start = parseLocation(setup.startText);
  if (!start.isValid) {
    return failure(`Start: ${start.error}`);
  }
  const finish = setup.finishText.trim() === '' ? null : parseLocation(setup.finishText);
  if (finish && !finish.isValid) {
    return failure(`Finish: ${finish.error}`);
  }

  const startTime = setup.startTimeText.trim() === '' ? now : timeToday(setup.startTimeText, now);
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
  const result = plan({ start: start.location, points, finish: finish?.location ?? null, startTime, deadline, ...planSettings });

  return {
    plan: { ...result, points, start: start.location, finish: finish?.location ?? null, startTime, deadline, settings: planSettings },
    error: null,
    invalidLines,
  };
}
