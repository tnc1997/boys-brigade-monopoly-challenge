import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BRISTOL_VIEWBOX, REQUEST_INTERVAL_MS, SEARCH_URL, searchKey, searchPlace, searchPlaces } from '../search.js';

/** A fake fetch that returns the given JSON (or throws), and records the URLs it was called with. */
const fakeFetch = (respond) => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(new URL(url));
    const { status = 200, body = [], error } = respond(new URL(url));
    if (error) {
      throw error;
    }
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, urls };
};

const queenSquare = { lat: '51.4504', lon: '-2.5947', display_name: 'Queen Square, City Centre, Bristol, England' };

describe('searchKey', () => {
  test('normalises spacing and case', () => {
    assert.equal(searchKey('  Queen   Square, BRISTOL '), 'queen square, bristol');
  });
});

describe('searchPlace', () => {
  test('searches Nominatim in the Bristol area', async () => {
    const { fetch, urls } = fakeFetch(() => ({ body: [queenSquare] }));
    await searchPlace('Queen Square, Bristol', { fetch });
    const [url] = urls;
    assert.equal(url.origin + url.pathname, SEARCH_URL);
    assert.equal(url.searchParams.get('q'), 'Queen Square, Bristol');
    assert.equal(url.searchParams.get('format'), 'jsonv2');
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(url.searchParams.get('viewbox'), BRISTOL_VIEWBOX);
    assert.equal(url.searchParams.get('bounded'), '1');
  });

  test('returns the best match', async () => {
    const { fetch } = fakeFetch(() => ({ body: [queenSquare] }));
    assert.deepEqual(await searchPlace('Queen Square', { fetch }), {
      isFound: true,
      lat: 51.4504,
      lng: -2.5947,
      name: 'Queen Square, City Centre, Bristol, England',
    });
  });

  test('says when nothing is found, and that the result can be saved', async () => {
    const { fetch } = fakeFetch(() => ({ body: [] }));
    const result = await searchPlace('Nowhere Street', { fetch });
    assert.equal(result.isFound, false);
    assert.equal(result.isTemporary, false);
    assert.match(result.error, /No match for "Nowhere Street" in Bristol/);
  });

  test('says when offline, and that the result should not be saved', async () => {
    const { fetch } = fakeFetch(() => ({ error: new TypeError('Failed to fetch') }));
    const result = await searchPlace('Queen Square', { fetch });
    assert.equal(result.isFound, false);
    assert.equal(result.isTemporary, true);
    assert.match(result.error, /no signal/);
  });

  test('says when the search is busy, and that the result should not be saved', async () => {
    const { fetch } = fakeFetch(() => ({ status: 429 }));
    const result = await searchPlace('Queen Square', { fetch });
    assert.equal(result.isTemporary, true);
    assert.match(result.error, /busy \(error 429\)/);
  });

  test('treats an unexpected response as nothing found', async () => {
    const { fetch } = fakeFetch(() => ({ body: { error: 'nope' } }));
    assert.equal((await searchPlace('Queen Square', { fetch })).isFound, false);
  });
});

describe('searchPlaces', () => {
  test('looks up each search once, one at a time, waiting between requests', async () => {
    const { fetch, urls } = fakeFetch(() => ({ body: [queenSquare] }));
    const waits = [];
    const progress = [];
    const results = await searchPlaces(['Queen Square', 'queen  square', 'Temple Meads'], {
      fetch,
      sleep: async (ms) => waits.push(ms),
      onProgress: (done, total) => progress.push([done, total]),
    });
    assert.deepEqual(urls.map((url) => url.searchParams.get('q')), ['Queen Square', 'Temple Meads']);
    assert.deepEqual(waits, [REQUEST_INTERVAL_MS]);
    assert.ok(REQUEST_INTERVAL_MS >= 1500, 'leaves a generous buffer over Nominatim\'s 1 request per second');
    assert.deepEqual(progress, [
      [1, 2],
      [2, 2],
    ]);
    assert.deepEqual(Object.keys(results), ['queen square', 'temple meads']);
  });

  test('does nothing for no searches', async () => {
    const { fetch, urls } = fakeFetch(() => ({ body: [] }));
    assert.deepEqual(await searchPlaces([], { fetch }), {});
    assert.equal(urls.length, 0);
  });
});
