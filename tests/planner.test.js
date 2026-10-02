import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { haversineMetres, walkSeconds } from '../planner.js';

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

describe('walkSeconds', () => {
  // 1 km straight line, so the expected times are easy to check by hand.
  const oneKmNorth = { lat: castlePark.lat + 1000 / 111195, lng: castlePark.lng };

  test('defaults to 4.5 km/h with a detour factor of 1.3', () => {
    // 1 km × 1.3 = 1.3 km at 4.5 km/h = 1040 s.
    assertWithinPercent(walkSeconds(castlePark, oneKmNorth), 1040, 0.1);
  });

  test('uses a custom walking speed', () => {
    // 1 km × 1.3 = 1.3 km at 3.5 km/h ≈ 1337 s.
    assertWithinPercent(walkSeconds(castlePark, oneKmNorth, { speedKmh: 3.5 }), 1337, 0.1);
  });

  test('uses a custom detour factor', () => {
    // 1 km × 1 = 1 km at 4.5 km/h = 800 s.
    assertWithinPercent(walkSeconds(castlePark, oneKmNorth, { detourFactor: 1 }), 800, 0.1);
  });

  test('returns 0 for identical points', () => {
    assert.equal(walkSeconds(castlePark, castlePark), 0);
  });

  test('rejects a speed that is not greater than 0', () => {
    for (const speedKmh of [0, -1, NaN]) {
      assert.throws(() => walkSeconds(castlePark, oneKmNorth, { speedKmh }), RangeError);
    }
  });

  test('rejects a detour factor less than 1', () => {
    for (const detourFactor of [0.9, 0, NaN]) {
      assert.throws(() => walkSeconds(castlePark, oneKmNorth, { detourFactor }), RangeError);
    }
  });
});
