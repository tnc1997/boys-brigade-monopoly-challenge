import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SPEED_PRESETS, SPEED_RANGE, settingsSummary, speedPreset } from '../settings.js';
import { defaultState } from '../storage.js';

describe('speedPreset', () => {
  test('matches each preset', () => {
    for (const preset of SPEED_PRESETS) {
      assert.equal(speedPreset(preset.speedKmh), preset);
    }
  });

  test('matches a preset despite rounding from the slider', () => {
    assert.equal(speedPreset(4.500000001)?.name, 'Medium');
    assert.equal(speedPreset(3.4999)?.name, 'Slow');
  });

  test('returns null for speeds between presets', () => {
    for (const speed of [4.2, 5.0, 2, 7, NaN]) {
      assert.equal(speedPreset(speed), null, String(speed));
    }
  });

  test('has presets of Slow 3.5, Medium 4.5 and Fast 5.5 km/h, with Medium as the default speed', () => {
    assert.deepEqual(SPEED_PRESETS.map(({ name, speedKmh }) => `${name} ${speedKmh}`), ['Slow 3.5', 'Medium 4.5', 'Fast 5.5']);
    assert.equal(speedPreset(defaultState().settings.speedKmh)?.name, 'Medium');
  });

  test('keeps every preset inside the slider range', () => {
    for (const { speedKmh } of SPEED_PRESETS) {
      assert.ok(speedKmh >= SPEED_RANGE.min && speedKmh <= SPEED_RANGE.max);
    }
  });
});

describe('settingsSummary', () => {
  test('names the preset when the speed matches one', () => {
    assert.equal(settingsSummary({ speedKmh: 4.5, dwellSeconds: 180 }), 'Medium 4.5 km/h · 3 min/selfie');
    assert.equal(settingsSummary({ speedKmh: 3.5, dwellSeconds: 300 }), 'Slow 3.5 km/h · 5 min/selfie');
  });

  test('shows just the speed between presets', () => {
    assert.equal(settingsSummary({ speedKmh: 4.2, dwellSeconds: 180 }), '4.2 km/h · 3 min/selfie');
  });

  test('shows half minutes of selfie time', () => {
    assert.equal(settingsSummary({ speedKmh: 4.5, dwellSeconds: 90 }), 'Medium 4.5 km/h · 1.5 min/selfie');
  });

  test('says when a setting is missing', () => {
    assert.equal(settingsSummary({ speedKmh: NaN, dwellSeconds: NaN }), 'speed not set · selfie time not set');
  });
});
