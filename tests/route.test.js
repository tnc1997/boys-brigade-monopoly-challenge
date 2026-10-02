import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { describeRoute, directionsUrl, formatDuration, progress, toggleDone } from '../route.js';
import { planFromSetup } from '../setup.js';
import { defaultState } from '../storage.js';

const now = new Date(2026, 9, 3, 11, 0).getTime();

const savedPlan = (setup = {}, settings = {}) => {
  const state = defaultState();
  return planFromSetup({
    setup: { ...state.setup, locationsText: 'Old Kent Road ///filled.count.soap 51.4545,-2.5879\nTemple Meads 51.4492,-2.5813', ...setup },
    settings: { ...state.settings, ...settings },
    now,
  }).plan;
};

describe('directionsUrl', () => {
  test('links to walking directions to the location', () => {
    const url = new URL(directionsUrl({ lat: 51.4545, lng: -2.5879 }));
    assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('destination'), '51.4545,-2.5879');
    assert.equal(url.searchParams.get('travelmode'), 'walking');
  });
});

describe('formatDuration', () => {
  for (const [seconds, text] of [
    [0, 'under 1 min'],
    [29, 'under 1 min'],
    [30, '1 min'],
    [943, '16 min'],
    [3570, '1 h'],
    [3600, '1 h'],
    [3900, '1 h 5 min'],
  ]) {
    test(`formats ${seconds} s as ${text}`, () => {
      assert.equal(formatDuration(seconds), text);
    });
  }
});

describe('describeRoute', () => {
  test('describes each stop in order with its arrival time, walk time and links', () => {
    const plan = savedPlan();
    const { stops } = describeRoute(plan);
    assert.deepEqual(stops.map(({ number }) => number), [1, 2]);
    assert.deepEqual(stops.map(({ location }) => location.label), plan.order.map((index) => plan.points[index].label));
    assert.deepEqual(stops.map(({ arrivalTime }) => arrivalTime), plan.arrivalTimes);
    for (const stop of stops) {
      assert.ok(stop.walkSeconds > 0);
      assert.equal(stop.directionsUrl, directionsUrl(stop.location));
    }
  });

  test('walk times add up to the arrival times', () => {
    const plan = savedPlan();
    const { stops } = describeRoute(plan);
    let time = plan.startTime;
    for (const [position, stop] of stops.entries()) {
      time += (position > 0 ? plan.settings.dwellSeconds : 0) * 1000 + stop.walkSeconds * 1000;
      assert.ok(Math.abs(time - stop.arrivalTime) < 1, `stop ${stop.number}`);
    }
  });

  test('links to the what3words address only when there is one', () => {
    const { stops } = describeRoute(savedPlan());
    const byLabel = Object.fromEntries(stops.map((stop) => [stop.location.label, stop.what3wordsUrl]));
    assert.equal(byLabel['Old Kent Road'], 'https://what3words.com/filled.count.soap');
    assert.equal(byLabel['Temple Meads'], null);
  });

  test('has no finish when the plan has none, and ends with the last selfie', () => {
    const plan = savedPlan();
    const route = describeRoute(plan);
    assert.equal(route.finish, null);
    assert.equal(route.endEta, plan.endEta);
  });

  test('describes the walk to the finish when there is one', () => {
    const plan = savedPlan({ finishText: 'Finish 51.4556,-2.5894' });
    const { finish, endEta } = describeRoute(plan);
    assert.equal(finish.location.label, 'Finish');
    assert.equal(finish.arrivalTime, endEta);
    assert.ok(finish.walkSeconds > 0);
  });

  test('lists the skipped locations in list order', () => {
    const plan = savedPlan({ startTimeText: '15:40' });
    const { stops, skipped } = describeRoute(plan);
    assert.equal(stops.length, 0);
    assert.deepEqual(skipped.map(({ label }) => label), ['Old Kent Road', 'Temple Meads']);
  });
});

describe('toggleDone', () => {
  test('marks a location as done', () => {
    assert.deepEqual(toggleDone(['a'], 'b'), ['a', 'b']);
  });

  test('un-marks a location that was done', () => {
    assert.deepEqual(toggleDone(['a', 'b'], 'a'), ['b']);
  });

  test("doesn't change the original list", () => {
    const doneKeys = ['a'];
    toggleDone(doneKeys, 'b');
    assert.deepEqual(doneKeys, ['a']);
  });
});

describe('progress', () => {
  test('counts the done locations out of every location in the list', () => {
    const plan = savedPlan();
    assert.deepEqual(progress(plan, []), { done: 0, total: 2 });
    assert.deepEqual(progress(plan, [plan.points[0].key]), { done: 1, total: 2 });
    assert.deepEqual(progress(plan, plan.points.map(({ key }) => key)), { done: 2, total: 2 });
  });

  test('ignores keys of locations that are not in the plan', () => {
    assert.deepEqual(progress(savedPlan(), ['0.000000,0.000000']), { done: 0, total: 2 });
  });
});
