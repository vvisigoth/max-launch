import { describe, expect, it } from 'vitest';
import { CONTROLS, controlForCC, controlForLedIndex, decode, PALETTE, parseBytes, toHex } from '@lcxl3/core';

describe('hex', () => {
  it('formats bytes as the Novation docs do', () => {
    expect(toHex([0xb0, 0x05, 0x7f])).toBe('B0 05 7F');
  });

  it('parses the notations a MIDI monitor or the guide might produce', () => {
    expect(parseBytes('B0 05 7F')).toEqual([0xb0, 0x05, 0x7f]);
    expect(parseBytes('b0,05,7f')).toEqual([0xb0, 0x05, 0x7f]);
    expect(parseBytes('0xB0 0x05 0x7F')).toEqual([0xb0, 0x05, 0x7f]);
    expect(parseBytes('d176 d5 d127')).toEqual([0xb0, 0x05, 0x7f]);
  });

  it('rejects things that are not bytes', () => {
    expect(() => parseBytes('B0 100')).toThrow(/not a byte/);
    expect(() => parseBytes('nope')).toThrow(/not a byte/);
  });
});

describe('control registry', () => {
  it('covers every control that reaches the wire', () => {
    // 24 encoders + 8 faders + 16 buttons + 10 side controls; Mode is absent
    // because the guide lists it as n/a.
    expect(CONTROLS).toHaveLength(58);
    expect(CONTROLS.find((c) => c.id === 'mode')).toBeUndefined();
  });

  it('places the faders and encoder rows where the guide does', () => {
    expect(CONTROLS.filter((c) => c.kind === 'fader').map((c) => c.cc)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(CONTROLS.filter((c) => c.row === 1 && c.kind === 'encoder').map((c) => c.cc)).toEqual([
      13, 14, 15, 16, 17, 18, 19, 20,
    ]);
  });

  it('resolves absolute and relative encoder CCs to the same control', () => {
    const absolute = controlForCC(16, 13);
    const relative = controlForCC(16, 77);
    expect(absolute?.control.id).toBe('encoderR1C1');
    expect(absolute?.encoderMode).toBe('absolute');
    expect(relative?.control.id).toBe('encoderR1C1');
    expect(relative?.encoderMode).toBe('relative');
  });

  it('does not offer an LED for the faders or Shift', () => {
    expect(controlForLedIndex(5)).toBeUndefined();
    expect(CONTROLS.find((c) => c.id === 'shift')?.hasLed).toBe(false);
    expect(controlForLedIndex(13)?.id).toBe('encoderR1C1');
  });
});

describe('palette', () => {
  it('has all 128 entries in index order', () => {
    expect(PALETTE).toHaveLength(128);
    expect(PALETTE[0]?.hex).toBe('#616161');
    expect(PALETTE[3]?.hex).toBe('#FFFFFF');
    expect(PALETTE[5]?.hex).toBe('#FF6161');
  });
});

describe('decode', () => {
  it('reads surface movement coming out of the device', () => {
    expect(decode([0xbf, 0x05, 0x40], 'fromDevice').summary).toBe('Fader 1 = 64');
    expect(decode([0xb0, 0x25, 0x7f], 'fromDevice').summary).toBe('Button top 1 = 127');
  });

  it('reads relative encoder movement against the pivot', () => {
    expect(decode([0xbf, 0x4d, 0x41], 'fromDevice').summary).toBe('Encoder 1.1: cw 1 (relative)');
    expect(decode([0xbf, 0x4d, 0x3f], 'fromDevice').summary).toBe('Encoder 1.1: ccw 1 (relative)');
  });

  it('separates LED colouring from position feedback by channel', () => {
    expect(decode([0xb0, 0x0d, 0x05], 'toDevice').summary).toBe('LED colour: Encoder 1.1 = 5 #FF6161');
    expect(decode([0xbf, 0x0d, 0x40], 'toDevice').summary).toBe('Position feedback: Encoder 1.1 = 64');
  });

  it('names the surface mode rather than leaving it as a bare number', () => {
    expect(decode([0xb6, 0x1e, 0x01], 'toDevice').summary).toBe('Surface mode select: DAW Mixer');
    expect(decode([0xb6, 0x1e, 0x01], 'fromDevice').summary).toBe('Surface mode report: DAW Mixer');
    expect(decode([0xb6, 0x1e, 0x12], 'fromDevice').summary).toBe('Surface mode report: Custom 5');
    expect(decode([0xb7, 0x1e, 0x00], 'toDevice').summary).toBe('Surface mode query');
  });

  it('names feature controls on channel 7 and queries on channel 8', () => {
    expect(decode([0xb6, 0x6f, 0x40], 'toDevice').summary).toBe('Feature control set: ledBrightness = 64');
    expect(decode([0xb7, 0x6f, 0x00], 'toDevice').summary).toBe('Feature control query: ledBrightness');
  });

  it('reads touch events on channel 15', () => {
    expect(decode([0xbe, 0x05, 0x7f], 'fromDevice').summary).toBe('Touch on: Fader 1');
    expect(decode([0xbe, 0x05, 0x00], 'fromDevice').summary).toBe('Touch off: Fader 1');
  });

  it('recognises the Novation SysEx commands', () => {
    expect(decode(parseBytes('F0 00 20 29 02 15 02 7F F7'), 'toDevice').summary).toBe('SysEx DAW mode: enable');
    expect(decode(parseBytes('F0 00 20 29 02 15 02 00 F7'), 'toDevice').summary).toBe('SysEx DAW mode: disable');
    expect(decode(parseBytes('F0 00 20 29 02 15 01 53 0D 7F 00 00 F7'), 'toDevice').summary).toBe(
      'SysEx RGB colour: Encoder 1.1 = rgb(127, 0, 0)',
    );
    expect(decode(parseBytes('F0 00 20 29 02 15 06 36 01 4C 69 76 65 20 31 32 F7'), 'toDevice').summary).toBe(
      'SysEx display text: target 54, field 1, "Live 12"',
    );
    expect(decode(parseBytes('F0 00 20 29 02 15 09 7F'), 'fromDevice').summary).toBe('SysEx bitmap acknowledgement');
  });

  it('recognises universal device inquiry in both directions', () => {
    expect(decode(parseBytes('F0 7E 7F 06 01 F7'), 'toDevice').summary).toBe('SysEx Universal Device Inquiry request');
    const reply = decode(parseBytes('F0 7E 00 06 02 00 20 29 48 01 00 01 01 01 0B 39 F7'), 'fromDevice');
    expect(reply.summary).toBe('SysEx Universal Device Inquiry reply');
    expect(reply.detail).toContain('manufacturer 00 20 29');
  });

  it('recognises the note aliases for DAW mode and feature controls', () => {
    expect(decode([0x9f, 0x0c, 0x7f], 'toDevice').summary).toBe('Note alias: enableDawMode');
    expect(decode([0x9f, 0x0b, 0x00], 'toDevice').summary).toBe('Note alias: disableFeatureControls');
  });
});
