import { describeRoute, formatDuration, mapRoute, progress, toggleDone } from './route.js';
import { searchPlaces } from './search.js';
import { parseLocations } from './locations.js';
import { createMap, showPosition, showRoute } from './map.js';
import { SPEED_PRESETS, SPEED_RANGE, speedPreset } from './settings.js';
import { planFromSetup, searchesNeeded } from './setup.js';
import { defaultState, loadState, saveState } from './storage.js';

/** The app's state, loaded from the previous visit if there was one. */
const state = loadState();

const form = /** @type {HTMLFormElement} */ (document.getElementById('setup-form'));
const locationLines = /** @type {HTMLOListElement} */ (document.getElementById('location-lines'));
const locationsField = /** @type {HTMLTextAreaElement} */ (document.getElementById('locations'));
const setupError = /** @type {HTMLParagraphElement} */ (document.getElementById('setup-error'));
const stopList = /** @type {HTMLDivElement} */ (document.getElementById('stop-list'));
const replan = /** @type {HTMLDivElement} */ (document.getElementById('replan'));
const replanButton = /** @type {HTMLButtonElement} */ (document.getElementById('replan-button'));
const replanStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('replan-status'));
const searchStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('search-status'));
const locationMatches = /** @type {HTMLDivElement} */ (document.getElementById('location-matches'));
const locationMatchesList = /** @type {HTMLUListElement} */ (document.getElementById('location-matches-list'));
const planButton = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
const tabs = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[role="tab"][data-view]')]);
const mapContainer = /** @type {HTMLDivElement} */ (document.getElementById('map'));
const settingsButton = /** @type {HTMLButtonElement} */ (document.getElementById('settings-button'));
const settingsDialog = /** @type {HTMLDialogElement} */ (document.getElementById('settings-dialog'));
const speedPresets = /** @type {HTMLDivElement} */ (document.getElementById('speed-presets'));
const speedSlider = /** @type {HTMLInputElement} */ (document.getElementById('settings-speed'));
const speedValue = /** @type {HTMLOutputElement} */ (document.getElementById('settings-speed-value'));
const settingsSave = /** @type {HTMLButtonElement} */ (document.getElementById('settings-save'));

/** The settings panel's other fields, bound to `state.settings` or `state.setup` by their data attributes. */
const panelFields = /** @type {NodeListOf<HTMLInputElement>} */ (settingsDialog.querySelectorAll('[data-panel-setting], [data-panel-setup]'));
const mapStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('map-status'));

/** The map, created the first time the Map tab is shown, because Leaflet needs a visible container. */
let routeMap = null;

/** Whether the map should zoom to fit the route the next time it's drawn, as after planning. */
let shouldFitMap = true;

/** The team's latest position from watching the location, or `null` if there isn't one yet. */
let latestPosition = null;

/** Whether the location is being watched, which starts the first time the map is shown. */
let isWatchingPosition = false;

/** How old a watched position can be and still be used to re-plan, in milliseconds. */
const POSITION_MAX_AGE_MS = 60000;

/** The setup form's fields, which are bound to `state.setup` or `state.settings` by their data attributes. */
const fields = /** @type {NodeListOf<HTMLInputElement | HTMLTextAreaElement>} */ (form.querySelectorAll('[data-setup], [data-setting]'));

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Creates an element with optional classes and text.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag The element's tag name.
 * @param {string} [className] The element's classes.
 * @param {string} [text] The element's text.
 * @returns {HTMLElementTagNameMap[K]} The element.
 */
function element(tag, className = '', text = '') {
  const created = document.createElement(tag);
  created.className = className;
  created.textContent = text;
  return created;
}

/** Fills the setup form from the state. */
function fillForm() {
  for (const field of fields) {
    if (field.dataset.setup) {
      field.value = state.setup[field.dataset.setup];
    } else {
      const value = state.settings[field.dataset.setting];
      field.value = field.dataset.scale ? String(value / Number(field.dataset.scale)) : String(value);
    }
  }
}

/**
 * Saves a field's value to the state.
 *
 * @param {HTMLInputElement | HTMLTextAreaElement} field The field that changed.
 */
function saveField(field) {
  if (field.dataset.setup) {
    state.setup[field.dataset.setup] = field.value;
  } else if (field.dataset.number !== undefined) {
    const value = field.value.trim() === '' ? NaN : Number(field.value);
    state.settings[field.dataset.setting] = field.dataset.scale ? value * Number(field.dataset.scale) : value;
  } else {
    state.settings[field.dataset.setting] = field.value;
  }
  saveState(state);
}

/**
 * Shows the status of each line of the location list: ready to plan (with
 * its label, and what an address matched), still to look up, or what's wrong.
 *
 * @param {import('./locations.js').ParsedLocationLine[]} lines The lines to show.
 */
function showLines(lines) {
  locationLines.replaceChildren(
    ...lines.map(({ lineNumber, result }) => {
      const item = element('li', 'flex gap-2 break-words');
      let icon;
      let status;
      let text;
      if (result.isValid) {
        icon = element('span', 'text-accent-ink', '✓');
        status = 'Ready';
        const { label, matchedName } = result.location;
        text = element('span', '', matchedName ? `Line ${lineNumber}: ${label} → ${matchedName}` : `Line ${lineNumber}: ${label}`);
      } else if (result.query) {
        icon = element('span', 'text-muted', '⌕');
        status = 'To look up';
        text = element('span', 'text-muted', `Line ${lineNumber}: "${result.query}" will be looked up when you press Plan route`);
      } else {
        icon = element('span', 'text-danger', '✗');
        status = 'Problem';
        text = element('span', 'text-danger', `Line ${lineNumber}: ${result.error}`);
      }
      icon.setAttribute('aria-hidden', 'true');
      text.prepend(element('span', 'sr-only', `${status}: `));
      item.append(icon, text);
      return item;
    }),
  );
}

/** Shows the status of each line as typed, using only saved search results so typing never searches. */
function previewLines() {
  showLines(parseLocations(state.setup.locationsText, { searchResults: state.searchResults }));
}

/**
 * Shows what stops planning, or hides the message.
 *
 * @param {string | null} error The message, or `null` to hide it.
 */
function showSetupError(error) {
  setupError.textContent = error ?? '';
  setupError.classList.toggle('hidden', error === null);
}

/**
 * Creates a link that opens in a new tab.
 *
 * @param {string} href Where the link goes.
 * @param {string} text The link's text.
 * @param {string} label The link's accessible name, if it should say more than its text.
 * @returns {HTMLAnchorElement} The link.
 */
function externalLink(href, text, label = text) {
  const link = element(
    'a',
    'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-accent-ink ring-1 ring-accent/30 hover:bg-accent-soft',
    text,
  );
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  if (label !== text) {
    link.setAttribute('aria-label', label);
  }
  return link;
}

/**
 * Creates the button that marks a location's selfie as done, or not done.
 *
 * @param {import('./locations.js').Location} location The location.
 * @param {boolean} isDone Whether the selfie is done.
 * @returns {HTMLButtonElement} The button.
 */
function doneToggle(location, isDone) {
  const toggle = element(
    'button',
    `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold ${isDone ? 'bg-accent text-white hover:bg-accent-strong' : 'bg-surface text-accent-ink ring-1 ring-accent hover:bg-accent-soft'}`,
    isDone ? '✓ Selfie done' : 'Mark selfie done',
  );
  toggle.type = 'button';
  toggle.dataset.doneKey = location.key;
  toggle.setAttribute('aria-pressed', String(isDone));
  toggle.setAttribute('aria-label', `Selfie done at ${location.label}`);
  return toggle;
}

/**
 * Creates the list item for a stop, or for the walk to the finish.
 *
 * @param {import('./route.js').RouteStop} stop The stop.
 * @param {boolean} isFinish Whether this is the walk to the finish.
 * @returns {HTMLLIElement} The list item.
 */
function stopItem(stop, isFinish) {
  const isDone = !isFinish && state.doneKeys.includes(stop.location.key);
  const item = element('li', `flex gap-3 rounded-md p-3 ring-1 ${isDone ? 'bg-accent-soft ring-accent-line' : 'ring-line'}`);
  const badgeColours = isFinish ? 'bg-ink text-surface' : isDone ? 'bg-accent-line text-accent-ink' : 'bg-accent text-white';
  const badge = element(
    'span',
    `flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${badgeColours}`,
    isFinish ? '🏁' : isDone ? '✓' : String(stop.number),
  );
  badge.setAttribute('aria-hidden', 'true');

  const details = element('div', 'flex min-w-0 flex-1 flex-col gap-1');
  const title = element('p', 'font-medium break-words', stop.location.label);
  const timing = element(
    'p',
    'text-sm text-muted',
    `${isFinish ? 'Finish · arrive' : 'ETA'} ${timeFormat.format(stop.arrivalTime)} · ${formatDuration(stop.walkSeconds)} walk`,
  );
  const links = element('div', 'mt-1 flex flex-wrap gap-2');
  if (!isFinish) {
    links.append(doneToggle(stop.location, isDone));
  }
  links.append(externalLink(stop.directionsUrl, 'Directions', `Walking directions to ${stop.location.label} in Google Maps`));
  details.append(title, timing, links);
  item.append(badge, details);
  return item;
}

/** Shows the current plan as a list of stops, then any skipped and done locations. */
function showPlan() {
  const { plan } = state;
  // Plans saved before walk settings were kept with the plan can't be shown, so they need planning again.
  const hasPlan = Boolean(plan?.settings);
  replan.classList.toggle('hidden', !hasPlan);
  replan.classList.toggle('flex', hasPlan);
  updateMap();
  if (!hasPlan) {
    stopList.replaceChildren(element('p', 'text-sm text-muted', 'Add your locations above and press Plan route.'));
    return;
  }
  const route = describeRoute(plan);
  const ending = route.finish ? `arriving at the finish at ${timeFormat.format(route.endEta)}` : `with the last selfie at ${timeFormat.format(route.endEta)}`;
  const { done, total } = progress(plan, state.doneKeys);
  // Count only stops still to visit, since a stop on this route may have
  // been ticked off since it was planned.
  const stopsToVisit = route.stops.filter(({ location }) => !state.doneKeys.includes(location.key)).length;
  const remaining = total - done;
  const locations = (count) => (count === 1 ? 'location' : 'locations');
  const visiting = done === 0 ? `${stopsToVisit} of ${total} ${locations(total)}` : `${stopsToVisit} of ${remaining} ${locations(remaining)} still to do`;
  const summary = element('p', 'text-sm', `Visiting ${visiting}, ${ending}.`);
  const counter = element('p', 'mt-1 text-sm font-semibold text-accent-ink', `Selfies done: ${done} of ${total}`);
  counter.setAttribute('aria-live', 'polite');

  const stops = element('ol', 'mt-3 flex flex-col gap-2');
  stops.setAttribute('aria-label', 'Stops in order');
  stops.append(...route.stops.map((stop) => stopItem(stop, false)));
  if (route.finish) {
    stops.append(stopItem(route.finish, true));
  }
  const sections = [summary, counter, stops];

  if (route.skipped.length > 0) {
    const heading = element('h3', 'mt-4 text-sm font-semibold', `Skipped (${route.skipped.length}): not enough time`);
    const skipped = element('ul', 'mt-2 flex flex-col gap-1 text-sm text-muted');
    skipped.append(...route.skipped.map((location) => element('li', '', location.label)));
    sections.push(heading, skipped);
  }

  // Done locations that aren't stops on this route (because it was planned
  // after their selfie) are listed so a mistaken tick can be undone.
  const routeKeys = new Set(route.stops.map(({ location }) => location.key));
  const doneElsewhere = plan.points.filter(({ key }) => state.doneKeys.includes(key) && !routeKeys.has(key));
  if (doneElsewhere.length > 0) {
    const heading = element('h3', 'mt-4 text-sm font-semibold', `Done (${doneElsewhere.length})`);
    const doneList = element('ul', 'mt-2 flex flex-col gap-2');
    doneList.append(
      ...doneElsewhere.map((location) => {
        const item = element('li', 'flex flex-wrap items-center justify-between gap-2 text-sm');
        item.append(element('span', 'min-w-0 break-words', location.label), doneToggle(location, true));
        return item;
      }),
    );
    sections.push(heading, doneList);
  }
  stopList.replaceChildren(...sections);
}

stopList.addEventListener('click', (event) => {
  const toggle = event.target instanceof Element ? event.target.closest('[data-done-key]') : null;
  if (toggle instanceof HTMLButtonElement) {
    state.doneKeys = toggleDone(state.doneKeys, toggle.dataset.doneKey);
    saveState(state);
    showPlan();
    // Re-rendering replaces the button, so move focus to its replacement.
    stopList.querySelector(`[data-done-key="${CSS.escape(toggle.dataset.doneKey)}"]`)?.focus();
  }
});

/** Waits for a pause in typing before previewing the lines, so long lists stay responsive. */
let previewTimer;

form.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    saveField(event.target);
  }
  if (event.target === locationsField) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(previewLines, 250);
  }
});

/**
 * Shows what each looked-up address or place name matched, or hides the list.
 *
 * @param {import('./setup.js').SearchMatch[]} matches The matches.
 */
function showMatches(matches) {
  // Lines show their own matches, so only the Start and Finish fields are listed here.
  const fieldMatches = matches.filter(({ source }) => !source.startsWith('Line '));
  locationMatchesList.replaceChildren(
    ...fieldMatches.map(({ source, label, matchedName }) => element('li', 'break-words', `${source}: ${label} → ${matchedName}`)),
  );
  locationMatches.classList.toggle('hidden', fieldMatches.length === 0);
  locationMatches.classList.toggle('flex', fieldMatches.length > 0);
}

/**
 * Shows the progress of looking up addresses, or hides it.
 *
 * @param {string | null} message The message, or `null` to hide it.
 */
function showSearchStatus(message) {
  searchStatus.textContent = message ?? '';
  searchStatus.classList.toggle('hidden', message === null);
}

/**
 * Looks up any addresses and place names in the setup form that aren't
 * known yet. Results are saved unless the lookup failed for a reason that
 * may pass, such as being offline.
 *
 * @param {boolean} isFromPosition Whether the route starts from the team's position, so the Start field isn't used.
 * @returns {Promise<import('./search.js').SearchResults>} Every known result, including temporary failures from this lookup.
 */
async function lookUpAddresses(isFromPosition) {
  const queries = searchesNeeded({ setup: state.setup, searchResults: state.searchResults, isFromPosition });
  if (queries.length === 0) {
    return state.searchResults;
  }
  showSearchStatus(`Looking up ${queries.length === 1 ? '1 address' : `${queries.length} addresses`}…`);
  const results = await searchPlaces(queries, {
    onProgress: (done, total) => showSearchStatus(`Looked up ${done} of ${total}…`),
  });
  showSearchStatus(null);
  const saved = Object.fromEntries(Object.entries(results).filter(([, result]) => result.isFound || !result.isTemporary));
  state.searchResults = { ...state.searchResults, ...saved };
  saveState(state);
  return { ...state.searchResults, ...results };
}

/**
 * Looks up any new addresses, then plans the route from the setup form and
 * shows it.
 *
 * @param {import('./planner.js').LatLng | null} from The team's current position to re-plan from, or `null` to start at the Start field.
 * @returns {Promise<string | null>} What stopped planning, or `null` if a plan was made.
 */
async function planRoute(from) {
  planButton.disabled = true;
  replanButton.disabled = true;
  try {
    const searchResults = await lookUpAddresses(from !== null);
    const result = planFromSetup({ setup: state.setup, settings: state.settings, now: Date.now(), doneKeys: state.doneKeys, from, searchResults });
    showLines(result.lines);
    showMatches(result.matches);
    showSetupError(result.error);
    if (result.plan) {
      state.plan = result.plan;
      saveState(state);
      shouldFitMap = true;
      showPlan();
    }
    return result.error;
  } finally {
    planButton.disabled = false;
    replanButton.disabled = false;
  }
}

/** Messages for each way getting the position can fail, by `GeolocationPositionError.code`. */
const GEOLOCATION_ERRORS = {
  1: 'Location access is blocked. Allow location for this site in your browser settings, or update the Start field and press Plan route.',
  2: "Your location isn't available right now. Try again in a moment, or update the Start field and press Plan route.",
  3: 'Getting your location took too long. Try again, ideally with a clear view of the sky.',
};

/**
 * Shows a message under the Re-plan from here button.
 *
 * @param {string} message The message.
 * @param {boolean} isError Whether the message is an error.
 */
function showReplanStatus(message, isError) {
  replanStatus.textContent = message;
  replanStatus.classList.toggle('text-danger', isError);
  replanStatus.classList.toggle('text-muted', !isError);
}

/**
 * Re-plans from a position and shows how it went.
 *
 * @param {import('./planner.js').LatLng} position The team's position.
 */
async function replanFrom(position) {
  const error = await planRoute(position);
  showReplanStatus(error ?? `Re-planned from your position at ${timeFormat.format(Date.now())}.`, error !== null);
}

/** Re-plans from the team's current position and the current time, as Re-plan from here does. */
function requestReplan() {
  // Use the watched position if it's recent, rather than waiting for a new one.
  if (latestPosition && Date.now() - latestPosition.time <= POSITION_MAX_AGE_MS) {
    replanFrom({ lat: latestPosition.lat, lng: latestPosition.lng });
    return;
  }
  if (!('geolocation' in navigator)) {
    showReplanStatus("This browser can't share your location. Update the Start field and press Plan route instead.", true);
    return;
  }
  replanButton.disabled = true;
  showReplanStatus('Getting your location…', false);
  navigator.geolocation.getCurrentPosition(
    (position) => replanFrom({ lat: position.coords.latitude, lng: position.coords.longitude }),
    (error) => {
      replanButton.disabled = false;
      showReplanStatus(GEOLOCATION_ERRORS[error.code] ?? "Your location couldn't be found. Try again.", true);
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
  );
}

replanButton.addEventListener('click', requestReplan);

/**
 * Shows a tab of the Route section and remembers the choice.
 *
 * @param {'list' | 'map'} view The tab to show.
 * @param {boolean} [shouldFocus=false] Whether to move focus to the tab, as when choosing it with the arrow keys.
 */
function showView(view, shouldFocus = false) {
  for (const tab of tabs) {
    const isSelected = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !isSelected;
    if (isSelected && shouldFocus) {
      tab.focus();
    }
  }
  if (view === 'map') {
    showMap();
  }
  if (state.view !== view) {
    state.view = view;
    saveState(state);
  }
}

/** Creates the map the first time it's shown, and resizes it to fit afterwards. */
function showMap() {
  if (routeMap) {
    routeMap.refresh();
    updateMap();
    return;
  }
  routeMap = createMap(mapContainer);
  showMapStatus(routeMap ? null : "The map couldn't load, which usually means there's no signal. The List tab still works.");
  updateMap();
  if (routeMap && latestPosition) {
    showPosition(routeMap, latestPosition);
  }
  watchPosition();
}

/**
 * Shows a message under the map, or hides it.
 *
 * @param {string | null} message The message, or `null` to hide it.
 */
function showMapStatus(message) {
  mapStatus.textContent = message ?? '';
  mapStatus.classList.toggle('hidden', message === null);
}

/** Messages for each way watching the position can fail, by `GeolocationPositionError.code`. */
const WATCH_ERRORS = {
  1: "Location access is blocked, so your position isn't shown. Allow location for this site in your browser settings to see it.",
  2: "Your position isn't available right now. It will appear when your phone finds it.",
  3: 'Still looking for your position…',
};

/** Starts watching the team's position, so it's shown on the map and can be used to re-plan. */
function watchPosition() {
  if (isWatchingPosition || !('geolocation' in navigator)) {
    return;
  }
  isWatchingPosition = true;
  navigator.geolocation.watchPosition(
    (position) => {
      latestPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        time: position.timestamp,
      };
      if (routeMap) {
        showPosition(routeMap, latestPosition);
        showMapStatus(null);
      }
    },
    (error) => {
      if (routeMap) {
        showMapStatus(WATCH_ERRORS[error.code] ?? "Your position couldn't be found.");
      }
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
  );
}

/**
 * Draws the current plan on the map, if the map has been created and is
 * showing. It zooms to fit the route the first time it's drawn after
 * planning, but not after ticking off a stop, so the team's view stays put.
 */
function updateMap() {
  if (!routeMap || mapContainer.closest('[hidden]')) {
    return;
  }
  const route = state.plan?.settings ? mapRoute(state.plan, state.doneKeys, (time) => timeFormat.format(time)) : { path: [], markers: [] };
  showRoute(routeMap, route, shouldFitMap);
  shouldFitMap = false;
}

for (const tab of tabs) {
  tab.addEventListener('click', () => showView(/** @type {'list' | 'map'} */ (tab.dataset.view)));
  // Arrow keys, Home and End move between tabs, following the ARIA tabs pattern.
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      showView(/** @type {'list' | 'map'} */ (tabs[(next + tabs.length) % tabs.length].dataset.view), true);
    }
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  planRoute(null);
});

/**
 * Shows a walking speed in the settings panel: the slider, its value and
 * which preset (if any) it matches.
 *
 * @param {number} speedKmh The walking speed in km/h.
 */
function showSettingsSpeed(speedKmh) {
  speedSlider.value = String(speedKmh);
  const preset = speedPreset(speedKmh);
  speedValue.textContent = `${speedKmh.toFixed(1)} km/h`;
  for (const button of speedPresets.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.preset === preset?.name));
  }
}

speedSlider.min = String(SPEED_RANGE.min);
speedSlider.max = String(SPEED_RANGE.max);
speedSlider.step = String(SPEED_RANGE.step);
speedPresets.replaceChildren(
  ...SPEED_PRESETS.map(({ name, speedKmh }) => {
    const button = element(
      'button',
      'flex min-h-11 flex-col items-center justify-center rounded-md px-2 py-1 text-sm font-semibold text-accent-ink ring-1 ring-accent/30 hover:bg-accent-soft aria-pressed:bg-accent aria-pressed:text-white aria-pressed:ring-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      name,
    );
    button.type = 'button';
    button.dataset.preset = name;
    button.append(element('span', 'text-xs font-normal', `${speedKmh} km/h`));
    button.addEventListener('click', () => showSettingsSpeed(speedKmh));
    return button;
  }),
);
speedSlider.addEventListener('input', () => showSettingsSpeed(Number(speedSlider.value)));

settingsButton.addEventListener('click', () => {
  // The setup form's speed field can be empty, which saves NaN.
  showSettingsSpeed(Number.isFinite(state.settings.speedKmh) ? state.settings.speedKmh : defaultState().settings.speedKmh);
  for (const field of panelFields) {
    if (field.dataset.panelSetup) {
      field.value = state.setup[field.dataset.panelSetup];
    } else {
      const value = state.settings[field.dataset.panelSetting];
      field.value = field.dataset.scale ? String(value / Number(field.dataset.scale)) : String(value);
    }
  }
  settingsSave.textContent = state.plan?.settings ? 'Save and re-plan' : 'Save';
  settingsDialog.showModal();
});

// Cancel is a plain button, so pressing Enter in a field submits with Save
// rather than the first button in the form.
document.getElementById('settings-cancel').addEventListener('click', () => settingsDialog.close('cancel'));

settingsDialog.addEventListener('close', () => {
  if (settingsDialog.returnValue !== 'save') {
    return;
  }
  state.settings.speedKmh = Number(speedSlider.value);
  // The fields are required and range-checked, so the dialog only closes
  // with "save" when they're valid.
  for (const field of panelFields) {
    if (field.dataset.panelSetup) {
      state.setup[field.dataset.panelSetup] = field.value;
    } else if (field.type === 'number') {
      state.settings[field.dataset.panelSetting] = Number(field.value) * Number(field.dataset.scale ?? 1);
    } else {
      state.settings[field.dataset.panelSetting] = field.value;
    }
  }
  saveState(state);
  fillForm();
  // Re-plan with the new settings, keeping ticks, if there's a route to change.
  if (state.plan?.settings) {
    requestReplan();
  }
});

fillForm();
previewLines();
showView(state.view);
showPlan();
