import { DAW_CC_MAP } from '../spec/generated.ts';

/** CC 46h (70). Guide p.17, and the user guide's "Fader pickup" section. */
export const FADER_PICKUP_CC = 70;
/** CC 47h (71). Touch On/Off on channel 15 — the Shift + move preview gesture. */
export const TOUCH_EVENTS_CC = 71;
/** CC 79h (121). Slow / medium / fast. */
export const ENCODER_CURVE_CC = 121;
/** CC 6Fh (111). Scales every LED, 0 to 127. */
export const LED_BRIGHTNESS_CC = 111;

/** Row number to the feature control that switches it to relative output. */
export const RELATIVE_TOGGLE_CC: Readonly<Record<number, number>> = {
  1: DAW_CC_MAP.controls.encoderRow1.relativeToggleCC,
  2: DAW_CC_MAP.controls.encoderRow2.relativeToggleCC,
  3: DAW_CC_MAP.controls.encoderRow3.relativeToggleCC,
};

export const RELATIVE_PIVOT = DAW_CC_MAP.relativeEncoding.pivot;

/**
 * How far one step of physical rotation moves the value.
 *
 * The guide names the three curves and nothing else — no ratios, no
 * acceleration formula. These multipliers are a usable approximation, not a
 * measurement, and are collected here so a phase 8 capture can replace them
 * with one edit.
 */
export const ENCODER_CURVE_FACTOR: Readonly<Record<number, number>> = {
  0: 1, // slow
  1: 2, // medium — the default
  2: 4, // fast
};

/** A double press within this window latches Shift (user guide p.13). */
export const SHIFT_LATCH_WINDOW_MS = 400;

/**
 * Whether a move from `from` to `to` catches `target`.
 *
 * The user guide: "the control only outputs MIDI when you move it to the
 * position of the parameter you're controlling". Reaching the value counts, not
 * just passing it, or a parameter parked at 0 or 127 could never be caught.
 */
export const crosses = (from: number, to: number, target: number): boolean =>
  (from <= target && to >= target) || (from >= target && to <= target);
