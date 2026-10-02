/**
 * The result of parsing a what3words address.
 *
 * @typedef {{ isValid: true, words: string } | { isValid: false, error: string }} ParsedWords
 */

/** Prefixes that what3words addresses are often written or shared with. */
const PREFIXES = [/^\/{1,3}/, /^(?:https?:\/\/)?(?:www\.)?(?:what3words\.com|w3w\.co)\//i];

/** A single word: one or more letters (in any script) and combining marks. */
const WORD = /^[\p{L}\p{M}]+$/u;

/**
 * Parses and normalises a what3words address before it's sent to the API. It
 * accepts addresses with or without the `///` prefix, as well as
 * what3words.com and w3w.co links, ignores surrounding whitespace and
 * lower-cases the words.
 *
 * @param {string} input The address as typed or pasted.
 * @returns {ParsedWords} The normalised `word.word.word` address, or a message saying what's wrong.
 * @example
 * parseWords(' ///Filled.Count.Soap '); // { isValid: true, words: 'filled.count.soap' }
 * parseWords('filled.count'); // { isValid: false, error: 'A what3words address has three words …' }
 */
export function parseWords(input) {
  let text = input.trim();
  for (const prefix of PREFIXES) {
    text = text.replace(prefix, '');
  }
  text = text.toLowerCase();

  if (text === '') {
    return { isValid: false, error: 'Enter a what3words address, like ///filled.count.soap.' };
  }
  const words = text.split('.');
  if (words.length !== 3) {
    return {
      isValid: false,
      error: `A what3words address has three words separated by dots, like ///filled.count.soap, but this has ${words.length === 1 ? 'no dots' : `${words.length} parts`}.`,
    };
  }
  if (!words.every((word) => WORD.test(word))) {
    return { isValid: false, error: 'Each word in a what3words address can only contain letters.' };
  }
  return { isValid: true, words: words.join('.') };
}
