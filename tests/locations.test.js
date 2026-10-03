import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addLocationLine, parseGoogleMapsUrl, parseLocation, parseLocations, pinLine } from '../locations.js';

describe('parseLocation', () => {
  const assertLocation = (line, expected) => {
    const result = parseLocation(line);
    assert.equal(result.isValid, true, result.error);
    assert.deepEqual(result.location, expected);
  };

  test('accepts coordinates without a space', () => {
    assertLocation('51.4545,-2.5879', { lat: 51.4545, lng: -2.5879, label: '51.4545, -2.5879', key: '51.454500,-2.587900' });
  });

  test('accepts coordinates with a space', () => {
    assertLocation('51.4545, -2.5879', { lat: 51.4545, lng: -2.5879, label: '51.4545, -2.5879', key: '51.454500,-2.587900' });
  });

  test('gets the label and coordinates', () => {
    assertLocation('Old Kent Road 51.4545,-2.5879', { lat: 51.4545, lng: -2.5879, label: 'Old Kent Road', key: '51.454500,-2.587900' });
  });

  test('accepts the label before or after the coordinates', () => {
    for (const line of ['51.4545,-2.5879 Old Kent Road', 'Old Kent Road 51.4545, -2.5879']) {
      assertLocation(line, { lat: 51.4545, lng: -2.5879, label: 'Old Kent Road', key: '51.454500,-2.587900' });
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

  test('rejects a what3words address, saying to replace it', () => {
    for (const line of [
      '///filled.count.soap',
      'Old Kent Road ///filled.count.soap',
      'Old Kent Road ///filled.count.soap 51.4545,-2.5879',
      '///filled.count.soap, Old Kent Road',
      'Old Kent Road;///filled.count.soap|Queen Square',
      'https://w3w.co/filled.count.soap',
      'what3words.com/filled.count.soap',
      'filled.count.soap',
    ]) {
      const result = parseLocation(line);
      assert.equal(result.isValid, false, line);
      assert.match(result.error, /looks like a what3words address, which can't be used\. Replace it with the address that Navigate gives/, line);
      assert.equal(result.query, undefined, line);
    }
  });

  test('names the what3words address in the message', () => {
    assert.match(parseLocation('Old Kent Road ///filled.count.soap').error, /^\/\/\/filled\.count\.soap looks like/);
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

  test('asks to look up a line with text but no coordinates', () => {
    const result = parseLocation('Old Kent Road');
    assert.equal(result.isValid, false);
    assert.equal(result.query, 'Old Kent Road');
    assert.match(result.error, /Press Plan route to look up "Old Kent Road"/);
  });

  test('rejects more than one set of coordinates', () => {
    const result = parseLocation('51.4545,-2.5879 51.4600,-2.6000');
    assert.equal(result.isValid, false);
    assert.match(result.error, /more than one set of coordinates/);
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

describe('parseGoogleMapsUrl', () => {
  const assertCoordinates = (url, lat, lng, placeName = null) => {
    assert.deepEqual(parseGoogleMapsUrl(url), { isValid: true, coordinates: { lat, lng }, placeName }, url);
  };

  test('reads ?q=lat,lng URLs', () => {
    assertCoordinates('https://www.google.com/maps?q=51.4545,-2.5879', '51.4545', '-2.5879');
    assertCoordinates('https://maps.google.com/?q=51.4545%2C-2.5879', '51.4545', '-2.5879');
    assertCoordinates('https://www.google.co.uk/maps?q=51.4545,+-2.5879', '51.4545', '-2.5879');
  });

  test('reads ?query=lat,lng and ?destination=lat,lng URLs', () => {
    assertCoordinates('https://www.google.com/maps/search/?api=1&query=51.4545,-2.5879', '51.4545', '-2.5879');
    assertCoordinates('https://www.google.com/maps/dir/?api=1&destination=51.4545,-2.5879', '51.4545', '-2.5879');
  });

  test('reads @lat,lng URLs', () => {
    assertCoordinates('https://www.google.com/maps/@51.4545,-2.5879,17z', '51.4545', '-2.5879');
  });

  test("prefers the pin's position over the centre of the map, and reads the place's name", () => {
    assertCoordinates(
      'https://www.google.com/maps/place/Castle+Park/@51.4560,-2.5900,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d51.4556!4d-2.5894!16s',
      '51.4556',
      '-2.5894',
      'Castle Park',
    );
  });

  test('reads URLs without https://', () => {
    assertCoordinates('google.com/maps?q=51.4545,-2.5879', '51.4545', '-2.5879');
    assertCoordinates('maps.google.com/?q=51.4545,-2.5879', '51.4545', '-2.5879');
  });

  test('rejects short URLs', () => {
    for (const url of ['https://maps.app.goo.gl/abc123', 'https://goo.gl/maps/abc123', 'maps.app.goo.gl/abc123']) {
      const result = parseGoogleMapsUrl(url);
      assert.equal(result.isValid, false, url);
      assert.match(result.error, /Short Google Maps links/);
    }
  });

  test('rejects URLs without coordinates', () => {
    for (const url of ['https://www.google.com/maps/search/?api=1&query=Castle+Park', 'https://www.google.com/maps?q=Castle+Park', 'https://www.google.com/maps']) {
      const result = parseGoogleMapsUrl(url);
      assert.equal(result.isValid, false, url);
      assert.match(result.error, /doesn't include coordinates/);
    }
  });
});

describe('parseLocation with Google Maps URLs', () => {
  test('uses the coordinates from the url', () => {
    const { location } = parseLocation('https://www.google.com/maps?q=51.4545,-2.5879');
    assert.deepEqual(location, { lat: 51.4545, lng: -2.5879, label: '51.4545, -2.5879', key: '51.454500,-2.587900' });
  });

  test('works with a label on the same line', () => {
    for (const line of [
      'Old Kent Road https://www.google.com/maps?q=51.4545,-2.5879',
      'https://www.google.com/maps?q=51.4545,-2.5879 Old Kent Road',
      'Old Kent Road, maps.google.com/?q=51.4545,-2.5879',
    ]) {
      assert.deepEqual(parseLocation(line).location, { lat: 51.4545, lng: -2.5879, label: 'Old Kent Road', key: '51.454500,-2.587900' }, line);
    }
  });

  test("labels a location with the place's name when there is no label", () => {
    const url = 'https://www.google.com/maps/place/Castle+Park/@51.4560,-2.5900,17z/data=!3d51.4556!4d-2.5894';
    assert.equal(parseLocation(url).location.label, 'Castle Park');
    assert.equal(parseLocation(`Start ${url}`).location.label, 'Start');
  });

  test('does not mistake the url for a what3words address', () => {
    assert.equal(parseLocation('maps.google.com/?q=51.4545,-2.5879').isValid, true);
  });

  test('rejects a short url with a message', () => {
    const result = parseLocation('Old Kent Road https://maps.app.goo.gl/abc123');
    assert.equal(result.isValid, false);
    assert.match(result.error, /Short Google Maps links/);
  });

  test('rejects a url and coordinates on the same line', () => {
    const result = parseLocation('https://www.google.com/maps?q=51.4545,-2.5879 51.4600,-2.6000');
    assert.equal(result.isValid, false);
    assert.match(result.error, /more than one set of coordinates/);
  });
});

describe('parseLocation with addresses and place names', () => {
  const found = { isFound: true, lat: 51.4504, lng: -2.5947, name: 'Queen Square, City Centre, Bristol, England' };
  const searchResults = { 'queen square, bristol': found };

  test('looks up the text', () => {
    assert.equal(parseLocation('Queen Square, Bristol').query, 'Queen Square, Bristol');
  });

  test('uses the search result once it is known', () => {
    assert.deepEqual(parseLocation('Queen Square, Bristol', { searchResults }).location, {
      lat: 51.4504,
      lng: -2.5947,
      label: 'Queen Square, Bristol',
      key: '51.450400,-2.594700',
      matchedName: 'Queen Square, City Centre, Bristol, England',
    });
  });

  test('matches the search result whatever the spacing and case', () => {
    assert.equal(parseLocation('queen  square, BRISTOL', { searchResults }).isValid, true);
  });

  test('uses the text before a colon as the label', () => {
    const result = parseLocation('Old Kent Road: Queen Square, Bristol', { searchResults });
    assert.equal(result.location.label, 'Old Kent Road');
    assert.equal(parseLocation('Old Kent Road: Queen Square, Bristol').query, 'Queen Square, Bristol');
  });

  test('shows why a search found nothing', () => {
    const notFound = { isFound: false, error: 'No match for "Nowhere" in Bristol.', isTemporary: false };
    const result = parseLocation('Nowhere', { searchResults: { nowhere: notFound } });
    assert.equal(result.isValid, false);
    assert.equal(result.error, 'No match for "Nowhere" in Bristol.');
    assert.equal(result.query, undefined);
  });

  test('prefers coordinates over looking up the text', () => {
    const result = parseLocation('Queen Square, Bristol 51.4545,-2.5879', { searchResults });
    assert.equal(result.location.lat, 51.4545);
    assert.equal(result.location.matchedName, undefined);
  });
});

describe('parseLocations with search results', () => {
  test('passes the search results to each line', () => {
    const searchResults = { 'temple meads': { isFound: true, lat: 51.4492, lng: -2.5813, name: 'Temple Meads' } };
    const [line] = parseLocations('Temple Meads', { searchResults });
    assert.equal(line.result.location.lat, 51.4492);
  });
});

describe('pinLine', () => {
  test('puts the label before the coordinates, to 6 decimal places', () => {
    const result = pinLine('Cabot Tower', { lat: 51.45174, lng: -2.6034 });
    assert.equal(result.isValid, true);
    assert.equal(result.line, 'Cabot Tower 51.451740,-2.603400');
    assert.deepEqual(result.location, { lat: 51.45174, lng: -2.6034, label: 'Cabot Tower', key: '51.451740,-2.603400' });
  });

  test('makes a line that reads back as the same location', () => {
    const { line } = pinLine('  Old   Kent Road ', { lat: 51.4545123456, lng: -2.5879 });
    assert.equal(line, 'Old Kent Road 51.454512,-2.587900');
    assert.deepEqual(parseLocation(line).location, { lat: 51.454512, lng: -2.5879, label: 'Old Kent Road', key: '51.454512,-2.587900' });
  });

  test('works on the prime meridian, where a longitude can round to -0', () => {
    assert.equal(pinLine('Greenwich', { lat: 51.4779, lng: -0.0000001 }).line, 'Greenwich 51.477900,-0.000000');
  });

  test('keeps a label with a colon or numbers', () => {
    assert.equal(pinLine('Stop 3: the bandstand', { lat: 51.45, lng: -2.59 }).line, 'Stop 3: the bandstand 51.450000,-2.590000');
  });

  test('needs a label', () => {
    for (const label of ['', '   ', '\n']) {
      assert.deepEqual(pinLine(label, { lat: 51.45, lng: -2.59 }), { isValid: false, error: 'Enter a name for the location.' });
    }
  });

  test('rejects a label that would stop the line being read', () => {
    for (const label of ['Near 51.4545,-2.5879', 'filled.count.soap', 'https://www.google.com/maps?q=51.4517,-2.6034']) {
      const result = pinLine(label, { lat: 51.45, lng: -2.59 });
      assert.equal(result.isValid, false, label);
      assert.match(result.error, /without coordinates, links or what3words addresses/);
    }
  });
});

describe('addLocationLine', () => {
  test('adds the line on its own line', () => {
    assert.equal(addLocationLine('Old Kent Road 51.4545,-2.5879', 'Pin 51.450000,-2.590000'), 'Old Kent Road 51.4545,-2.5879\nPin 51.450000,-2.590000');
  });

  test("doesn't add a blank line to an empty list or one that ends with a new line", () => {
    assert.equal(addLocationLine('', 'Pin 51.450000,-2.590000'), 'Pin 51.450000,-2.590000');
    assert.equal(addLocationLine('Old Kent Road 51.4545,-2.5879\n', 'Pin 51.450000,-2.590000'), 'Old Kent Road 51.4545,-2.5879\nPin 51.450000,-2.590000');
  });
});
