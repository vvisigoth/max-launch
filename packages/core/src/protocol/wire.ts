import type { Decoded } from '../midi/decode.ts';
import type { PortRole, TimedMessage } from '../midi/types.ts';
import type { ControlDef } from '../surface/controls.ts';
import type { Gesture, SurfaceState } from '../device/types.ts';
import type { PaletteEntrySpec } from '../spec/types.ts';

/** What the bridge sends the panel. */
export interface TrafficEntry {
  readonly message: TimedMessage;
  readonly decoded: Decoded;
}

export type ServerMessage =
  | {
      readonly type: 'hello';
      readonly controls: readonly ControlDef[];
      readonly palette: readonly PaletteEntrySpec[];
      readonly portNames: Readonly<Record<PortRole, string>>;
      readonly state: SurfaceState;
      /**
       * Traffic from before this client connected. Without it, opening the
       * panel after the bridge has been running shows an empty log, which reads
       * as "nothing is happening" rather than "you just got here".
       */
      readonly recent: readonly TrafficEntry[];
    }
  | { readonly type: 'state'; readonly state: SurfaceState }
  | { readonly type: 'midi'; readonly message: TimedMessage; readonly decoded: Decoded };

/** What the panel sends the bridge. */
export type ClientMessage = { readonly type: 'gesture'; readonly gesture: Gesture };
