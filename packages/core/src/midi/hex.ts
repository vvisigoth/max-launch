import type { MidiBytes } from './types.ts';

/** `[0xb0, 0x05, 0x7f]` -> `"B0 05 7F"`. */
export const toHex = (bytes: MidiBytes): string =>
  bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/**
 * Parses the byte notation the Novation docs and MIDI monitors use, so traces
 * can be pasted straight into the CLI. Accepts `B0 05 7F`, `b0,05,7f`,
 * `0xB0 0x05`, and decimal when prefixed with `d`: `d176 d5 d127`.
 */
export const parseBytes = (input: string): number[] => {
  const tokens = input.trim().split(/[\s,]+/).filter(Boolean);
  return tokens.map((token) => {
    const decimal = /^d(\d+)$/i.exec(token);
    const raw = decimal ? Number.parseInt(decimal[1]!, 10) : Number.parseInt(token.replace(/^0x/i, ''), 16);
    if (!Number.isInteger(raw) || raw < 0 || raw > 0xff) {
      throw new Error(`not a byte: ${token}`);
    }
    return raw;
  });
};
