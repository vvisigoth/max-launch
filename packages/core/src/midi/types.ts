/**
 * The Launch Control XL 3 exposes four USB endpoints' worth of ports, named
 * from the *device's* point of view. "MIDI In" is the device's input, so it is
 * something the host writes to.
 *
 * Per the Programmer's Reference Guide v1.0 p.5 there are two bidirectional
 * pairs (MIDI, DAW) plus two host-to-device-only DIN passthrough ports. The
 * DIN *input* is not a separate endpoint - it is merged into the USB MIDI Out
 * stream when the active Custom Mode asks for it.
 */
export const PORT_ROLES = ['midiIn', 'midiOut', 'dawIn', 'dawOut', 'dinOut1', 'dinOut2'] as const;

export type PortRole = (typeof PORT_ROLES)[number];

/** Direction relative to the host (Max). */
export type PortDirection = 'toDevice' | 'fromDevice';

export const PORT_DIRECTION: Readonly<Record<PortRole, PortDirection>> = {
  midiIn: 'toDevice',
  midiOut: 'fromDevice',
  dawIn: 'toDevice',
  dawOut: 'fromDevice',
  dinOut1: 'toDevice',
  dinOut2: 'toDevice',
};

/** Raw MIDI bytes, including status. SysEx includes its F0 and F7. */
export type MidiBytes = readonly number[];

export interface TimedMessage {
  /** Milliseconds since the bridge started, monotonic. */
  readonly at: number;
  readonly port: PortRole;
  readonly direction: PortDirection;
  readonly bytes: MidiBytes;
}

export const isSysEx = (bytes: MidiBytes): boolean => bytes[0] === 0xf0;

/** Status nibble and 1-based MIDI channel, or null for System messages. */
export const splitStatus = (status: number): { type: number; channel: number } | null => {
  if (status < 0x80) return null;
  if (status >= 0xf0) return null;
  return { type: status & 0xf0, channel: (status & 0x0f) + 1 };
};
