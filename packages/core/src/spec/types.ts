/**
 * Shapes for the protocol data extracted from Novation's Launch Control XL 3
 * Programmer's Reference Guide v1.0 (see `spec/` at the repo root).
 *
 * `scripts/gen-spec.mjs` emits `generated.ts` with `satisfies` clauses against
 * these interfaces, so a hand-edit to the JSON that breaks the shape fails the
 * build rather than surfacing as a wrong byte at runtime.
 */

export interface FaderGroupSpec {
  readonly channel: number;
  readonly cc: readonly number[];
}

export interface EncoderRowSpec {
  readonly channel: number;
  readonly ccAbsolute: readonly number[];
  readonly ccRelative: readonly number[];
  readonly relativeToggleCC: number;
}

export interface ButtonGroupSpec {
  readonly channel: number;
  readonly cc: readonly number[];
}

export interface SingleControlSpec {
  readonly channel: number | null;
  readonly cc: number | null;
}

export interface DawChannelsSpec {
  readonly encodersAndFaders: number;
  readonly buttons: number;
  readonly shift: number;
  readonly featureControls: number;
  readonly featureControlQueries: number;
  readonly touch: number;
}

export interface DawControlsSpec {
  readonly faders: FaderGroupSpec;
  readonly encoderRow1: EncoderRowSpec;
  readonly encoderRow2: EncoderRowSpec;
  readonly encoderRow3: EncoderRowSpec;
  readonly buttonRowTop: ButtonGroupSpec;
  readonly buttonRowBottom: ButtonGroupSpec;
  readonly soloArm: SingleControlSpec;
  readonly muteSelect: SingleControlSpec;
  readonly utilitySmallButton: SingleControlSpec;
  readonly trackPrev: SingleControlSpec;
  readonly trackNext: SingleControlSpec;
  readonly pageUp: SingleControlSpec;
  readonly pageDown: SingleControlSpec;
  readonly record: SingleControlSpec;
  readonly play: SingleControlSpec;
  readonly shift: SingleControlSpec;
  readonly mode: SingleControlSpec;
}

export interface FeatureControlSpec {
  readonly name: string;
  readonly flags?: string;
  readonly range?: readonly number[];
  readonly units?: string;
  readonly values?: Readonly<Record<string, string>>;
}

export interface SysExSpec {
  readonly header: readonly number[];
  readonly headerHex: string;
  readonly commands: Readonly<Record<string, string>>;
  readonly noteAliases: Readonly<Record<string, readonly number[]>>;
}

export interface DawCcMapSpec {
  readonly source: string;
  readonly verified: string;
  readonly notes: Readonly<Record<string, string>>;
  readonly channels: DawChannelsSpec;
  readonly controls: DawControlsSpec;
  readonly relativeEncoding: { readonly pivot: number };
  readonly featureControls: Readonly<Record<string, FeatureControlSpec>>;
  readonly sysex: SysExSpec;
  readonly displayTargets: Readonly<Record<string, string>>;
  readonly displayArrangements: Readonly<Record<string, string>>;
}

export interface PaletteEntrySpec {
  readonly index: number;
  readonly hex: string;
  readonly rgb: readonly number[];
}

export type PaletteSpec = readonly PaletteEntrySpec[];
