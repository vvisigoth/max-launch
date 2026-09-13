import type { MidiBytes, PortRole } from '../midi/types.ts';
import type { LedState } from '../surface/colour.ts';
import type { ModeInfo } from './modes.ts';
import type { ScreenView } from './screen.ts';

/**
 * A physical action on the surface. The panel produces these; the device
 * decides what leaves the wire, which is the whole reason state lives here and
 * not in the browser.
 *
 * Faders are physical absolute positions, so they carry a value. Encoders are
 * endless - the guide gives them a relative output mode, an acceleration curve,
 * and has them "pick up" position the host sends, none of which make sense for
 * a potentiometer - so they carry a delta and the device tracks where they are.
 */
export type Gesture =
  | { readonly kind: 'setValue'; readonly controlId: string; readonly value: number }
  | { readonly kind: 'turn'; readonly controlId: string; readonly delta: number }
  | { readonly kind: 'press'; readonly controlId: string }
  | { readonly kind: 'release'; readonly controlId: string }
  /**
   * A hand arriving on and leaving a continuous control. These exist because
   * Shift + move is the device's *preview* gesture - the screen shows the value
   * without changing it - and the channel-15 Touch On/Off pair marks where that
   * gesture starts and stops.
   */
  | { readonly kind: 'grab'; readonly controlId: string }
  | { readonly kind: 'letGo'; readonly controlId: string }
  /** The user working the Mode button. Reported to the host, per guide p.9. */
  | { readonly kind: 'selectMode'; readonly mode: number };

export interface OutgoingMessage {
  readonly port: PortRole;
  readonly bytes: MidiBytes;
}

/**
 * Everything the panel needs to draw the surface. Plain JSON - it crosses a
 * WebSocket.
 */
export interface SurfaceState {
  /**
   * The device powers up in standalone mode and stays there until a host claims
   * it. Nothing on the DAW port moves until this is true, which is faithful and
   * is also the first thing to check when a patch appears to be doing nothing.
   */
  readonly dawMode: boolean;
  /** Which surface is showing. Only a DAW surface reports on the DAW port. */
  readonly mode: ModeInfo;
  /**
   * Where each control physically is. For a fader under pickup this is the cap
   * position, which can differ from the parameter it controls.
   */
  readonly values: Readonly<Record<string, number>>;
  /** The value the host last sent for a fader, which pickup has to be caught. */
  readonly parameters: Readonly<Record<string, number>>;
  /** Faders that have caught their parameter and are live again. */
  readonly pickedUp: Readonly<Record<string, boolean>>;
  /** Shift held, or latched by a double press. */
  readonly shiftActive: boolean;
  readonly shiftLatched: boolean;
  /** The control being previewed with Shift + move, if any. */
  readonly previewing: string | null;
  /** Control id to pressed state. Buttons only. */
  readonly pressed: Readonly<Record<string, boolean>>;
  /**
   * Control id to LED colour, for LEDs the host has actually coloured. An LED
   * with no entry has never been addressed, which is a different thing from one
   * set to palette index 0 - see `paletteLed`.
   */
  readonly leds: Readonly<Record<string, LedState>>;
  /** Feature control CC to its current value. */
  readonly features: Readonly<Record<number, number>>;
  /** What the 128 x 64 screen is showing right now. */
  readonly screen: ScreenView;
}
