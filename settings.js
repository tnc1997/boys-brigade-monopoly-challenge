/**
 * A walking speed preset.
 *
 * @typedef {object} SpeedPreset
 * @property {string} name The preset's name.
 * @property {number} speedKmh Its walking speed in km/h.
 */

/** Walking speed presets for the settings panel, from slowest to fastest. */
export const SPEED_PRESETS = [
  { name: 'Slow', speedKmh: 3.5 },
  { name: 'Medium', speedKmh: 4.5 },
  { name: 'Fast', speedKmh: 5.5 },
];

/** The range of the walking speed slider, in km/h. */
export const SPEED_RANGE = { min: 2, max: 7, step: 0.1 };

/**
 * Finds the preset a walking speed matches, if any.
 *
 * @param {number} speedKmh The walking speed in km/h.
 * @returns {SpeedPreset | null} The matching preset, or `null` if the speed is between presets.
 * @example
 * speedPreset(4.5); // { name: 'Medium', speedKmh: 4.5 }
 * speedPreset(4.2); // null
 */
export function speedPreset(speedKmh) {
  return SPEED_PRESETS.find((preset) => Math.abs(preset.speedKmh - speedKmh) < 0.05) ?? null;
}
