import { beforeEach, describe, expect, it } from 'vitest';
import { Device, parseBytes, toHex, type OutgoingMessage } from '@lcxl3/core';

const CLAIM = parseBytes('F0 00 20 29 02 15 02 7F F7');
const hex = (messages: readonly OutgoingMessage[]): string[] => messages.map((m) => toHex(m.bytes));

const claimed = (): Device => {
  const device = new Device();
  device.receive('dawIn', CLAIM);
  device.receive('dawIn', [0xb6, 121, 0]); // slow curve: one step of rotation, one unit
  return device;
};

describe('fader pickup', () => {
  let device: Device;
  beforeEach(() => {
    device = claimed();
    device.receive('dawIn', [0xb6, 70, 127]); // pickup on
    device.receive('dawIn', [0xbf, 0x05, 100]); // host puts fader 1's parameter at 100
  });

  it('starts out of pickup, because the cap is nowhere near the parameter', () => {
    expect(device.state.pickedUp['fader1']).toBeUndefined();
    expect(device.state.parameters['fader1']).toBe(100);
    expect(device.state.values['fader1']).toBe(0);
  });

  it('stays off the wire while the fader is still hunting', () => {
    expect(device.apply({ kind: 'setValue', controlId: 'fader1', value: 40 })).toEqual([]);
    expect(device.apply({ kind: 'setValue', controlId: 'fader1', value: 80 })).toEqual([]);
    expect(device.state.values['fader1']).toBe(80);
  });

  it('shows the value it has to reach while hunting', () => {
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 40 });
    expect(device.state.screen.lines?.[1]).toBe('100');
  });

  it('comes alive the moment it catches the parameter', () => {
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 80 });
    expect(hex(device.apply({ kind: 'setValue', controlId: 'fader1', value: 110 }))).toEqual(['BF 05 6E']);
    expect(device.state.pickedUp['fader1']).toBe(true);
  });

  it('catches a parameter parked at the very top, where nothing can pass it', () => {
    device.receive('dawIn', [0xbf, 0x06, 127]);
    expect(device.apply({ kind: 'setValue', controlId: 'fader2', value: 127 })).toHaveLength(1);
  });

  it('stays live once caught', () => {
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 100 });
    expect(device.apply({ kind: 'setValue', controlId: 'fader1', value: 5 })).toHaveLength(1);
  });

  it('has to be re-earned when the host moves the parameter away', () => {
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 100 });
    device.receive('dawIn', [0xbf, 0x05, 20]);
    expect(device.state.pickedUp['fader1']).toBeUndefined();
    expect(device.apply({ kind: 'setValue', controlId: 'fader1', value: 110 })).toEqual([]);
  });

  it('is already caught if the host sets the parameter where the fader sits', () => {
    device.receive('dawIn', [0xbf, 0x05, 0]);
    expect(device.state.pickedUp['fader1']).toBe(true);
  });

  it('jumps straight away when pickup is off, which is the default', () => {
    const jumpy = claimed();
    jumpy.receive('dawIn', [0xbf, 0x05, 100]);
    expect(jumpy.apply({ kind: 'setValue', controlId: 'fader1', value: 10 })).toHaveLength(1);
  });

  it('does not gate encoders, which are endless and have nothing to catch', () => {
    expect(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 5 })).toHaveLength(1);
  });
});

describe('relative encoders', () => {
  let device: Device;
  beforeEach(() => {
    device = claimed();
  });

  it('reports position until a row is switched over', () => {
    expect(hex(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 3 }))).toEqual(['BF 0D 03']);
  });

  it('reports movement against the pivot once switched', () => {
    device.receive('dawIn', [0xb6, 69, 127]); // row 1 relative
    expect(hex(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 1 }))).toEqual(['BF 4D 41']);
    expect(hex(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: -1 }))).toEqual(['BF 4D 3F']);
    expect(hex(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 5 }))).toEqual(['BF 4D 45']);
  });

  it('switches one row at a time', () => {
    device.receive('dawIn', [0xb6, 72, 127]); // row 2 only
    expect(hex(device.apply({ kind: 'turn', controlId: 'encoderR2C1', delta: 1 }))).toEqual(['BF 55 41']);
    expect(hex(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 1 }))).toEqual(['BF 0D 01']);
  });

  it('keeps reporting at the ends of the range, having no ends to hit', () => {
    device.receive('dawIn', [0xb6, 69, 127]);
    device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 127 });
    expect(device.state.values['encoderR1C1']).toBe(127);
    // An absolute encoder would go silent here; an endless one does not.
    expect(hex(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 4 }))).toEqual(['BF 4D 44']);
  });

  it('switches back', () => {
    device.receive('dawIn', [0xb6, 69, 127]);
    device.receive('dawIn', [0xb6, 69, 0]);
    expect(hex(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 1 }))).toEqual(['BF 0D 01']);
  });
});

describe('encoder curve', () => {
  it('scales rotation into value', () => {
    const device = claimed();
    for (const [curve, expected] of [
      [0, 10],
      [1, 20],
      [2, 40],
    ] as const) {
      device.receive('dawIn', [0xb6, 121, curve]);
      device.receive('dawIn', [0xbf, 0x0d, 0]); // park the encoder
      device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 10 });
      expect(device.state.values['encoderR1C1']).toBe(expected);
    }
  });
});

describe('Shift and the preview gesture', () => {
  let device: Device;
  beforeEach(() => {
    device = claimed();
    device.receive('dawIn', [0xb6, 71, 127]); // touch events on
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 60 });
  });

  it('moves the control normally with Shift up', () => {
    device.apply({ kind: 'grab', controlId: 'fader1' });
    expect(hex(device.apply({ kind: 'setValue', controlId: 'fader1', value: 90 }))).toEqual(['BF 05 5A']);
  });

  it('still moves a FADER under Shift — the cap has physically moved', () => {
    // Hardware, 2026-09-12: Shift held from start to finish and fader 3 still
    // transmitted its whole sweep. A fader cannot be moved without changing;
    // only an endless encoder can.
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'grab', controlId: 'fader1' });

    expect(hex(device.apply({ kind: 'setValue', controlId: 'fader1', value: 90 }))).toEqual(['BF 05 5A']);
    expect(device.state.values['fader1']).toBe(90);
  });

  it('brackets any handling with Touch On and Touch Off, Shift or no Shift', () => {
    // Hardware sent `BE 08 7F` for a plain fader move with Shift nowhere near.
    expect(hex(device.apply({ kind: 'grab', controlId: 'fader1' }))).toEqual(['BE 05 7F']);
    expect(hex(device.apply({ kind: 'letGo', controlId: 'fader1' }))).toEqual(['BE 05 00']);
  });

  it('sends no touch events when CC 71 is off', () => {
    const quiet = claimed();
    expect(quiet.apply({ kind: 'grab', controlId: 'fader1' })).toEqual([]);
  });

  it('reports touch on the relative CC while a row is switched over', () => {
    device.receive('dawIn', [0xb6, 69, 127]);
    expect(hex(device.apply({ kind: 'grab', controlId: 'encoderR1C1' }))).toEqual(['BE 4D 7F']);
  });

  it('previews an encoder without turning it', () => {
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'grab', controlId: 'encoderR1C1' });
    expect(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 20 })).toEqual([]);
    expect(device.state.values['encoderR1C1']).toBe(0);
  });

  it('goes back to turning things once Shift is released', () => {
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'grab', controlId: 'encoderR1C1' });
    device.apply({ kind: 'letGo', controlId: 'encoderR1C1' });
    device.apply({ kind: 'release', controlId: 'shift' });

    device.apply({ kind: 'grab', controlId: 'encoderR1C1' });
    expect(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 5 })).toHaveLength(1);
  });
});

describe('Shift latch', () => {
  it('latches on a double press and stays on when released', () => {
    const device = claimed();
    device.tick(0);
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'release', controlId: 'shift' });
    device.tick(200);
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'release', controlId: 'shift' });

    expect(device.state.shiftLatched).toBe(true);
    expect(device.state.shiftActive).toBe(true);
  });

  it('does not latch on two presses far apart', () => {
    const device = claimed();
    device.tick(0);
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'release', controlId: 'shift' });
    device.tick(5000);
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'release', controlId: 'shift' });

    expect(device.state.shiftLatched).toBe(false);
    expect(device.state.shiftActive).toBe(false);
  });

  it('lets go on the next press', () => {
    const device = claimed();
    device.tick(0);
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'release', controlId: 'shift' });
    device.tick(200);
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'release', controlId: 'shift' });
    expect(device.state.shiftLatched).toBe(true);

    device.tick(3000);
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'release', controlId: 'shift' });
    expect(device.state.shiftLatched).toBe(false);
  });

  it('previews an encoder while latched, with no finger on Shift', () => {
    const device = claimed();
    device.receive('dawIn', [0xb6, 71, 127]);
    device.tick(0);
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'release', controlId: 'shift' });
    device.tick(200);
    device.apply({ kind: 'press', controlId: 'shift' });
    device.apply({ kind: 'release', controlId: 'shift' });

    device.apply({ kind: 'grab', controlId: 'encoderR1C1' });
    expect(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 9 })).toEqual([]);
    expect(device.state.values['encoderR1C1']).toBe(0);
  });
});
