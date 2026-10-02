import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseWords } from '../what3words.js';

describe('parseWords', () => {
  const valid = [
    ['filled.count.soap', 'filled.count.soap'],
    ['///filled.count.soap', 'filled.count.soap'],
    [' Filled.Count.Soap ', 'filled.count.soap'],
    ['\t///FILLED.COUNT.SOAP\n', 'filled.count.soap'],
    ['/filled.count.soap', 'filled.count.soap'],
    ['https://what3words.com/filled.count.soap', 'filled.count.soap'],
    ['https://w3w.co/filled.count.soap', 'filled.count.soap'],
    ['what3words.com/filled.count.soap', 'filled.count.soap'],
    ['école.château.forêt', 'école.château.forêt'],
  ];
  for (const [input, words] of valid) {
    test(`normalises ${JSON.stringify(input)} to ${words}`, () => {
      assert.deepEqual(parseWords(input), { isValid: true, words });
    });
  }

  const invalid = [
    ['', /Enter a what3words address/],
    ['   ', /Enter a what3words address/],
    ['///', /Enter a what3words address/],
    ['filled', /no dots/],
    ['filled.count', /three words.*2 parts/],
    ['filled.count.soap.extra', /three words.*4 parts/],
    ['filled..soap', /only contain letters/],
    ['filled.count.soap.', /4 parts/],
    ['filled.c0unt.soap', /only contain letters/],
    ['filled.count soap.x', /only contain letters/],
    ['filled.count.so-ap', /only contain letters/],
  ];
  for (const [input, error] of invalid) {
    test(`rejects ${JSON.stringify(input)}`, () => {
      const result = parseWords(input);
      assert.equal(result.isValid, false);
      assert.match(result.error, error);
    });
  }
});
