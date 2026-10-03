import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { planFromSetup, replanStartingPoint, searchesNeeded, startTimeToday, timeToday } from '../setup.js';
import { defaultState } from '../storage.js';

const now = new Date(2026, 9, 3, 11, 0).getTime();

const setupWith = (setup = {}, settings = {}) => {
  const state = defaultState();
  return {
    setup: { ...state.setup, locationsText: 'Old Kent Road 51.4545,-2.5879\nTemple Meads 51.4492,-2.5813', ...setup },
    settings: { ...state.settings, ...settings },
    now,
  };
};

describe('timeToday', () => {
  test('converts a time to the same local day', () => {
    assert.equal(timeToday('16:00', now), new Date(2026, 9, 3, 16, 0).getTime());
    assert.equal(timeToday(' 09:05 ', now), new Date(2026, 9, 3, 9, 5).getTime());
  });

  test('rejects invalid times', () => {
    for (const time of ['', '4pm', '24:00', '12:60', '1:00']) {
      assert.equal(timeToday(time, now), null, time);
    }
  });
});

describe('planFromSetup', () => {
  test('plans every location from the default setup', () => {
    const { plan, error, invalidLines } = planFromSetup(setupWith());
    assert.equal(error, null);
    assert.deepEqual(invalidLines, []);
    assert.deepEqual([...plan.order].sort(), [0, 1]);
    assert.deepEqual(plan.points.map(({ label }) => label), ['Old Kent Road', 'Temple Meads']);
    assert.equal(plan.start.label, 'Castle Park');
    assert.equal(plan.startTime, now);
    assert.equal(plan.deadline, new Date(2026, 9, 3, 16, 0).getTime());
  });

  test('plans an open route when the finish is blank', () => {
    assert.equal(planFromSetup(setupWith({ finishText: '  ' })).plan.finish, null);
  });

  test('plans to the finish when there is one', () => {
    const { plan } = planFromSetup(setupWith({ finishText: 'Finish 51.4556,-2.5894' }));
    assert.equal(plan.finish.label, 'Finish');
  });

  test('returns every line with its result', () => {
    const { lines } = planFromSetup(setupWith({ locationsText: 'Old Kent Road 51.4545,-2.5879\n\nNowhere' }));
    assert.deepEqual(lines.map(({ lineNumber, result }) => [lineNumber, result.isValid]), [
      [1, true],
      [3, false],
    ]);
  });

  test('returns invalid lines without stopping the rest', () => {
    const { plan, invalidLines } = planFromSetup(setupWith({ locationsText: 'Old Kent Road 51.4545,-2.5879\nWhitechapel ///filled.count.soap\nNowhere' }));
    assert.equal(plan.points.length, 1);
    assert.deepEqual(invalidLines.map(({ lineNumber }) => lineNumber), [2, 3]);
    assert.match(invalidLines[0].result.error, /what3words address/);
  });

  test('uses the start time when one is entered', () => {
    const { plan } = planFromSetup(setupWith({ startTimeText: '11:30' }));
    assert.equal(plan.startTime, new Date(2026, 9, 3, 11, 30).getTime());
  });

  test('leaves done locations out of the route but keeps them in the points', () => {
    const { plan: firstPlan } = planFromSetup(setupWith());
    const doneKey = firstPlan.points[0].key;
    const { plan } = planFromSetup({ ...setupWith(), doneKeys: [doneKey] });
    assert.deepEqual(plan.points.map(({ label }) => label), ['Old Kent Road', 'Temple Meads']);
    assert.deepEqual(plan.order, [1]);
    assert.deepEqual(plan.skipped, []);
    assert.equal(plan.arrivalTimes.length, 1);
  });

  test('maps skipped locations back to their place in the list', () => {
    const { plan: firstPlan } = planFromSetup(setupWith());
    const { plan } = planFromSetup({ ...setupWith({ startTimeText: '15:40' }), doneKeys: [firstPlan.points[0].key] });
    assert.deepEqual(plan.order, []);
    assert.deepEqual(plan.skipped, [1]);
  });

  test('re-plans from the current position and time, ignoring the Start field and start time', () => {
    const from = { lat: 51.4492, lng: -2.5813 };
    const later = new Date(2026, 9, 3, 13, 15).getTime();
    const { plan, error } = planFromSetup({ ...setupWith({ startText: 'not a location', startTimeText: '11:00' }), now: later, from });
    assert.equal(error, null);
    assert.deepEqual(plan.start, { lat: 51.4492, lng: -2.5813, label: 'Your position', key: '51.449200,-2.581300' });
    assert.equal(plan.startTime, later);
  });

  test('uses the current form values when re-planning', () => {
    const from = { lat: 51.4492, lng: -2.5813 };
    const { plan } = planFromSetup({ ...setupWith({ finishText: 'Finish 51.4556,-2.5894' }, { speedKmh: 3.5 }), from });
    assert.equal(plan.finish.label, 'Finish');
    assert.equal(plan.settings.speedKmh, 3.5);
  });

  const failures = [
    ['there are no usable locations', { locationsText: 'Nowhere' }, {}, /at least one location/],
    ['the start is invalid', { startText: 'Castle Park' }, {}, /^Start: /],
    ['the finish is invalid', { finishText: 'Somewhere' }, {}, /^Finish: /],
    ['the start time is invalid', { startTimeText: 'soon' }, {}, /^Start time: /],
    ['the deadline is invalid', {}, { deadline: '' }, /^Deadline: Enter a time/],
    ['the deadline is before the start time', { startTimeText: '16:30' }, {}, /^Deadline: The deadline must be after/],
    ['the walking speed is 0', {}, { speedKmh: 0 }, /^Walking speed: /],
    ['the walking speed is below the slider range', {}, { speedKmh: 1.5 }, /^Walking speed: Enter a speed between 2 and 7 km\/h/],
    ['the walking speed is above the slider range', {}, { speedKmh: 9 }, /^Walking speed: Enter a speed between 2 and 7 km\/h/],
    ['the selfie time is negative', {}, { dwellSeconds: -60 }, /^Selfie time: /],
  ];
  for (const [name, setup, settings, error] of failures) {
    test(`stops planning when ${name}`, () => {
      const result = planFromSetup(setupWith(setup, settings));
      assert.equal(result.plan, null);
      assert.match(result.error, error);
    });
  }
});

describe('planFromSetup with addresses and place names', () => {
  const searchResults = {
    'queen square, bristol': { isFound: true, lat: 51.4504, lng: -2.5947, name: 'Queen Square, City Centre, Bristol' },
    'temple meads': { isFound: true, lat: 51.4492, lng: -2.5813, name: 'Bristol Temple Meads' },
  };

  test('plans looked-up locations and says what each matched', () => {
    const { plan, matches, invalidLines } = planFromSetup({
      ...setupWith({ locationsText: 'Old Kent Road 51.4545,-2.5879\nQueen Square, Bristol', finishText: 'Temple Meads' }),
      searchResults,
    });
    assert.deepEqual(invalidLines, []);
    assert.equal(plan.points.length, 2);
    assert.equal(plan.finish.lat, 51.4492);
    assert.deepEqual(matches, [
      { source: 'Line 2', label: 'Queen Square, Bristol', matchedName: 'Queen Square, City Centre, Bristol' },
      { source: 'Finish', label: 'Temple Meads', matchedName: 'Bristol Temple Meads' },
    ]);
  });

  test('looks up the start too', () => {
    const { plan, matches } = planFromSetup({ ...setupWith({ startText: 'Queen Square, Bristol' }), searchResults });
    assert.equal(plan.start.lat, 51.4504);
    assert.deepEqual(matches.map(({ source }) => source), ['Start']);
  });
});

describe('searchesNeeded', () => {
  test('lists the lines, start and finish that need looking up, but not what3words addresses', () => {
    const setup = { ...defaultState().setup, locationsText: 'Old Kent Road 51.4545,-2.5879\nQueen Square, Bristol\n///filled.count.soap', startText: 'Temple Meads', finishText: 'Cabot Tower' };
    assert.deepEqual(searchesNeeded({ setup }), ['Queen Square, Bristol', 'Temple Meads', 'Cabot Tower']);
  });

  test('leaves out searches that are already known', () => {
    const setup = { ...defaultState().setup, locationsText: 'Queen Square, Bristol' };
    const searchResults = { 'queen square, bristol': { isFound: false, error: 'No match', isTemporary: false } };
    assert.deepEqual(searchesNeeded({ setup, searchResults }), []);
  });

  test('leaves out the start when re-planning from the team\'s position', () => {
    const setup = { ...defaultState().setup, locationsText: '', startText: 'Temple Meads' };
    assert.deepEqual(searchesNeeded({ setup, isFromPosition: true }), []);
  });
});

describe('startTimeToday', () => {
  test('uses now for a blank start time, and today otherwise', () => {
    assert.equal(startTimeToday('', now), now);
    assert.equal(startTimeToday(' 11:30 ', now), new Date(2026, 9, 3, 11, 30).getTime());
    assert.equal(startTimeToday('soon', now), null);
  });
});

describe('replanStartingPoint', () => {
  const at = (day, hours, minutes) => new Date(2026, 9, day, hours, minutes).getTime();
  const options = (overrides) => ({ startTimeText: '11:00', deadline: '16:00', doneKeys: [], isReplannedFromPositionToday: false, ...overrides });

  test('re-plans from the Start field before the start time, when nothing is ticked off', () => {
    assert.equal(replanStartingPoint(options({ now: at(3, 10, 30) })), 'start');
  });

  test("re-plans from the team's position between the start time and the deadline", () => {
    assert.equal(replanStartingPoint(options({ now: at(3, 11, 0) })), 'position');
    assert.equal(replanStartingPoint(options({ now: at(3, 14, 0) })), 'position');
  });

  test("re-plans from the Start field the evening before, after that day's deadline", () => {
    assert.equal(replanStartingPoint(options({ now: at(2, 20, 0) })), 'start');
  });

  test('re-plans from the Start field the morning of the challenge', () => {
    assert.equal(replanStartingPoint(options({ now: at(3, 9, 0) })), 'start');
  });

  test("re-plans from the team's position once a selfie is ticked off, even before the start time", () => {
    assert.equal(replanStartingPoint(options({ doneKeys: ['51.449200,-2.581300'], now: at(3, 10, 50) })), 'position');
  });

  test("re-plans from the team's position after re-planning from there today, even before the start time", () => {
    assert.equal(replanStartingPoint(options({ isReplannedFromPositionToday: true, now: at(3, 10, 45) })), 'position');
  });

  test('uses a start time that has just been put back', () => {
    assert.equal(replanStartingPoint(options({ startTimeText: '12:00', now: at(3, 11, 30) })), 'start');
  });

  test("re-plans from the team's position with no start time before the deadline", () => {
    assert.equal(replanStartingPoint(options({ startTimeText: '', now: at(3, 10, 0) })), 'position');
  });

  test('re-plans from the Start field with an invalid start time', () => {
    assert.equal(replanStartingPoint(options({ startTimeText: 'soon', now: at(3, 10, 0) })), 'start');
  });
});
