import { DAW_CC_MAP, PALETTE } from '../spec/generated.ts';
import type { FeatureControlSpec } from '../spec/types.ts';
import { modeFor } from '../device/modes.ts';
import { MODE_SELECT_CC } from '../device/features.ts';
import { controlForCC, controlForLedIndex } from '../surface/controls.ts';
import { toHex } from './hex.ts';
import { splitStatus, type MidiBytes, type PortDirection } from './types.ts';

export interface Decoded {
  /** One line, suitable for the traffic log. */
  readonly summary: string;
  /** Optional second line with byte-level detail. */
  readonly detail?: string;
}

const NOVATION_HEADER = DAW_CC_MAP.sysex.header;

const NOVATION_COMMANDS: Readonly<Record<number, string>> = {
  0x01: 'RGB colour',
  0x02: 'DAW mode',
  0x04: 'configure display',
  0x05: 'custom mode',
  0x06: 'set display text',
  0x09: 'bitmap',
};

const startsWith = (bytes: MidiBytes, prefix: readonly number[]): boolean =>
  prefix.every((b, i) => bytes[i] === b);

const ascii = (bytes: MidiBytes): string =>
  bytes.map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');

const paletteName = (index: number): string => {
  const entry = PALETTE[index];
  return entry ? `${index} ${entry.hex}` : `${index} (out of range)`;
};

// `as const satisfies` gives the generated map literal types with no index
// signature, so widen once here rather than casting at every lookup.
const FEATURE_CONTROLS: Readonly<Record<string, FeatureControlSpec>> = DAW_CC_MAP.featureControls;

const featureControl = (cc: number): string | undefined => FEATURE_CONTROLS[String(cc)]?.name;

const decodeNovationSysEx = (bytes: MidiBytes): Decoded => {
  const cmd = bytes[NOVATION_HEADER.length];
  const payload = bytes.slice(NOVATION_HEADER.length + 1, -1);
  const name = cmd === undefined ? 'truncated' : (NOVATION_COMMANDS[cmd] ?? `unknown command 0x${cmd.toString(16)}`);

  if (cmd === 0x02) {
    const state = payload[0] === 0x7f ? 'enable' : payload[0] === 0x00 ? 'disable' : `0x${payload[0]?.toString(16)}`;
    return { summary: `SysEx DAW mode: ${state}` };
  }
  if (cmd === 0x01 && payload[0] === 0x53) {
    const [, index, r, g, b] = payload;
    const control = index === undefined ? undefined : controlForLedIndex(index);
    return {
      summary: `SysEx RGB colour: ${control?.label ?? `index ${index}`} = rgb(${r}, ${g}, ${b})`,
      detail: '7-bit RGB, 0-127 per channel',
    };
  }
  if (cmd === 0x06) {
    const [target, field, ...text] = payload;
    return {
      summary: `SysEx display text: target ${target}, field ${field}, "${ascii(text)}"`,
    };
  }
  if (cmd === 0x04) {
    const [target, config] = payload;
    return { summary: `SysEx configure display: target ${target}, config 0x${config?.toString(16) ?? '??'}` };
  }
  if (cmd === 0x09) {
    return payload.length <= 2
      ? { summary: 'SysEx bitmap acknowledgement' }
      : {
          summary: `SysEx bitmap: target ${payload[0]}, ${payload.length - 1} bytes`,
          detail: 'hardware on firmware 1.1 neither displays nor acknowledges this',
        };
  }
  return { summary: `SysEx Novation: ${name}`, detail: `${payload.length} payload bytes` };
};

const decodeSysEx = (bytes: MidiBytes): Decoded => {
  if (startsWith(bytes, NOVATION_HEADER)) return decodeNovationSysEx(bytes);

  // Universal non-realtime: F0 7E <device> 06 <sub> ...
  if (bytes[1] === 0x7e && bytes[3] === 0x06) {
    if (bytes[4] === 0x01) return { summary: 'SysEx Universal Device Inquiry request' };
    if (bytes[4] === 0x02) {
      const manufacturer = toHex(bytes.slice(5, 8));
      const family = toHex(bytes.slice(8, 10));
      const firmware = toHex(bytes.slice(12, 16));
      return {
        summary: 'SysEx Universal Device Inquiry reply',
        detail: `manufacturer ${manufacturer}, family ${family}, firmware ${firmware}`,
      };
    }
  }
  return { summary: `SysEx (${bytes.length} bytes)` };
};

/**
 * Which meaning a host-to-device CC carries.
 *
 * The guide documents LED colouring as `B0h <index> <colour>` - channel 1
 * specifically - while encoders and faders live on channel 16, and separately
 * says encoders "pick up" position information the DAW sends. Reading the
 * channel is what separates the two, since both use the same control index.
 * This is an inference from the guide rather than something it states outright;
 * it is on the phase 8 list to confirm against hardware.
 */
const describeMode = (value: number): string => modeFor(value)?.label ?? `unknown mode value ${value}`;

const decodeToDeviceCC = (channel: number, cc: number, value: number): Decoded => {
  if (channel === DAW_CC_MAP.channels.featureControls && cc === MODE_SELECT_CC) {
    return { summary: `Surface mode select: ${describeMode(value)}` };
  }
  if (channel === DAW_CC_MAP.channels.featureControlQueries && cc === MODE_SELECT_CC) {
    return { summary: 'Surface mode query' };
  }
  if (channel === DAW_CC_MAP.channels.featureControls) {
    const name = featureControl(cc);
    return {
      summary: `Feature control set: ${name ?? `CC ${cc}`} = ${value}`,
      ...(name ? {} : { detail: 'not a documented feature control' }),
    };
  }
  if (channel === DAW_CC_MAP.channels.featureControlQueries) {
    return { summary: `Feature control query: ${featureControl(cc) ?? `CC ${cc}`}` };
  }
  if (channel === DAW_CC_MAP.channels.buttons) {
    const control = controlForLedIndex(cc);
    return control
      ? { summary: `LED colour: ${control.label} = ${paletteName(value)}` }
      : { summary: `CC ${cc} = ${value} on channel 1 (no LED at this index)` };
  }
  if (channel === DAW_CC_MAP.channels.encodersAndFaders) {
    const hit = controlForCC(channel, cc);
    return hit
      ? { summary: `Position feedback: ${hit.control.label} = ${value}` }
      : { summary: `CC ${cc} = ${value} on channel 16` };
  }
  return { summary: `CC ${cc} = ${value} on channel ${channel}` };
};

const decodeFromDeviceCC = (channel: number, cc: number, value: number): Decoded => {
  if (channel === DAW_CC_MAP.channels.featureControls && cc === MODE_SELECT_CC) {
    return { summary: `Surface mode report: ${describeMode(value)}` };
  }
  if (channel === DAW_CC_MAP.channels.touch) {
    const hit = controlForCC(DAW_CC_MAP.channels.encodersAndFaders, cc);
    return { summary: `Touch ${value >= 0x40 ? 'on' : 'off'}: ${hit?.control.label ?? `index ${cc}`}` };
  }
  if (channel === DAW_CC_MAP.channels.featureControls && cc !== DAW_CC_MAP.controls.shift.cc) {
    return { summary: `Feature control reply: ${featureControl(cc) ?? `CC ${cc}`} = ${value}` };
  }
  const hit = controlForCC(channel, cc);
  if (!hit) return { summary: `CC ${cc} = ${value} on channel ${channel}` };
  if (hit.encoderMode === 'relative') {
    const pivot = DAW_CC_MAP.relativeEncoding.pivot;
    const delta = value - pivot;
    const direction = delta > 0 ? 'cw' : delta < 0 ? 'ccw' : 'still';
    return { summary: `${hit.control.label}: ${direction} ${Math.abs(delta)} (relative)` };
  }
  return { summary: `${hit.control.label} = ${value}` };
};

const NOTE_ALIASES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(DAW_CC_MAP.sysex.noteAliases).map(([name, bytes]) => [toHex(bytes), name]),
);

/** Turns raw bytes into something worth reading in the traffic log. */
export const decode = (bytes: MidiBytes, direction: PortDirection): Decoded => {
  if (bytes.length === 0) return { summary: 'empty message' };
  if (bytes[0] === 0xf0) return decodeSysEx(bytes);

  const alias = NOTE_ALIASES[toHex(bytes)];
  if (alias) return { summary: `Note alias: ${alias}` };

  const status = splitStatus(bytes[0]!);
  if (!status) {
    const realtime: Readonly<Record<number, string>> = {
      0xf8: 'clock',
      0xfa: 'start',
      0xfb: 'continue',
      0xfc: 'stop',
      0xfe: 'active sensing',
      0xff: 'reset',
    };
    return { summary: `System: ${realtime[bytes[0]!] ?? toHex(bytes)}` };
  }

  const { type, channel } = status;
  const d1 = bytes[1] ?? 0;
  const d2 = bytes[2] ?? 0;

  switch (type) {
    case 0x80:
      return { summary: `Note off ${d1} velocity ${d2} on channel ${channel}` };
    case 0x90:
      return { summary: `Note ${d2 === 0 ? 'off' : 'on'} ${d1} velocity ${d2} on channel ${channel}` };
    case 0xb0:
      return direction === 'toDevice' ? decodeToDeviceCC(channel, d1, d2) : decodeFromDeviceCC(channel, d1, d2);
    case 0xc0:
      return { summary: `Program change ${d1} on channel ${channel}` };
    case 0xe0:
      return { summary: `Pitch bend ${(d2 << 7) | d1} on channel ${channel}` };
    default:
      return { summary: `Channel message ${toHex(bytes)}` };
  }
};
