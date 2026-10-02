import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluateRoute, haversineMetres, walkSeconds } from '../planner.js';

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

describe('evaluateRoute', () => {
  // Points 1 km apart walked at 3.6 km/h (1 m/s) with no detour, so each
  // kilometre takes exactly 1000 s.
  const kmNorth = (km) => ({ lat: castlePark.lat + (km * 1000) / 111195, lng: castlePark.lng });
  const startTime = Date.parse('2026-10-03T11:00:00+01:00');
  const deadline = Date.parse('2026-10-03T16:00:00+01:00');
  const base = {
    start: castlePark,
    startTime,
    deadline,
    speedKmh: 3.6,
    detourFactor: 1,
    dwellSeconds: 100,
    safetyMarginSeconds: 600,
  };
  const assertTimesClose = (actual, expected) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((time, index) => assert.ok(Math.abs(time - expected[index]) < 2000, `stop ${index}: ${time} vs ${expected[index]}`));
  };
  const assertTimeClose = (actual, expected) => assertTimesClose([actual], [expected]);

  test('times each stop as the walk to it plus the selfie time at the previous stop', () => {
    const { arrivalTimes } = evaluateRoute({ ...base, stops: [kmNorth(1), kmNorth(2)] });
    assertTimesClose(arrivalTimes, [startTime + 1000_000, startTime + 2100_000]);
  });

  test('without a finish, ends when the last selfie is taken', () => {
    const { endEta } = evaluateRoute({ ...base, stops: [kmNorth(1), kmNorth(2)] });
    assertTimeClose(endEta, startTime + 2200_000);
  });

  test('with a finish, ends on arrival at the finish', () => {
    const { endEta } = evaluateRoute({ ...base, stops: [kmNorth(1), kmNorth(2)], finish: castlePark });
    assertTimeClose(endEta, startTime + 4200_000);
  });

  test('without stops or a finish, ends at the start time', () => {
    const { arrivalTimes, endEta } = evaluateRoute({ ...base, stops: [] });
    assert.deepEqual(arrivalTimes, []);
    assert.equal(endEta, startTime);
  });

  test('without stops but with a finish, walks straight to the finish', () => {
    const { endEta } = evaluateRoute({ ...base, stops: [], finish: kmNorth(3) });
    assertTimeClose(endEta, startTime + 3000_000);
  });

  test('fits the budget when it ends before the deadline minus the safety margin', () => {
    const { fitsBudget, spareSeconds } = evaluateRoute({ ...base, stops: [kmNorth(1)], finish: castlePark });
    // 2100 s used out of 5 h minus 600 s.
    assert.equal(fitsBudget, true);
    assert.ok(Math.abs(spareSeconds - (5 * 3600 - 600 - 2100)) < 2);
  });

  test('does not fit the budget when it ends inside the safety margin', () => {
    const stops = [kmNorth(1)];
    // The route takes 1100 s, so a deadline 1500 s away leaves only 400 s,
    // which is less than the 600 s safety margin.
    for (const finish of [null, kmNorth(1)]) {
      const { fitsBudget, spareSeconds } = evaluateRoute({ ...base, stops, finish, deadline: startTime + 1500_000 });
      assert.equal(fitsBudget, false);
      assert.ok(spareSeconds < 0);
    }
  });

  test('uses the default speed, detour factor, selfie time and safety margin', () => {
    const { arrivalTimes, endEta, spareSeconds } = evaluateRoute({ start: castlePark, stops: [kmNorth(1)], startTime, deadline });
    // 1 km × 1.3 at 4.5 km/h = 1040 s, then 180 s for the selfie.
    assertTimesClose(arrivalTimes, [startTime + 1040_000]);
    assertTimeClose(endEta, startTime + 1220_000);
    assert.ok(Math.abs(spareSeconds - (5 * 3600 - 900 - 1220)) < 2);
  });
});
