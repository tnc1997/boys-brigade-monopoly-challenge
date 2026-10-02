/**
 * Settings for planning, which can be changed during the challenge.
 *
 * @typedef {object} Settings
 * @property {number} speedKmh Walking speed of the whole group in km/h.
 * @property {number} detourFactor How much longer the walk along streets is than the straight line.
 * @property {number} dwellSeconds Time spent at each stop taking the selfie, in seconds.
 * @property {number} safetyMarginSeconds Spare time to keep before the deadline, in seconds.
 * @property {string} deadline The time the team must have finished by, as `HH:MM` local time.
 */

/**
 * What was entered in the setup form, kept as typed so it can be shown again.
 *
 * @typedef {object} Setup
 * @property {string} locationsText The location list, one location per line.
 * @property {string} startText Where the route starts.
 * @property {string} finishText Where the route finishes, or an empty string if there's no physical finish.
 * @property {string} startTimeText When the route starts, as `HH:MM` local time, or an empty string to start when Plan route is pressed.
 */

/**
 * Everything the app saves between visits.
 *
 * @typedef {object} AppState
 * @property {number} version The schema version the state was saved with.
 * @property {Settings} settings Settings for planning.
 * @property {Setup} setup What was entered in the setup form.
 * @property {string[]} doneKeys Keys of the locations whose selfie has been taken.
 * @property {'list' | 'map'} view Which tab of the Route section is showing.
 * @property {import('./search.js').SearchResults} searchResults Saved results of looking up addresses and place names, so each is only looked up once and re-planning works offline. Temporary failures aren't saved.
 * @property {import('./setup.js').SavedPlan | null} plan The current plan, or `null` if there isn't one yet.
 */

/**
 * A minimal subset of the Web Storage API, so tests can pass in a fake.
 *
 * @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} StateStorage
 */

/** The localStorage key the state is saved under. */
export const STORAGE_KEY = 'monopoly-challenge-planner';

/** The current schema version. Increase it when the shape of {@link AppState} changes. */
export const SCHEMA_VERSION = 1;

/**
 * Creates the state for a new challenge.
 *
 * @returns {AppState} The default state, starting at Castle Park with a 16:00 deadline.
 */
export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      speedKmh: 4.5,
      detourFactor: 1.3,
      dwellSeconds: 180,
      safetyMarginSeconds: 900,
      deadline: '16:00',
    },
    setup: {
      locationsText: '',
      startText: 'Castle Park 51.4556,-2.5894',
      finishText: '',
      startTimeText: '',
    },
    doneKeys: [],
    view: 'list',
    searchResults: {},
    plan: null,
  };
}

/**
 * Gets the browser's localStorage, which can be missing or throw (for example
 * in a private window or when site data is blocked).
 *
 * @returns {StateStorage | null} localStorage, or `null` if it isn't available.
 */
function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Loads the saved state. Anything missing, unreadable or saved with a
 * different schema version falls back to the defaults, so the app always
 * gets a complete state.
 *
 * @param {StateStorage | null} [storage] Where to load from. Defaults to the browser's localStorage.
 * @returns {AppState} The saved state, or the default state.
 * @example
 * const state = loadState();
 * state.settings.speedKmh; // 4.5 on first visit
 */
export function loadState(storage = browserStorage()) {
  const defaults = defaultState();
  let saved;
  try {
    const text = storage?.getItem(STORAGE_KEY);
    saved = text ? JSON.parse(text) : null;
  } catch {
    return defaults;
  }
  if (!isObject(saved) || saved.version !== SCHEMA_VERSION) {
    return defaults;
  }
  return {
    version: SCHEMA_VERSION,
    settings: { ...defaults.settings, ...(isObject(saved.settings) ? saved.settings : {}) },
    setup: { ...defaults.setup, ...(isObject(saved.setup) ? saved.setup : {}) },
    doneKeys: Array.isArray(saved.doneKeys) ? saved.doneKeys.filter((key) => typeof key === 'string') : [],
    view: saved.view === 'map' ? 'map' : 'list',
    searchResults: isObject(saved.searchResults) ? saved.searchResults : {},
    plan: isObject(saved.plan) ? saved.plan : null,
  };
}

/**
 * Saves the state. Failing to save (for example when storage is full or
 * blocked) doesn't throw, so the app keeps working for this visit.
 *
 * @param {AppState} state The state to save.
 * @param {StateStorage | null} [storage] Where to save to. Defaults to the browser's localStorage.
 * @returns {boolean} Whether the state was saved.
 */
export function saveState(state, storage = browserStorage()) {
  try {
    if (!storage) {
      return false;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: SCHEMA_VERSION }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes the saved state, for starting a new challenge.
 *
 * @param {StateStorage | null} [storage] Where to remove it from. Defaults to the browser's localStorage.
 * @returns {boolean} Whether the state was removed.
 */
export function clearState(storage = browserStorage()) {
  try {
    if (!storage) {
      return false;
    }
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
