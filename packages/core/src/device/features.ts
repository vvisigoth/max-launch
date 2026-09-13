import { DAW_CC_MAP } from '../spec/generated.ts';
import type { FeatureControlSpec } from '../spec/types.ts';

export interface FeatureControlDef {
  readonly cc: number;
  readonly name: string;
  /** Survives a power cycle. Marked (*) in the guide. */
  readonly nonVolatile: boolean;
  /** Always enabled in DAW mode. Marked (#) in the guide. */
  readonly alwaysOn: boolean;
}

const SPEC: Readonly<Record<string, FeatureControlSpec>> = DAW_CC_MAP.featureControls;

export const FEATURE_CONTROLS: readonly FeatureControlDef[] = Object.entries(SPEC)
  .map(([cc, spec]) => ({
    cc: Number(cc),
    name: spec.name,
    nonVolatile: spec.flags?.includes('*') === true,
    alwaysOn: spec.flags?.includes('#') === true,
  }))
  .sort((a, b) => a.cc - b.cc);

const byCC = new Map(FEATURE_CONTROLS.map((feature) => [feature.cc, feature]));

export const featureFor = (cc: number): FeatureControlDef | undefined => byCC.get(cc);

/** CC 1Eh (30). Handled as a mode change rather than a stored setting. */
export const MODE_SELECT_CC = 30;

/**
 * Power-on values.
 *
 * The guide documents each control's range but not its default, so only some of
 * these are grounded: encoders are stated to be in absolute mode by default, and
 * touch events are described as something you enable, implying off. The
 * brightness and curve defaults are chosen to be usable rather than
 * discovered - a brightness of 0 would render a black surface in phase 7 and
 * look like a bug. Read the real values off the hardware in phase 8; a single
 * channel-8 query per control is enough.
 */
export const FEATURE_DEFAULTS: Readonly<Record<number, number>> = {
  63: 0, // shift up
  69: 0, // encoder row 1 absolute (guide: absolute is the default)
  70: 0, // fader pickup off
  71: 0, // touch events off (guide describes enabling them)
  72: 0, // encoder row 2 absolute
  73: 0, // encoder row 3 absolute
  100: 0, // global MIDI channel 1
  111: 127, // LED brightness, max
  112: 127, // screen brightness, max
  113: 0, // temporary display timeout, minimum 1 second
  120: 0, // Out2 MIDI thru off
  121: 1, // encoder curve medium
};

export const NON_VOLATILE_CCS: readonly number[] = FEATURE_CONTROLS.filter((f) => f.nonVolatile).map((f) => f.cc);
