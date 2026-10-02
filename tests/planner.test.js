import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluateRoute, greedyInsertion, haversineMetres, plan, walkSeconds } from '../planner.js';

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

  test('is within budget when it ends before the deadline minus the safety margin', () => {
    const { isWithinBudget, spareSeconds } = evaluateRoute({ ...base, stops: [kmNorth(1)], finish: castlePark });
    // 2100 s used out of 5 h minus 600 s.
    assert.equal(isWithinBudget, true);
    assert.ok(Math.abs(spareSeconds - (5 * 3600 - 600 - 2100)) < 2);
  });

  test('is not within budget when it ends inside the safety margin', () => {
    const stops = [kmNorth(1)];
    // The route takes 1100 s, so a deadline 1500 s away leaves only 400 s,
    // which is less than the 600 s safety margin.
    for (const finish of [null, kmNorth(1)]) {
      const { isWithinBudget, spareSeconds } = evaluateRoute({ ...base, stops, finish, deadline: startTime + 1500_000 });
      assert.equal(isWithinBudget, false);
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

describe('greedyInsertion', () => {
  // Points walked at 3.6 km/h (1 m/s) with no detour, so each kilometre takes
  // exactly 1000 s.
  const kmFrom = (northKm, eastKm = 0) => ({
    lat: castlePark.lat + (northKm * 1000) / 111195,
    lng: castlePark.lng + (eastKm * 1000) / (111195 * Math.cos((castlePark.lat * Math.PI) / 180)),
  });
  const startTime = Date.parse('2026-10-03T11:00:00+01:00');
  const base = {
    start: castlePark,
    startTime,
    deadline: Date.parse('2026-10-03T16:00:00+01:00'),
    speedKmh: 3.6,
    detourFactor: 1,
    dwellSeconds: 100,
    safetyMarginSeconds: 600,
  };
  const withDeadlineAfter = (seconds) => ({ ...base, deadline: startTime + (seconds + base.safetyMarginSeconds) * 1000 });

  // Small seeded random number generator (mulberry32), so the random tests
  // are repeatable.
  const random = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  test('returns an empty route when there are no points', () => {
    assert.deepEqual(greedyInsertion({ ...base, points: [] }), []);
  });

  test('visits every point in order along a line when there is plenty of time', () => {
    const points = [kmFrom(3), kmFrom(1), kmFrom(2)];
    assert.deepEqual(greedyInsertion({ ...base, points }), [1, 2, 0]);
  });

  test('visits every point and returns to a finish at the start when there is plenty of time', () => {
    const points = [kmFrom(1), kmFrom(1, 1), kmFrom(0, 1)];
    const order = greedyInsertion({ ...base, points, finish: castlePark });
    assert.deepEqual([...order].sort(), [0, 1, 2]);
  });

  test('leaves out points that do not fit, keeping the nearest', () => {
    const points = [kmFrom(3), kmFrom(1), kmFrom(2)];
    // 2 km of walking plus two selfies is 2200 s; a third point needs 1100 s more.
    assert.deepEqual(greedyInsertion({ ...withDeadlineAfter(2500), points }), [1, 2]);
  });

  test('prefers points on the way to the finish over detours', () => {
    const points = [kmFrom(-1), kmFrom(1)];
    // The walk to the finish takes 3000 s, the point on the way adds only its
    // 100 s selfie, and the detour south adds 2100 s.
    const order = greedyInsertion({ ...withDeadlineAfter(3500), points, finish: kmFrom(3) });
    assert.deepEqual(order, [1]);
  });

  test('returns an empty route when even the walk to the finish does not fit', () => {
    const order = greedyInsertion({ ...withDeadlineAfter(1000), points: [kmFrom(1)], finish: kmFrom(3) });
    assert.deepEqual(order, []);
  });

  test('visits at least as many points without a finish as with one', () => {
    const points = [kmFrom(1), kmFrom(2), kmFrom(3), kmFrom(4)];
    const options = { ...withDeadlineAfter(4500), points };
    const withoutFinish = greedyInsertion(options);
    const withFinish = greedyInsertion({ ...options, finish: castlePark });
    assert.equal(withoutFinish.length, 4);
    assert.equal(withFinish.length, 2);
  });

  test('never goes over the time budget on random routes', () => {
    const next = random(42);
    for (let run = 0; run < 200; run += 1) {
      const points = Array.from({ length: 2 + Math.floor(next() * 30) }, () => kmFrom(next() * 6 - 3, next() * 6 - 3));
      const finish = next() < 0.5 ? null : kmFrom(next() * 6 - 3, next() * 6 - 3);
      const options = { ...withDeadlineAfter(next() * 20000), points, finish };
      const order = greedyInsertion(options);
      assert.equal(new Set(order).size, order.length, 'visits each point at most once');
      assert.ok(order.every((index) => index >= 0 && index < points.length), 'returns valid indexes');
      const stops = order.map((index) => points[index]);
      if (order.length > 0 || finish === null) {
        assert.ok(evaluateRoute({ ...options, stops }).isWithinBudget, `run ${run} is over budget`);
      }
    }
  });
});

describe('plan', () => {
  // Points walked at 3.6 km/h (1 m/s) with no detour, so each kilometre takes
  // exactly 1000 s.
  const kmNorth = (km) => ({ lat: castlePark.lat + (km * 1000) / 111195, lng: castlePark.lng });
  const startTime = Date.parse('2026-10-03T11:00:00+01:00');
  const base = {
    start: castlePark,
    startTime,
    deadline: Date.parse('2026-10-03T16:00:00+01:00'),
    speedKmh: 3.6,
    detourFactor: 1,
    dwellSeconds: 100,
    safetyMarginSeconds: 600,
  };
  const withDeadlineAfter = (seconds) => ({ ...base, deadline: startTime + (seconds + base.safetyMarginSeconds) * 1000 });
  const finishes = [
    ['without a finish', null],
    ['with a finish', castlePark],
  ];

  for (const [name, finish] of finishes) {
    describe(name, () => {
      test('visits every point when there is plenty of time', () => {
        const points = [kmNorth(2), kmNorth(1)];
        const result = plan({ ...base, points, finish });
        // With a finish back at the start, either direction along the line
        // takes the same time.
        assert.deepEqual([...result.order].sort(), [0, 1]);
        assert.deepEqual(result.skipped, []);
      });

      test('stays within the time budget', () => {
        const points = [kmNorth(1), kmNorth(2), kmNorth(3), kmNorth(4)];
        const options = { ...withDeadlineAfter(4500), points, finish };
        const result = plan(options);
        assert.ok(result.spareSeconds >= 0);
        assert.ok(result.endEta <= options.deadline - options.safetyMarginSeconds * 1000);
      });

      test('skips points when time is short', () => {
        const points = [kmNorth(1), kmNorth(2), kmNorth(3), kmNorth(4)];
        const result = plan({ ...withDeadlineAfter(2500), points, finish });
        assert.ok(result.skipped.length > 0);
        assert.deepEqual([...result.order, ...result.skipped].sort(), [0, 1, 2, 3]);
        assert.deepEqual(result.skipped, [...result.skipped].sort());
      });

      test('matches the timings from evaluateRoute', () => {
        const points = [kmNorth(1), kmNorth(2)];
        const options = { ...base, points, finish };
        const result = plan(options);
        const timeline = evaluateRoute({ ...options, stops: result.order.map((index) => points[index]) });
        assert.deepEqual(result.arrivalTimes, timeline.arrivalTimes);
        assert.equal(result.endEta, timeline.endEta);
        assert.equal(result.spareSeconds, timeline.spareSeconds);
      });

      test('skips every point when the deadline has passed', () => {
        const points = [kmNorth(1), kmNorth(2)];
        const result = plan({ ...base, points, finish, deadline: startTime - 1000 });
        assert.deepEqual(result.order, []);
        assert.deepEqual(result.arrivalTimes, []);
        assert.deepEqual(result.skipped, [0, 1]);
      });
    });
  }

  test('ignores extra properties on points, such as labels', () => {
    const points = [{ ...kmNorth(1), label: 'Old Kent Road', words: 'filled.count.soap' }];
    assert.deepEqual(plan({ ...base, points }).order, [0]);
  });

  test('rejects invalid walking settings', () => {
    assert.throws(() => plan({ ...base, points: [kmNorth(1)], speedKmh: 0 }), RangeError);
  });
});
