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

/** Shows the current plan. The full stop list comes in #13. */
function showPlan() {
  const { plan } = state;
  if (!plan) {
    stopList.replaceChildren(element('p', 'text-sm text-slate-600', 'Add your locations above and press Plan route.'));
    return;
  }
  const ending = plan.finish ? `at ${plan.finish.label}` : 'with the last selfie';
  const summary = element(
    'p',
    'text-sm',
    `Visiting ${plan.order.length} of ${plan.points.length} locations, ending ${ending} at ${timeFormat.format(plan.endEta)}.`,
  );
  const stops = element('ol', 'mt-2 list-decimal pl-6 text-sm');
  stops.append(...plan.order.map((index) => element('li', '', plan.points[index].label)));
  stopList.replaceChildren(summary, stops);
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
