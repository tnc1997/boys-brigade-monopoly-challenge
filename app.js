import { describeRoute, formatDuration } from './route.js';
import { planFromSetup } from './setup.js';
import { loadState, saveState } from './storage.js';

/** The app's state, loaded from the previous visit if there was one. */
const state = loadState();

const form = /** @type {HTMLFormElement} */ (document.getElementById('setup-form'));
const locationErrors = /** @type {HTMLUListElement} */ (document.getElementById('location-errors'));
const setupError = /** @type {HTMLParagraphElement} */ (document.getElementById('setup-error'));
const stopList = /** @type {HTMLDivElement} */ (document.getElementById('stop-list'));

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
 * Creates the list item for a stop, or for the walk to the finish.
 *
 * @param {import('./route.js').RouteStop} stop The stop.
 * @param {boolean} isFinish Whether this is the walk to the finish.
 * @returns {HTMLLIElement} The list item.
 */
function stopItem(stop, isFinish) {
  const item = element('li', 'flex gap-3 rounded-md p-3 ring-1 ring-slate-200');
  const badge = element(
    'span',
    `flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${isFinish ? 'bg-slate-800 text-white' : 'bg-emerald-700 text-white'}`,
    isFinish ? '🏁' : String(stop.number),
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
  links.append(externalLink(stop.directionsUrl, 'Directions', `Walking directions to ${stop.location.label} in Google Maps`));
  if (stop.what3wordsUrl) {
    links.append(externalLink(stop.what3wordsUrl, 'what3words', `${stop.location.label} in what3words`));
  }
  details.append(title, timing, links);
  item.append(badge, details);
  return item;
}

/** Shows the current plan as a list of stops, then any skipped locations. */
function showPlan() {
  const { plan } = state;
  // Plans saved before walk settings were kept with the plan can't be shown, so they need planning again.
  if (!plan?.settings) {
    stopList.replaceChildren(element('p', 'text-sm text-slate-600', 'Add your locations above and press Plan route.'));
    return;
  }
  const route = describeRoute(plan);
  const ending = route.finish ? `arriving at the finish at ${timeFormat.format(route.endEta)}` : `with the last selfie at ${timeFormat.format(route.endEta)}`;
  const summary = element('p', 'text-sm', `Visiting ${route.stops.length} of ${plan.points.length} locations, ${ending}.`);

  const stops = element('ol', 'mt-3 flex flex-col gap-2');
  stops.setAttribute('aria-label', 'Stops in order');
  stops.append(...route.stops.map((stop) => stopItem(stop, false)));
  if (route.finish) {
    stops.append(stopItem(route.finish, true));
  }
  const sections = [summary, stops];

  if (route.skipped.length > 0) {
    const heading = element('h3', 'mt-4 text-sm font-semibold', `Skipped (${route.skipped.length}): not enough time`);
    const skipped = element('ul', 'mt-2 flex flex-col gap-1 text-sm text-slate-600');
    skipped.append(...route.skipped.map((location) => element('li', '', location.label)));
    sections.push(heading, skipped);
  }
  stopList.replaceChildren(...sections);
}

form.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    saveField(event.target);
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const result = planFromSetup({ setup: state.setup, settings: state.settings, now: Date.now() });
  showInvalidLines(result.invalidLines);
  showSetupError(result.error);
  if (result.plan) {
    state.plan = result.plan;
    saveState(state);
    showPlan();
  }
});

fillForm();
showPlan();
