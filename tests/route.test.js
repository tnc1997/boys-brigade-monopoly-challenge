import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { describeRoute, directionsUrl, formatDuration, mapRoute, progress, timeWarning, toggleDone } from '../route.js';
import { planFromSetup } from '../setup.js';
import { defaultState } from '../storage.js';

const now = new Date(2026, 9, 3, 11, 0).getTime();

const savedPlan = (setup = {}, settings = {}) => {
  const state = defaultState();
  return planFromSetup({
    setup: { ...state.setup, locationsText: 'Old Kent Road 51.4545,-2.5879\nTemple Meads 51.4492,-2.5813', ...setup },
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

describe('mapRoute', () => {
  const formatTime = (time) => new Date(time).toISOString().slice(11, 16);

  test('marks the start and numbers the stops in visiting order, like the list', () => {
    const plan = savedPlan();
    const { markers, path } = mapRoute(plan, [], formatTime);
    const { stops } = describeRoute(plan);
    assert.equal(markers[0].kind, 'start');
    assert.deepEqual(
      markers.filter(({ kind }) => kind === 'stop').map(({ label, location }) => [label, location.label]),
      stops.map(({ number, location }) => [String(number), location.label]),
    );
    assert.deepEqual(path, [plan.start, ...stops.map(({ location }) => location)]);
  });

  test('describes each marker for its tooltip', () => {
    const { markers } = mapRoute(savedPlan(), [], formatTime);
    assert.equal(markers[0].title, 'Start: Castle Park');
    assert.match(markers[1].title, /^1\. .+, ETA \d\d:\d\d$/);
  });

  test('marks done stops differently, including done locations that are not on the route', () => {
    const plan = savedPlan();
    const [first] = describeRoute(plan).stops;
    const { markers } = mapRoute(plan, [first.location.key], formatTime);
    const done = markers.filter(({ kind }) => kind === 'done');
    assert.equal(done.length, 1);
    assert.match(done[0].title, /selfie done$/);

    const replanned = planFromSetup({
      setup: { ...defaultState().setup, locationsText: 'Old Kent Road 51.4545,-2.5879\nTemple Meads 51.4492,-2.5813' },
      settings: defaultState().settings,
      now,
      doneKeys: [first.location.key],
    }).plan;
    const offRoute = mapRoute(replanned, [first.location.key], formatTime).markers.filter(({ kind }) => kind === 'done');
    assert.deepEqual(offRoute.map(({ label }) => label), ['✓']);
  });

  test('only marks the finish when there is one, and ends the line there', () => {
    assert.equal(mapRoute(savedPlan(), [], formatTime).markers.some(({ kind }) => kind === 'finish'), false);
    const plan = savedPlan({ finishText: 'Finish 51.4556,-2.5894' });
    const { markers, path } = mapRoute(plan, [], formatTime);
    assert.equal(markers.filter(({ kind }) => kind === 'finish').length, 1);
    assert.equal(path.at(-1), plan.finish);
  });

  test('includes skipped locations, but not in the line', () => {
    const plan = savedPlan({ startTimeText: '15:40' });
    const { markers, path } = mapRoute(plan, [], formatTime);
    assert.deepEqual(markers.filter(({ kind }) => kind === 'skipped').map(({ location }) => location.label), ['Old Kent Road', 'Temple Meads']);
    assert.deepEqual(path, [plan.start]);
  });
});

describe('timeWarning', () => {
  const minutes = (count) => count * 60000;

  test('stays quiet when there is plenty of time and the team is on schedule', () => {
    const plan = savedPlan();
    assert.equal(timeWarning(plan, [], plan.startTime), null);
    assert.equal(timeWarning(plan, [], plan.arrivalTimes[0] - minutes(1)), null);
  });

  test('tells the team to head to the finish when the time left is down to the safety margin', () => {
    const plan = savedPlan({ finishText: 'Finish 51.4556,-2.5894' });
    const warning = timeWarning(plan, [], plan.deadline - minutes(10));
    assert.deepEqual(warning, { message: 'Head to the finish now: 10 minutes until the deadline.', minutesLeft: 10, minutesBehind: warning.minutesBehind });
  });

  test("says time's nearly up when there's no finish", () => {
    const plan = savedPlan();
    assert.equal(timeWarning(plan, [], plan.deadline - minutes(1)).message, "Last few selfies, time's nearly up: 1 minute until the deadline.");
  });

  test('warns when the team is running late enough to push the route into the safety margin', () => {
    // A short deadline leaves the route with little spare time, so running
    // late for the first stop pushes the end into the margin.
    const plan = savedPlan({ startTimeText: '15:10' });
    assert.ok(plan.order.length > 0);
    const spareMinutes = plan.spareSeconds / 60;
    const late = timeWarning(plan, [], plan.arrivalTimes[0] + minutes(spareMinutes + 2));
    assert.match(late.message, /^Running \d+ minutes behind plan/);
    assert.ok(late.minutesBehind >= spareMinutes);
    // Being late by less than the spare time is fine.
    assert.equal(timeWarning(plan, [], plan.arrivalTimes[0] + minutes(spareMinutes / 2)), null);
  });

  test('measures lateness against the next stop that is not done', () => {
    const plan = savedPlan({ startTimeText: '15:10' });
    const allDone = plan.order.map((index) => plan.points[index].key);
    // Everything is done, so there's no stop to be late for, and the time
    // left is more than the margin.
    assert.equal(timeWarning(plan, allDone, plan.arrivalTimes.at(-1) + minutes(1)), null);
  });

  test("doesn't warn when every stop is done and there's no finish to reach", () => {
    const plan = savedPlan();
    const allDone = plan.order.map((index) => plan.points[index].key);
    assert.equal(timeWarning(plan, allDone, plan.deadline - minutes(5)), null);
    const withFinish = savedPlan({ finishText: 'Finish 51.4556,-2.5894' });
    const allDoneWithFinish = withFinish.order.map((index) => withFinish.points[index].key);
    assert.match(timeWarning(withFinish, allDoneWithFinish, withFinish.deadline - minutes(5)).message, /^Head to the finish now/);
  });

  test('says when the deadline has passed', () => {
    assert.equal(timeWarning(savedPlan(), [], savedPlan().deadline + minutes(5)).message, "The deadline has passed. Time's up.");
    const withFinish = savedPlan({ finishText: 'Finish 51.4556,-2.5894' });
    assert.equal(timeWarning(withFinish, [], withFinish.deadline).message, 'The deadline has passed. Head to the finish now.');
  });
});
