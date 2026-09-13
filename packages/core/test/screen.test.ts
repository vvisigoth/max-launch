import { beforeEach, describe, expect, it } from 'vitest';
import {
  BITMAP_BYTES,
  base64ToBytes,
  Device,
  decodeScreenText,
  packBitmap,
  parseBytes,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  unpackBitmap,
} from '@lcxl3/core';

const CLAIM = parseBytes('F0 00 20 29 02 15 02 7F F7');

const sysex = (...body: number[]): number[] => [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, ...body, 0xf7];
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

describe('bitmap packing', () => {
  it('is 19 bytes per row for 64 rows', () => {
    expect(BITMAP_BYTES).toBe(19 * 64);
  });

  it('puts the most significant bit leftmost', () => {
    const pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
    pixels[0] = 1; // top-left
    const packed = packBitmap(pixels);
    expect(packed[0]).toBe(0b1000000);
  });

  it('round-trips an arbitrary image', () => {
    const pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7) % 5 === 0 ? 1 : 0;
    expect(unpackBitmap(packBitmap(pixels))).toEqual(pixels);
  });

  it('leaves the last five bits of each row unused', () => {
    const pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT).fill(1);
    const packed = packBitmap(pixels);
    // 19 bytes x 7 bits = 133 positions for 128 pixels, so the last byte of a
    // row carries only pixels 126 and 127 - in its two highest bits, leaving
    // the low five unused.
    expect(packed[18]).toBe(0b1100000);
    expect(packed[17]).toBe(0b1111111);
  });
});

describe('screen text', () => {
  it('maps the four control codes the guide reassigns', () => {
    expect(decodeScreenText([0x1b, 0x1c, 0x1d, 0x1e])).toBe('☐■♭♥');
  });

  it('passes printable ASCII through', () => {
    expect(decodeScreenText(ascii('Cutoff 42'))).toBe('Cutoff 42');
  });
});

describe('the display', () => {
  let device: Device;
  beforeEach(() => {
    device = new Device();
    device.receive('dawIn', CLAIM);
  });

  it('is blank until something is put on it', () => {
    expect(device.state.screen.kind).toBe('blank');
  });

  it('holds host text back until it is committed', () => {
    // Hardware, 2026-09-13: configure plus two fields showed nothing; the same
    // followed by `04 35 7F` showed it. The emulator used to display without
    // the commit, which was more permissive than the device.
    device.receive('dawIn', sysex(0x04, 0x35, 0x41));
    device.receive('dawIn', sysex(0x06, 0x35, 0x00, ...ascii('Max')));
    expect(device.state.screen.kind).toBe('blank');

    device.receive('dawIn', sysex(0x04, 0x35, 0x7f));
    expect(device.state.screen.kind).toBe('text');
  });

  it('shows the stationary display once text is set and committed', () => {
    device.receive('dawIn', sysex(0x04, 0x35, 0x41)); // arrangement 1, auto-on-change
    device.receive('dawIn', sysex(0x06, 0x35, 0x00, ...ascii('Max')));
    device.receive('dawIn', sysex(0x06, 0x35, 0x01, ...ascii('ready')));
    device.receive('dawIn', sysex(0x04, 0x35, 0x7f));

    expect(device.state.screen).toMatchObject({
      kind: 'text',
      source: 'stationary',
      arrangement: 1,
      lines: ['Max', 'ready'],
    });
  });

  it('lays arrangement 3 out as a title and eight names', () => {
    device.receive('dawIn', sysex(0x04, 0x35, 0x03));
    device.receive('dawIn', sysex(0x06, 0x35, 0x00, ...ascii('Filters')));
    device.receive('dawIn', sysex(0x06, 0x35, 0x01, ...ascii('Cutoff')));
    device.receive('dawIn', sysex(0x04, 0x35, 0x7f));

    const screen = device.state.screen;
    expect(screen.title).toBe('Filters');
    expect(screen.grid).toBe(true);
    expect(screen.lines).toHaveLength(8);
    expect(screen.lines?.[0]).toBe('Cutoff');
  });

  it('pops a temporary display when a control moves, which is the default', () => {
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 90 });
    expect(device.state.screen).toMatchObject({ kind: 'text', source: 'temporary', arrangement: 4 });
    // With no name set, the guide says the device shows the MIDI entity.
    expect(device.state.screen.lines).toEqual(['Fader 1  CC 5', '90']);
  });

  it('prefers a name the host set over the MIDI entity', () => {
    device.receive('dawIn', sysex(0x06, 0x05, 0x00, ...ascii('Volume')));
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 90 });
    expect(device.state.screen.lines?.[0]).toBe('Volume');
  });

  it('stops popping one when auto-on-change is cleared', () => {
    device.receive('dawIn', sysex(0x04, 0x05, 0x04)); // arrangement 4, both auto bits clear
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 90 });
    expect(device.state.screen.kind).toBe('blank');
  });

  it('takes the temporary display away after the timeout', () => {
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 90 });
    expect(device.state.screen.source).toBe('temporary');

    // CC 113 defaults to 0, which the guide gives as a one-second minimum.
    expect(device.tick(999)).toBe(false);
    expect(device.state.screen.source).toBe('temporary');
    expect(device.tick(1000)).toBe(true);
    expect(device.state.screen.kind).toBe('blank');
  });

  it('honours a longer timeout set through CC 113', () => {
    device.receive('dawIn', [0xb6, 113, 30]); // 3 seconds
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 90 });
    expect(device.tick(2999)).toBe(false);
    expect(device.tick(3000)).toBe(true);
  });

  it('falls back to the stationary display when the temporary one expires', () => {
    device.receive('dawIn', sysex(0x04, 0x35, 0x41));
    device.receive('dawIn', sysex(0x06, 0x35, 0x00, ...ascii('Max')));
    device.receive('dawIn', sysex(0x04, 0x35, 0x7f));
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 90 });
    expect(device.state.screen.source).toBe('temporary');

    device.tick(5000);
    expect(device.state.screen.source).toBe('stationary');
  });

  it('cancels a display when the arrangement is 0', () => {
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 90 });
    device.receive('dawIn', sysex(0x04, 0x05, 0x00));
    expect(device.state.screen.kind).toBe('blank');
  });

  it('raises one on demand with the trigger value', () => {
    device.receive('dawIn', sysex(0x06, 0x36, 0x00, ...ascii('Saved')));
    device.receive('dawIn', sysex(0x04, 0x36, 0x7f));
    expect(device.state.screen).toMatchObject({ source: 'temporary', lines: ['Saved', ''] });
  });
});

describe('bitmaps on the wire', () => {
  let device: Device;
  const image = (): number[] => {
    const pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
    for (let x = 0; x < SCREEN_WIDTH; x++) pixels[x] = 1; // a line along the top
    return packBitmap(pixels);
  };

  beforeEach(() => {
    device = new Device();
    device.receive('dawIn', CLAIM);
  });

  it('does not acknowledge, because hardware does not', () => {
    // Guide p.15 presents the acknowledgement as the clock for fluid animation.
    // Hardware on firmware 1.1 sends nothing, so neither do we — a patch built
    // around a reply that never comes is exactly what this project exists to
    // catch. See scripts/bitmap-probe.mjs.
    expect(device.receive('dawIn', sysex(0x09, 0x20, ...image()))).toEqual([]);
  });

  it('shows it, and round-trips the pixels', () => {
    device.receive('dawIn', sysex(0x09, 0x20, ...image()));
    const screen = device.state.screen;
    expect(screen.kind).toBe('bitmap');

    const pixels = unpackBitmap(base64ToBytes(screen.bitmap!));
    expect(pixels[0]).toBe(1);
    expect(pixels[SCREEN_WIDTH - 1]).toBe(1);
    expect(pixels[SCREEN_WIDTH]).toBe(0);
  });

  it('rejects a frame of the wrong length rather than drawing junk', () => {
    device.receive('dawIn', sysex(0x09, 0x20, ...image().slice(0, 100)));
    expect(device.state.screen.kind).toBe('blank');
  });

  it('rejects an unknown target', () => {
    device.receive('dawIn', sysex(0x09, 0x35, ...image()));
    expect(device.state.screen.kind).toBe('blank');
  });

  it('still parses the trailing 7F the guide prints instead of F7', () => {
    const bytes = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, 0x09, 0x20, ...image(), 0x7f];
    device.receive('dawIn', bytes);
    expect(device.state.screen.kind).toBe('bitmap');
  });

  it('gives way to a normal display coming up over it', () => {
    device.receive('dawIn', sysex(0x09, 0x20, ...image()));
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 90 });
    expect(device.state.screen.kind).toBe('text');
  });
});
