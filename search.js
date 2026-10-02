/**
 * The result of looking up an address or place name.
 *
 * @typedef {{ isFound: true, lat: number, lng: number, name: string }
 *   | { isFound: false, error: string, isTemporary: boolean }} SearchResult
 * `isTemporary` is `true` when the lookup failed for a reason that may pass
 * (such as being offline), so the result shouldn't be saved.
 */

/**
 * Search results by {@link searchKey}.
 *
 * @typedef {Record<string, SearchResult>} SearchResults
 */

/**
 * OpenStreetMap's Nominatim search, which is free within its usage policy:
 * https://operations.osmfoundation.org/policies/nominatim/
 *
 * Keep to the policy when changing this module. Search only when the team
 * presses a button (never as they type, which is forbidden), at most once a
 * second, and save results so the same search isn't sent again. Keep the
 * OpenStreetMap credit next to the location list, and send no personal data.
 * If asked to stop using the service, change this URL and redeploy.
 */
export const SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/** The area searched, as Nominatim's `left,top,right,bottom`: Bristol and its outskirts. */
export const BRISTOL_VIEWBOX = '-2.73,51.54,-2.45,51.39';

/** The shortest time between requests, from Nominatim's limit of 1 request per second, with a little spare. */
export const REQUEST_INTERVAL_MS = 1100;

/**
 * Normalises a search so that the same address typed slightly differently
 * is only looked up once.
 *
 * @param {string} query The address or place name.
 * @returns {string} The key to save the result under.
 * @example
 * searchKey('  Queen   Square, BRISTOL '); // 'queen square, bristol'
 */
export function searchKey(query) {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Looks up an address or place name in the Bristol area with OpenStreetMap.
 *
 * @param {string} query The address or place name.
 * @param {object} [options] Options for testing.
 * @param {typeof fetch} [options.fetch] The fetch function to use. Defaults to the global `fetch`.
 * @returns {Promise<SearchResult>} The best match, or why there isn't one.
 * @example
 * await searchPlace('Queen Square, Bristol');
 * // { isFound: true, lat: 51.45…, lng: -2.59…, name: 'Queen Square, …, Bristol, …' }
 */
export async function searchPlace(query, { fetch = globalThis.fetch } = {}) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'gb',
    viewbox: BRISTOL_VIEWBOX,
    bounded: '1',
  });
  let response;
  try {
    response = await fetch(`${SEARCH_URL}?${params}`, { headers: { Accept: 'application/json' } });
  } catch {
    return {
      isFound: false,
      error: `Couldn't look up "${query}", which usually means there's no signal. Try again, or add the coordinates.`,
      isTemporary: true,
    };
  }
  if (!response.ok) {
    return {
      isFound: false,
      error: `Couldn't look up "${query}" because OpenStreetMap search is busy (error ${response.status}). Try again in a minute, or add the coordinates.`,
      isTemporary: true,
    };
  }

  let results;
  try {
    results = await response.json();
  } catch {
    return { isFound: false, error: `Couldn't read the search result for "${query}". Try again, or add the coordinates.`, isTemporary: true };
  }
  const [best] = Array.isArray(results) ? results : [];
  const lat = Number(best?.lat);
  const lng = Number(best?.lon);
  if (!best || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      isFound: false,
      error: `No match for "${query}" in Bristol. Check the spelling, try a nearby street or landmark, or add the coordinates.`,
      isTemporary: false,
    };
  }
  return { isFound: true, lat, lng, name: String(best.display_name ?? query) };
}

/**
 * Looks up several addresses or place names, one at a time and at most once
 * a second, following Nominatim's usage policy. Searches with the same
 * {@link searchKey} are only looked up once.
 *
 * @param {string[]} queries The addresses or place names.
 * @param {object} [options] Options for progress and testing.
 * @param {(done: number, total: number) => void} [options.onProgress] Called after each lookup.
 * @param {typeof fetch} [options.fetch] The fetch function to use. Defaults to the global `fetch`.
 * @param {(ms: number) => Promise<void>} [options.sleep] Waits between requests. Defaults to a timer.
 * @returns {Promise<SearchResults>} The results by {@link searchKey}.
 */
export async function searchPlaces(
  queries,
  { onProgress = () => {}, fetch = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  // Keep the first spelling of each search.
  const unique = new Map();
  for (const query of queries) {
    if (!unique.has(searchKey(query))) {
      unique.set(searchKey(query), query);
    }
  }
  /** @type {SearchResults} */
  const results = {};
  let done = 0;
  for (const [key, query] of unique) {
    if (done > 0) {
      await sleep(REQUEST_INTERVAL_MS);
    }
    results[key] = await searchPlace(query, { fetch });
    done += 1;
    onProgress(done, unique.size);
  }
  return results;
}
