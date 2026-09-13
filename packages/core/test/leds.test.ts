import { beforeEach, describe, expect, it } from 'vitest';
import { Device, paletteHex, parseBytes, rgb7ToHex } from '@lcxl3/core';

const ENABLE = parseBytes('F0 00 20 29 02 15 02 7F F7');
const DISABLE = parseBytes('F0 00 20 29 02 15 02 00 F7');

describe('rgb7ToHex', () => {
  it('scales 7-bit MIDI data to 8-bit colour', () => {
    expect(rgb7ToHex(127, 127, 127)).toBe('#FFFFFF');
    expect(rgb7ToHex(0, 0, 0)).toBe('#000000');
    expect(rgb7ToHex(127, 0, 0)).toBe('#FF0000');
    // 64/127 is a shade over half, so it rounds up to 0x81 rather than 0x80.
    expect(rgb7ToHex(64, 64, 64)).toBe('#818181');
  });

  it('clamps rather than wrapping when handed out-of-range bytes', () => {
    expect(rgb7ToHex(200, -5, 127)).toBe('#FF00FF');
  });
});

describe('LED colouring', () => {
  let device: Device;
  beforeEach(() => {
    device = new Device();
    device.receive('dawIn', ENABLE);
  });

  it('colours from the palette on channel 1', () => {
    device.receive('dawIn', [0xb0, 0x0d, 5]);
    expect(device.state.leds['encoderR1C1']).toEqual({ hex: '#FF6161', source: 'palette', palette: 5 });
    expect(paletteHex(5)).toBe('#FF6161');
  });

  it('colours a button by the same index it reports on', () => {
    device.receive('dawIn', [0xb0, 0x25, 21]);
    expect(device.state.leds['buttonTop1']?.hex).toBe(paletteHex(21));
  });

  it('colours from the RGB SysEx', () => {
    device.receive('dawIn', parseBytes('F0 00 20 29 02 15 01 53 0D 7F 00 40 F7'));
    expect(device.state.leds['encoderR1C1']).toEqual({ hex: '#FF0081', source: 'rgb' });
  });

  it('leaves an untouched LED with no entry at all, distinct from palette 0', () => {
    expect(device.state.leds['encoderR1C2']).toBeUndefined();
    device.receive('dawIn', [0xb0, 0x0e, 0]);
    // Index 0 turns the LED off, whatever the guide's swatch draws.
    expect(device.state.leds['encoderR1C2']).toEqual({ hex: '#000000', source: 'palette', palette: 0 });
  });

  it('ignores an index that has no LED, such as a fader', () => {
    device.receive('dawIn', [0xb0, 0x05, 5]);
    expect(device.state.leds['fader1']).toBeUndefined();
  });

  it('ignores colouring in standalone mode, since the guide scopes it to DAW mode', () => {
    device.receive('dawIn', DISABLE);
    device.receive('dawIn', [0xb0, 0x0d, 5]);
    expect(device.state.leds['encoderR1C1']).toBeUndefined();
  });

  it('ignores colouring sent to the MIDI port', () => {
    device.receive('midiIn', [0xb0, 0x0d, 5]);
    expect(device.state.leds['encoderR1C1']).toBeUndefined();
  });

  it('keeps the LEDs lit when the host releases the device', () => {
    // Asked directly whether every LED went out on release: "no" (2026-09-12).
    device.receive('dawIn', [0xb0, 0x0d, 5]);
    device.receive('dawIn', DISABLE);
    expect(device.state.leds['encoderR1C1']?.hex).toBe('#FF6161');
  });
});

describe('position feedback', () => {
  let device: Device;
  beforeEach(() => {
    device = new Device();
    device.receive('dawIn', ENABLE);
  });

  it('adopts a position the host sends on channel 16', () => {
    device.receive('dawIn', [0xbf, 0x0d, 100]);
    expect(device.state.values['encoderR1C1']).toBe(100);
  });

  it('does not echo it back, which would loop through a patch that mirrors state', () => {
    expect(device.receive('dawIn', [0xbf, 0x0d, 100])).toEqual([]);
  });

  it('gives a fader a parameter rather than moving it — a fader cannot move itself', () => {
    device.receive('dawIn', [0xbf, 0x05, 64]);
    expect(device.state.parameters['fader1']).toBe(64);
    expect(device.state.values['fader1']).toBe(0);
  });

  it('is ignored in standalone mode', () => {
    device.receive('dawIn', DISABLE);
    device.receive('dawIn', [0xbf, 0x0d, 100]);
    expect(device.state.values['encoderR1C1']).toBe(0);
  });

  it('an encoder adopts it directly, being endless', () => {
    device.receive('dawIn', [0xbf, 0x0d, 77]);
    expect(device.state.values['encoderR1C1']).toBe(77);
  });

  it('does not confuse a channel 1 colour with a channel 16 position', () => {
    device.receive('dawIn', [0xb0, 0x0d, 100]);
    expect(device.state.values['encoderR1C1']).toBe(0);
    expect(device.state.leds['encoderR1C1']?.palette).toBe(100);
  });
});
