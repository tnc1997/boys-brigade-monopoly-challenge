import { describeRoute, formatDuration, progress, toggleDone } from './route.js';
import { planFromSetup } from './setup.js';
import { loadState, saveState } from './storage.js';

/** The app's state, loaded from the previous visit if there was one. */
const state = loadState();

const form = /** @type {HTMLFormElement} */ (document.getElementById('setup-form'));
const locationErrors = /** @type {HTMLUListElement} */ (document.getElementById('location-errors'));
const setupError = /** @type {HTMLParagraphElement} */ (document.getElementById('setup-error'));
const stopList = /** @type {HTMLDivElement} */ (document.getElementById('stop-list'));
const replan = /** @type {HTMLDivElement} */ (document.getElementById('replan'));
const replanButton = /** @type {HTMLButtonElement} */ (document.getElementById('replan-button'));
const replanStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('replan-status'));

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
 * Shows the lines of the location list that couldn't be used.
 *
 * @param {import('./locations.js').ParsedLocationLine[]} invalidLines The lines to show.
 */
function showInvalidLines(invalidLines) {
  locationErrors.replaceChildren(
    ...invalidLines.map(({ lineNumber, result }) => {
      const item = element('li', '', `Line ${lineNumber}: ${result.error} `);
      if (result.lookupUrl) {
        const link = element('a', 'font-medium underline', 'Open in what3words');
        link.href = result.lookupUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        item.append(link);
      }
      return item;
    }),
  );
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
    'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-700/30 hover:bg-emerald-50',
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
    `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold ${isDone ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'bg-white text-emerald-800 ring-1 ring-emerald-700 hover:bg-emerald-50'}`,
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
  const item = element('li', `flex gap-3 rounded-md p-3 ring-1 ${isDone ? 'bg-emerald-50 ring-emerald-200' : 'ring-slate-200'}`);
  const badgeColours = isFinish ? 'bg-slate-800 text-white' : isDone ? 'bg-emerald-200 text-emerald-900' : 'bg-emerald-700 text-white';
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
    'text-sm text-slate-600',
    `${isFinish ? 'Finish · arrive' : 'ETA'} ${timeFormat.format(stop.arrivalTime)} · ${formatDuration(stop.walkSeconds)} walk`,
  );
  const links = element('div', 'mt-1 flex flex-wrap gap-2');
  if (!isFinish) {
    links.append(doneToggle(stop.location, isDone));
  }
  links.append(externalLink(stop.directionsUrl, 'Directions', `Walking directions to ${stop.location.label} in Google Maps`));
  if (stop.what3wordsUrl) {
    links.append(externalLink(stop.what3wordsUrl, 'what3words', `${stop.location.label} in what3words`));
  }
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
  if (!hasPlan) {
    stopList.replaceChildren(element('p', 'text-sm text-slate-600', 'Add your locations above and press Plan route.'));
    return;
  }
  const route = describeRoute(plan);
  const ending = route.finish ? `arriving at the finish at ${timeFormat.format(route.endEta)}` : `with the last selfie at ${timeFormat.format(route.endEta)}`;
  const { done, total } = progress(plan, state.doneKeys);
  const visiting = done === 0 ? `${route.stops.length} of ${total} locations` : `${route.stops.length} of ${total - done} locations still to do`;
  const summary = element('p', 'text-sm', `Visiting ${visiting}, ${ending}.`);
  const counter = element('p', 'mt-1 text-sm font-semibold text-emerald-800', `Selfies done: ${done} of ${total}`);
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
    const skipped = element('ul', 'mt-2 flex flex-col gap-1 text-sm text-slate-600');
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

form.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    saveField(event.target);
  }
});

/**
 * Plans the route from the setup form and shows it.
 *
 * @param {import('./planner.js').LatLng | null} from The team's current position to re-plan from, or `null` to start at the Start field.
 * @returns {string | null} What stopped planning, or `null` if a plan was made.
 */
function planRoute(from) {
  const result = planFromSetup({ setup: state.setup, settings: state.settings, now: Date.now(), doneKeys: state.doneKeys, from });
  showInvalidLines(result.invalidLines);
  showSetupError(result.error);
  if (result.plan) {
    state.plan = result.plan;
    saveState(state);
    showPlan();
  }
  return result.error;
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
  replanStatus.classList.toggle('text-red-700', isError);
  replanStatus.classList.toggle('text-slate-600', !isError);
}

replanButton.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    showReplanStatus("This browser can't share your location. Update the Start field and press Plan route instead.", true);
    return;
  }
  replanButton.disabled = true;
  showReplanStatus('Getting your location…', false);
  navigator.geolocation.getCurrentPosition(
    (position) => {
      replanButton.disabled = false;
      const error = planRoute({ lat: position.coords.latitude, lng: position.coords.longitude });
      showReplanStatus(error ?? `Re-planned from your position at ${timeFormat.format(Date.now())}.`, error !== null);
    },
    (error) => {
      replanButton.disabled = false;
      showReplanStatus(GEOLOCATION_ERRORS[error.code] ?? "Your location couldn't be found. Try again.", true);
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
  );
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  planRoute(null);
});

fillForm();
showPlan();
