import { beforeEach, describe, expect, it } from 'vitest';
import { Device, parseBytes, toHex, type OutgoingMessage } from '@lcxl3/core';

const ENABLE_SYSEX = parseBytes('F0 00 20 29 02 15 02 7F F7');
const DISABLE_SYSEX = parseBytes('F0 00 20 29 02 15 02 00 F7');
const ENABLE_NOTE = [0x9f, 0x0c, 0x7f];

const hex = (messages: readonly OutgoingMessage[]): string[] => messages.map((m) => `${m.port} ${toHex(m.bytes)}`);

describe('Device', () => {
  let device: Device;
  beforeEach(() => {
    device = new Device();
  });

  describe('power-on state', () => {
    it('starts in standalone mode, as the hardware does', () => {
      expect(device.state.dawMode).toBe(false);
    });

    it('stays silent in standalone mode, because output would come from a Custom Mode', () => {
      expect(device.apply({ kind: 'setValue', controlId: 'fader1', value: 100 })).toEqual([]);
      expect(device.apply({ kind: 'press', controlId: 'buttonTop1' })).toEqual([]);
    });

    it('still tracks positions while silent, so the panel stays honest', () => {
      device.apply({ kind: 'setValue', controlId: 'fader1', value: 100 });
      expect(device.state.values['fader1']).toBe(100);
    });
  });

  describe('DAW mode switch', () => {
    it('accepts the SysEx form', () => {
      device.receive('dawIn', ENABLE_SYSEX);
      expect(device.state.dawMode).toBe(true);
      device.receive('dawIn', DISABLE_SYSEX);
      expect(device.state.dawMode).toBe(false);
    });

    it('accepts the note alias', () => {
      device.receive('dawIn', ENABLE_NOTE);
      expect(device.state.dawMode).toBe(true);
    });

    it('ignores it on the MIDI port, because the guide scopes it to DAW In', () => {
      device.receive('midiIn', ENABLE_SYSEX);
      expect(device.state.dawMode).toBe(false);
    });
  });

  describe('surface output in DAW mode', () => {
    beforeEach(() => {
      device.receive('dawIn', ENABLE_SYSEX);
    });

    it('reports on the DAW port and nowhere else', () => {
      expect(hex(device.apply({ kind: 'setValue', controlId: 'fader1', value: 127 }))).toEqual(['dawOut BF 05 7F']);
    });

    it('puts encoders and faders on channel 16', () => {
      // Slow curve, so one step of rotation is one unit of value.
      device.receive('dawIn', [0xb6, 121, 0]);
      expect(hex(device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 10 }))).toEqual(['dawOut BF 0D 0A']);
      expect(hex(device.apply({ kind: 'turn', controlId: 'encoderR3C8', delta: 1 }))).toEqual(['dawOut BF 24 01']);
    });

    it('puts buttons on channel 1 with 127 down and 0 up', () => {
      expect(hex(device.apply({ kind: 'press', controlId: 'buttonBottom8' }))).toEqual(['dawOut B0 34 7F']);
      expect(hex(device.apply({ kind: 'release', controlId: 'buttonBottom8' }))).toEqual(['dawOut B0 34 00']);
    });

    it('puts Shift on channel 7, where its feature control lives', () => {
      expect(hex(device.apply({ kind: 'press', controlId: 'shift' }))).toEqual(['dawOut B6 3F 7F']);
    });

    it('accumulates encoder turns and clamps at the ends', () => {
      device.receive('dawIn', [0xb6, 121, 0]); // slow curve
      device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 100 });
      device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: 100 });
      expect(device.state.values['encoderR1C1']).toBe(127);
      device.apply({ kind: 'turn', controlId: 'encoderR1C1', delta: -1000 });
      expect(device.state.values['encoderR1C1']).toBe(0);
    });

    it('does not repeat a value that has not changed', () => {
      device.apply({ kind: 'setValue', controlId: 'fader2', value: 64 });
      expect(device.apply({ kind: 'setValue', controlId: 'fader2', value: 64 })).toEqual([]);
    });

    it('ignores a release with no matching press, and a repeated press', () => {
      expect(device.apply({ kind: 'release', controlId: 'buttonTop1' })).toEqual([]);
      device.apply({ kind: 'press', controlId: 'buttonTop1' });
      expect(device.apply({ kind: 'press', controlId: 'buttonTop1' })).toEqual([]);
    });

    it('goes quiet again when the host releases the device', () => {
      device.receive('dawIn', DISABLE_SYSEX);
      expect(device.apply({ kind: 'setValue', controlId: 'fader1', value: 1 })).toEqual([]);
    });
  });

  describe('misuse', () => {
    it('names the control it could not find', () => {
      expect(() => device.apply({ kind: 'press', controlId: 'nope' })).toThrow(/unknown control: nope/);
    });

    it('refuses to set a continuous value on a button', () => {
      expect(() => device.apply({ kind: 'setValue', controlId: 'buttonTop1', value: 5 })).toThrow(/is a button/);
    });
  });

  it('reset returns it to a freshly power-cycled device', () => {
    device.receive('dawIn', ENABLE_SYSEX);
    device.apply({ kind: 'setValue', controlId: 'fader1', value: 100 });
    device.apply({ kind: 'press', controlId: 'buttonTop1' });

    device.reset();

    expect(device.state.dawMode).toBe(false);
    expect(device.state.values['fader1']).toBe(0);
    expect(device.state.pressed).toEqual({});
  });
});
