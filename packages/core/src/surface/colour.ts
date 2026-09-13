import { PALETTE } from '../spec/generated.ts';

const hex2 = (value: number): string => value.toString(16).toUpperCase().padStart(2, '0');

/** MIDI data bytes are 7-bit, so the RGB SysEx carries 0-127 per channel. */
export const rgb7ToHex = (r: number, g: number, b: number): string => {
  const scale = (v: number): number => Math.round((Math.min(127, Math.max(0, v)) * 255) / 127);
  return `#${hex2(scale(r))}${hex2(scale(g))}${hex2(scale(b))}`;
};

export const paletteHex = (index: number): string | undefined => PALETTE[index]?.hex;

export interface LedState {
  readonly hex: string;
  readonly source: 'palette' | 'rgb';
  /** Present when the colour came from the palette rather than an RGB SysEx. */
  readonly palette?: number;
}

/**
 * Palette index 0 turns an LED **off**, despite the guide's swatch drawing it
 * as the grey #616161. Asked directly whether an LED set to 0 was off or dim
 * grey, hardware gave "off" (2026-09-12), and the palette-spread probe put
 * index 0 at "off or very dim" independently.
 *
 * "Never coloured" and "coloured 0" stay distinct states even so: an LED the
 * host has not addressed has no entry at all, which keeps the panel honest
 * about what the host has actually said.
 */
export const paletteLed = (index: number): LedState | undefined => {
  const hex = index === 0 ? '#000000' : paletteHex(index);
  return hex === undefined ? undefined : { hex, source: 'palette', palette: index };
};
