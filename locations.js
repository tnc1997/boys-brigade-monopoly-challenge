import { searchKey } from './search.js';
import { parseWords } from './what3words.js';

/**
 * A location the planner can visit.
 *
 * @typedef {object} Location
 * @property {number} lat Latitude, from -90 to 90.
 * @property {number} lng Longitude, from -180 to 180.
 * @property {string} label What to call the location. Defaults to the place's name from a Google Maps URL, the what3words address, or the coordinates.
 * @property {string | null} words The what3words address as `word.word.word`, or `null` if the line didn't have one.
 * @property {string} key A stable key for the location, from its coordinates, for remembering which selfies are done.
 * @property {string} [matchedName] For a location found by searching for an address or place name, the name of the place that was found, so the team can check it.
 */

/**
 * The result of parsing a line of the location list.
 *
 * @typedef {{ isValid: true, location: Location } | { isValid: false, error: string, lookupUrl?: string, query?: string }} ParsedLocation
 * `query` is the address or place name to look up when the line has no
 * coordinates and its search result isn't known yet.
 */

/**
 * A non-blank line of the location list and the result of parsing it.
 *
 * @typedef {object} ParsedLocationLine
 * @property {number} lineNumber The line's number in the list, starting at 1.
 * @property {string} text The line as typed.
 * @property {ParsedLocation} result The result of parsing the line.
 */

/** Coordinates as `lat,lng` in decimal degrees, with or without a space after the comma. */
const COORDINATES = /(?<![\d.])(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)(?![\d.])/g;

/** The same as {@link COORDINATES}, but for a whole value such as a URL's `q` parameter. */
const WHOLE_COORDINATES = /^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/;

/** A what3words address, with or without the `///` prefix or a what3words.com or w3w.co URL. */
const WORDS =
  /(?<=^|[\s,;|])(?:(?:https?:\/\/)?(?:www\.)?(?:what3words\.com|w3w\.co)\/|\/{1,3})?[\p{L}\p{M}]+\.[\p{L}\p{M}]+\.[\p{L}\p{M}]+(?=[\s,;|]|$)/giu;

/** A Google Maps URL, including short URLs, with or without `https://`. */
const GOOGLE_MAPS_URL =
  /(?<=^|\s)(?:https?:\/\/)?(?:(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)(?:[/?#]\S*)?(?=\s|$)/gi;

/** The position of the pin in a Google Maps place URL, as `!3d<lat>!4d<lng>`. */
const PIN = /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/;

/** The centre of the map in a Google Maps URL, as `@<lat>,<lng>`. */
const MAP_CENTRE = /\/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/;

/** The place's name in a Google Maps place URL, as `/maps/place/<name>/`. */
const PLACE_NAME = /\/maps\/place\/([^/@]+)/;

/** Google Maps URL parameters that can hold the location's coordinates. */
const COORDINATE_PARAMETERS = ['q', 'query', 'destination', 'll'];

/** Punctuation that separates the parts of a line, removed from the ends of the label. */
const SEPARATORS = /^[\s,;|–—-]+|[\s,;|–—-]+$/g;

/**
 * Coordinates as written, before they're checked.
 *
 * @typedef {object} CoordinatesText
 * @property {string} lat The latitude as written.
 * @property {string} lng The longitude as written.
 */

/**
 * Gets the coordinates from a Google Maps URL, without any network
 * requests. The pin's position (`!3d…!4d…`) is preferred over the centre of
 * the map (`@lat,lng`), because the map can be scrolled away from the pin.
 *
 * @param {string} text The URL as typed or pasted, with or without `https://`.
 * @returns {{ isValid: true, coordinates: CoordinatesText, placeName: string | null } | { isValid: false, error: string }} The coordinates and the place's name (for place URLs), or a message saying why they can't be read.
 * @example
 * parseGoogleMapsUrl('https://www.google.com/maps?q=51.4545,-2.5879');
 * // { isValid: true, coordinates: { lat: '51.4545', lng: '-2.5879' }, placeName: null }
 */
export function parseGoogleMapsUrl(text) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { isValid: false, error: 'This Google Maps link is not a valid link. Paste the full link or the coordinates instead.' };
  }
  if (/^(?:maps\.app\.goo\.gl|goo\.gl)$/i.test(url.hostname)) {
    return {
      isValid: false,
      error: 'Short Google Maps links can\'t be read without opening them. In Google Maps, drop a pin on the location and paste the coordinates it shows instead.',
    };
  }

  const href = decodeURIComponent(url.href);
  const placeName = url.pathname.match(PLACE_NAME)?.[1];
  const result = (lat, lng) => ({
    isValid: true,
    coordinates: { lat, lng },
    placeName: placeName ? decodeURIComponent(placeName.replace(/\+/g, ' ')) : null,
  });

  const pin = href.match(PIN);
  if (pin) {
    return result(pin[1], pin[2]);
  }
  for (const name of COORDINATE_PARAMETERS) {
    const value = url.searchParams.get(name)?.match(WHOLE_COORDINATES);
    if (value) {
      return result(value[1], value[2]);
    }
  }
  const centre = href.match(MAP_CENTRE);
  if (centre) {
    return result(centre[1], centre[2]);
  }
  return {
    isValid: false,
    error: 'This Google Maps link doesn\'t include coordinates. In Google Maps, drop a pin on the location and paste the coordinates it shows instead.',
  };
}

/**
 * Turns the text of a line without coordinates into a location, using its
 * search result if it has one.
 *
 * @param {string} text The line's text, apart from any what3words address.
 * @param {string | null} wordsText The line's what3words address, if it has one.
 * @param {import('./search.js').SearchResults} searchResults Search results by {@link searchKey}.
 * @returns {ParsedLocation} The location, or a message saying what's wrong with the text to look up.
 */
function searchedLocation(text, wordsText, searchResults) {
  const colon = text.indexOf(':');
  const label = colon > 0 ? text.slice(0, colon).replace(SEPARATORS, '') : text;
  const query = colon > 0 ? text.slice(colon + 1).replace(SEPARATORS, '') : text;
  const lookupUrl = wordsText ? { lookupUrl: `https://what3words.com/${wordsText}` } : {};
  const result = searchResults[searchKey(query)];

  if (!result) {
    return { isValid: false, error: `Press Plan route to look up "${query}", or add the coordinates.`, query, ...lookupUrl };
  }
  if (!result.isFound) {
    return { isValid: false, error: result.error, ...lookupUrl };
  }
  return {
    isValid: true,
    location: {
      lat: result.lat,
      lng: result.lng,
      label: label || query,
      words: wordsText,
      key: `${result.lat.toFixed(6)},${result.lng.toFixed(6)}`,
      matchedName: result.name,
    },
  };
}

/**
 * Parses one line of the location list. The free what3words plan can't
 * convert addresses to coordinates, so a line must include the coordinates,
 * either as `lat,lng` or in a Google Maps URL, or an address or place name
 * to look up. It can also include a what3words address, kept so the stop can
 * link to it, and a label (any remaining text), in any order.
 *
 * Without coordinates, the remaining text is looked up, and is also the
 * label. To give a different label, put it before a colon, like
 * `Old Kent Road: Queen Square, Bristol`. Until its search result is in
 * `searchResults`, the line is invalid with the text to look up as `query`.
 *
 * @param {string} line The line as typed.
 * @param {object} [options] Search results for lines without coordinates.
 * @param {import('./search.js').SearchResults} [options.searchResults] Search results by {@link searchKey}.
 * @returns {ParsedLocation} The location, or a message saying what's wrong.
 * @example
 * parseLocation('Old Kent Road ///filled.count.soap 51.4545,-2.5879');
 * // { isValid: true, location: { lat: 51.4545, lng: -2.5879, label: 'Old Kent Road', words: 'filled.count.soap', key: '51.454500,-2.587900' } }
 */
export function parseLocation(line, { searchResults = {} } = {}) {
  // URLs are read and removed first, because they can contain text that
  // looks like coordinates or a what3words address (such as maps.google.com).
  /** @type {CoordinatesText[]} */
  const coordinates = [];
  let placeName = null;
  let rest = line;
  for (const [url] of line.matchAll(GOOGLE_MAPS_URL)) {
    const parsedUrl = parseGoogleMapsUrl(url);
    if (!parsedUrl.isValid) {
      return { isValid: false, error: parsedUrl.error };
    }
    coordinates.push(parsedUrl.coordinates);
    placeName ??= parsedUrl.placeName;
    rest = rest.replace(url, ' ');
  }

  const coordinateMatches = [...rest.matchAll(COORDINATES)];
  coordinates.push(...coordinateMatches.map((match) => ({ lat: match[1], lng: match[2] })));
  const words = [...rest.matchAll(WORDS)];

  if (words.length > 1) {
    return { isValid: false, error: 'This line has more than one what3words address. Put each location on its own line.' };
  }
  const parsedWords = words.length === 1 ? parseWords(words[0][0]) : null;
  if (parsedWords && !parsedWords.isValid) {
    return { isValid: false, error: parsedWords.error };
  }
  const wordsText = parsedWords?.words ?? null;

  if (coordinates.length === 0) {
    const text = words.reduce((remaining, match) => remaining.replace(match[0], ' '), rest).replace(/\s+/g, ' ').replace(SEPARATORS, '');
    if (text) {
      return searchedLocation(text, wordsText, searchResults);
    }
    if (wordsText) {
      return {
        isValid: false,
        error: `Add an address or the coordinates for ///${wordsText}. Open it in what3words and tap Navigate to get its address, or long-press the same spot in Google Maps to drop a pin and copy the coordinates from the search box, then add it to this line.`,
        lookupUrl: `https://what3words.com/${wordsText}`,
      };
    }
    return { isValid: false, error: 'Add the coordinates as lat,lng, like 51.4545,-2.5879, a Google Maps link, or an address to look up.' };
  }
  if (coordinates.length > 1) {
    return { isValid: false, error: 'This line has more than one set of coordinates. Put each location on its own line.' };
  }

  const lat = Number(coordinates[0].lat);
  const lng = Number(coordinates[0].lng);
  if (lat < -90 || lat > 90) {
    return { isValid: false, error: `The latitude ${coordinates[0].lat} must be between -90 and 90. Check the coordinates are in lat,lng order.` };
  }
  if (lng < -180 || lng > 180) {
    return { isValid: false, error: `The longitude ${coordinates[0].lng} must be between -180 and 180.` };
  }

  let label = rest;
  for (const match of [...coordinateMatches, ...words]) {
    label = label.replace(match[0], ' ');
  }
  label = label.replace(/\s+/g, ' ').replace(SEPARATORS, '');

  return {
    isValid: true,
    location: {
      lat,
      lng,
      label: label || placeName || (wordsText ? `///${wordsText}` : `${coordinates[0].lat}, ${coordinates[0].lng}`),
      words: wordsText,
      key: `${lat.toFixed(6)},${lng.toFixed(6)}`,
    },
  };
}

/**
 * Parses the location list, one location per line. Blank lines are ignored.
 *
 * @param {string} text The location list as typed.
 * @param {object} [options] Search results for lines without coordinates.
 * @param {import('./search.js').SearchResults} [options.searchResults] Search results by {@link searchKey}.
 * @returns {ParsedLocationLine[]} Each non-blank line with the result of parsing it, in order.
 */
export function parseLocations(text, { searchResults = {} } = {}) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ lineNumber: index + 1, text: line }))
    .filter(({ text: line }) => line.trim() !== '')
    .map((line) => ({ ...line, result: parseLocation(line.text, { searchResults }) }));
}
