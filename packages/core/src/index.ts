export { DAW_CC_MAP, PALETTE } from './spec/generated.ts';
export type { DawCcMapSpec, PaletteSpec, PaletteEntrySpec } from './spec/types.ts';

export { PORT_ROLES, PORT_DIRECTION, isSysEx, splitStatus } from './midi/types.ts';
export type { PortRole, PortDirection, MidiBytes, TimedMessage } from './midi/types.ts';

export { toHex, parseBytes } from './midi/hex.ts';
export { decode } from './midi/decode.ts';
export type { Decoded } from './midi/decode.ts';

export { CONTROLS, CONTROLS_BY_ID, controlForCC, controlForLedIndex } from './surface/controls.ts';
export type { ControlDef, ControlKind } from './surface/controls.ts';

export { paletteHex, paletteLed, rgb7ToHex } from './surface/colour.ts';
export type { LedState } from './surface/colour.ts';

export { Device } from './device/device.ts';
export type { Gesture, OutgoingMessage, SurfaceState } from './device/types.ts';

export { MODES, modeFor, isDawSurface, DEFAULT_MODE, DAW_ENTRY_MODE } from './device/modes.ts';
export type { ModeInfo, ModeKind } from './device/modes.ts';

export { FEATURE_CONTROLS, FEATURE_DEFAULTS, featureFor, MODE_SELECT_CC, NON_VOLATILE_CCS } from './device/features.ts';
export type { FeatureControlDef } from './device/features.ts';

export {
  FADER_PICKUP_CC,
  TOUCH_EVENTS_CC,
  ENCODER_CURVE_CC,
  LED_BRIGHTNESS_CC,
  RELATIVE_TOGGLE_CC,
  RELATIVE_PIVOT,
  ENCODER_CURVE_FACTOR,
  SHIFT_LATCH_WINDOW_MS,
  crosses,
} from './device/behaviours.ts';

export { Screen, STATIONARY_TARGET, TEMPORARY_TARGET, DEFAULT_ARRANGEMENT } from './device/screen.ts';
export type { ScreenView } from './device/screen.ts';

export {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  BITMAP_BYTES,
  unpackBitmap,
  packBitmap,
  bytesToBase64,
  base64ToBytes,
  decodeScreenText,
} from './surface/bitmap.ts';

export type { ServerMessage, ClientMessage, TrafficEntry } from './protocol/wire.ts';

export { TRACE_VERSION, parseTraceLine, readTrace } from './protocol/trace.ts';
export type { TraceLine, TraceHeader, TraceStep, TraceIO, TraceNote } from './protocol/trace.ts';
