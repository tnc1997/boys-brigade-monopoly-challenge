import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { haversineMetres } from '../planner.js';

const castlePark = { lat: 51.4556, lng: -2.5894 };
const cliftonSuspensionBridge = { lat: 51.4549, lng: -2.6278 };
const templeMeads = { lat: 51.4492, lng: -2.5813 };

const assertWithinPercent = (actual, expected, percent) => {
  const tolerance = (expected * percent) / 100;
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${percent}% of ${expected}`,
  );
};

describe('haversineMetres', () => {
  test('returns 0 for identical points', () => {
    assert.equal(haversineMetres(castlePark, castlePark), 0);
  });

  test('one degree of latitude is about 111.2 km', () => {
    assertWithinPercent(haversineMetres({ lat: 51, lng: -2.6 }, { lat: 52, lng: -2.6 }), 111195, 0.1);
  });

  // Expected distances are from the equirectangular approximation, which is
  // accurate to well under 1% over a few kilometres.
  test('Castle Park to Clifton Suspension Bridge is about 2.66 km', () => {
    assertWithinPercent(haversineMetres(castlePark, cliftonSuspensionBridge), 2660, 1);
  });

  test('Castle Park to Temple Meads is about 906 m', () => {
    assertWithinPercent(haversineMetres(castlePark, templeMeads), 906, 1);
  });

  test('is symmetric', () => {
    assert.equal(
      haversineMetres(castlePark, cliftonSuspensionBridge),
      haversineMetres(cliftonSuspensionBridge, castlePark),
    );
  });
});
