import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseLocation, parseLocations } from '../locations.js';

describe('parseLocation', () => {
  const assertLocation = (line, expected) => {
    const result = parseLocation(line);
    assert.equal(result.isValid, true, result.error);
    assert.deepEqual(result.location, { words: null, ...expected });
  };

  test('accepts coordinates without a space', () => {
    assertLocation('51.4545,-2.5879', { lat: 51.4545, lng: -2.5879, label: '51.4545, -2.5879', key: '51.454500,-2.587900' });
  });

  test('accepts coordinates with a space', () => {
    assertLocation('51.4545, -2.5879', { lat: 51.4545, lng: -2.5879, label: '51.4545, -2.5879', key: '51.454500,-2.587900' });
  });

  test('gets the label, what3words address and coordinates', () => {
    assertLocation('Old Kent Road ///filled.count.soap 51.4545,-2.5879', {
      lat: 51.4545,
      lng: -2.5879,
      label: 'Old Kent Road',
      words: 'filled.count.soap',
      key: '51.454500,-2.587900',
    });
  });

  test('accepts the parts in any order', () => {
    for (const line of [
      '51.4545,-2.5879 Old Kent Road ///filled.count.soap',
      '///filled.count.soap 51.4545, -2.5879 Old Kent Road',
      '///Filled.Count.Soap Old Kent Road 51.4545,-2.5879',
    ]) {
      assertLocation(line, { lat: 51.4545, lng: -2.5879, label: 'Old Kent Road', words: 'filled.count.soap', key: '51.454500,-2.587900' });
    }
  });

  test('removes separators around the label', () => {
    for (const line of ['Old Kent Road, 51.4545,-2.5879', 'Old Kent Road - 51.4545,-2.5879', '51.4545,-2.5879 | Old Kent Road', '  Old   Kent Road ,  51.4545,-2.5879  ']) {
      assert.equal(parseLocation(line).location.label, 'Old Kent Road', line);
    }
  });

  test('keeps numbers and punctuation inside the label', () => {
    assert.equal(parseLocation('Platform 9¾, King’s Cross 51.4545,-2.5879').location.label, 'Platform 9¾, King’s Cross');
  });

  test('accepts what3words links', () => {
    for (const line of ['https://w3w.co/filled.count.soap 51.4545,-2.5879', 'what3words.com/filled.count.soap 51.4545,-2.5879', 'filled.count.soap 51.4545,-2.5879']) {
      assert.equal(parseLocation(line).location.words, 'filled.count.soap', line);
    }
  });

  test('labels a location with its what3words address when there is no label', () => {
    assert.equal(parseLocation('///filled.count.soap 51.4545,-2.5879').location.label, '///filled.count.soap');
  });

  test('gives the same key to the same coordinates written differently', () => {
    assert.equal(parseLocation('51.4545,-2.5879').location.key, parseLocation('A 51.45450, -2.58790').location.key);
  });

  test('rejects an out-of-range latitude', () => {
    const result = parseLocation('91.0,-2.5879');
    assert.equal(result.isValid, false);
    assert.match(result.error, /latitude 91.0 must be between -90 and 90/);
  });

  test('rejects an out-of-range longitude', () => {
    const result = parseLocation('51.4545,-181.5');
    assert.equal(result.isValid, false);
    assert.match(result.error, /longitude -181.5 must be between -180 and 180/);
  });

  test('asks for the coordinates when a line only has a what3words address', () => {
    const result = parseLocation('Old Kent Road ///filled.count.soap');
    assert.equal(result.isValid, false);
    assert.match(result.error, /Add the coordinates for \/\/\/filled\.count\.soap/);
    assert.equal(result.lookupUrl, 'https://what3words.com/filled.count.soap');
  });

  test('asks for the coordinates when a line only has a label', () => {
    const result = parseLocation('Old Kent Road');
    assert.equal(result.isValid, false);
    assert.match(result.error, /Add the coordinates/);
    assert.equal(result.lookupUrl, undefined);
  });

  test('rejects more than one set of coordinates', () => {
    const result = parseLocation('51.4545,-2.5879 51.4600,-2.6000');
    assert.equal(result.isValid, false);
    assert.match(result.error, /more than one set of coordinates/);
  });

  test('rejects more than one what3words address', () => {
    const result = parseLocation('///filled.count.soap ///index.home.raft 51.4545,-2.5879');
    assert.equal(result.isValid, false);
    assert.match(result.error, /more than one what3words address/);
  });
});

describe('parseLocations', () => {
  test('parses each line and ignores blank lines', () => {
    const lines = parseLocations('Old Kent Road 51.4545,-2.5879\n\n   \r\nWhitechapel Road ///filled.count.soap\n');
    assert.deepEqual(
      lines.map(({ lineNumber, text, result }) => [lineNumber, text, result.isValid]),
      [
        [1, 'Old Kent Road 51.4545,-2.5879', true],
        [4, 'Whitechapel Road ///filled.count.soap', false],
      ],
    );
  });

  test('returns nothing for an empty list', () => {
    assert.deepEqual(parseLocations(''), []);
  });
});
