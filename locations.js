import { parseWords } from './what3words.js';

/**
 * A location the planner can visit.
 *
 * @typedef {object} Location
 * @property {number} lat Latitude, from -90 to 90.
 * @property {number} lng Longitude, from -180 to 180.
 * @property {string} label What to call the location. Defaults to the what3words address, or the coordinates.
 * @property {string | null} words The what3words address as `word.word.word`, or `null` if the line didn't have one.
 * @property {string} key A stable key for the location, from its coordinates, for remembering which selfies are done.
 */

/**
 * The result of parsing a line of the location list.
 *
 * @typedef {{ isValid: true, location: Location } | { isValid: false, error: string, lookupUrl?: string }} ParsedLine
 */

/**
 * A non-blank line of the location list and the result of parsing it.
 *
 * @typedef {object} ParsedListLine
 * @property {number} lineNumber The line's number in the list, starting at 1.
 * @property {string} text The line as typed.
 * @property {ParsedLine} result The result of parsing the line.
 */

/** Coordinates as `lat,lng` in decimal degrees, with or without a space after the comma. */
const COORDINATES = /(?<![\d.])(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)(?![\d.])/g;

/** A what3words address, with or without the `///` prefix or a what3words.com or w3w.co link. */
const WORDS =
  /(?<=^|\s)(?:(?:https?:\/\/)?(?:www\.)?(?:what3words\.com|w3w\.co)\/|\/{1,3})?[\p{L}\p{M}]+\.[\p{L}\p{M}]+\.[\p{L}\p{M}]+(?=\s|$)/giu;

/** Punctuation that separates the parts of a line, removed from the ends of the label. */
const SEPARATORS = /^[\s,;|–—-]+|[\s,;|–—-]+$/g;

/**
 * Parses one line of the location list. The free what3words plan can't
 * convert addresses to coordinates, so a line must include the coordinates
 * as `lat,lng`. It can also include a what3words address, kept so the stop
 * can link to it, and a label (any remaining text), in any order.
 *
 * @param {string} line The line as typed.
 * @returns {ParsedLine} The location, or a message saying what's wrong.
 * @example
 * parseLocationLine('Old Kent Road ///filled.count.soap 51.4545,-2.5879');
 * // { isValid: true, location: { lat: 51.4545, lng: -2.5879, label: 'Old Kent Road', words: 'filled.count.soap', key: '51.454500,-2.587900' } }
 */
export function parseLocationLine(line) {
  const coordinates = [...line.matchAll(COORDINATES)];
  const words = [...line.matchAll(WORDS)];

  if (words.length > 1) {
    return { isValid: false, error: 'This line has more than one what3words address. Put each location on its own line.' };
  }
  const parsedWords = words.length === 1 ? parseWords(words[0][0]) : null;
  if (parsedWords && !parsedWords.isValid) {
    return { isValid: false, error: parsedWords.error };
  }
  const wordsText = parsedWords?.words ?? null;

  if (coordinates.length === 0) {
    if (wordsText) {
      return {
        isValid: false,
        error: `Add the coordinates for ///${wordsText} as lat,lng, like 51.4545,-2.5879. You can find them in the what3words app or website.`,
        lookupUrl: `https://what3words.com/${wordsText}`,
      };
    }
    return { isValid: false, error: 'Add the coordinates as lat,lng, like 51.4545,-2.5879.' };
  }
  if (coordinates.length > 1) {
    return { isValid: false, error: 'This line has more than one set of coordinates. Put each location on its own line.' };
  }

  const lat = Number(coordinates[0][1]);
  const lng = Number(coordinates[0][2]);
  if (lat < -90 || lat > 90) {
    return { isValid: false, error: `The latitude ${coordinates[0][1]} must be between -90 and 90. Check the coordinates are in lat,lng order.` };
  }
  if (lng < -180 || lng > 180) {
    return { isValid: false, error: `The longitude ${coordinates[0][2]} must be between -180 and 180.` };
  }

  let label = line;
  for (const match of [...coordinates, ...words]) {
    label = label.replace(match[0], ' ');
  }
  label = label.replace(/\s+/g, ' ').replace(SEPARATORS, '');

  return {
    isValid: true,
    location: {
      lat,
      lng,
      label: label || (wordsText ? `///${wordsText}` : `${coordinates[0][1]}, ${coordinates[0][2]}`),
      words: wordsText,
      key: `${lat.toFixed(6)},${lng.toFixed(6)}`,
    },
  };
}

/**
 * Parses the location list, one location per line. Blank lines are ignored.
 *
 * @param {string} text The location list as typed.
 * @returns {ParsedListLine[]} Each non-blank line with the result of parsing it, in order.
 */
export function parseLocationList(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ lineNumber: index + 1, text: line }))
    .filter(({ text: line }) => line.trim() !== '')
    .map((line) => ({ ...line, result: parseLocationLine(line.text) }));
}
