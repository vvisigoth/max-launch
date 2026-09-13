import { beforeEach, describe, expect, it } from 'vitest';
import { Device, MODES, NON_VOLATILE_CCS, parseBytes, toHex, type OutgoingMessage } from '@lcxl3/core';

const CLAIM = parseBytes('F0 00 20 29 02 15 02 7F F7');
const RELEASE = parseBytes('F0 00 20 29 02 15 02 00 F7');
const INQUIRY = parseBytes('F0 7E 7F 06 01 F7');

const hex = (messages: readonly OutgoingMessage[]): string[] => messages.map((m) => `${m.port} ${toHex(m.bytes)}`);

describe('device inquiry', () => {
  it('answers with the Focusrite/Novation identity', () => {
    const device = new Device();
    expect(hex(device.receive('dawIn', INQUIRY))).toEqual([
      'dawOut F0 7E 00 06 02 00 20 29 48 01 00 01 01 01 0B 39 F7',
    ]);
  });

  it('answers before being claimed — it is how a host finds the device', () => {
    const device = new Device();
    expect(device.state.dawMode).toBe(false);
    expect(device.receive('dawIn', INQUIRY)).toHaveLength(1);
  });

  it('answers a broadcast or a specific device id alike', () => {
    const device = new Device();
    expect(device.receive('dawIn', parseBytes('F0 7E 00 06 01 F7'))).toHaveLength(1);
  });

  it('answers on the MIDI port too, naming that interface in the member byte', () => {
    // Hardware, 2026-09-12: both interfaces answer, and the member byte is 01
    // for DAW and 00 for MIDI. Everything else is identical.
    const device = new Device();
    expect(hex(device.receive('midiIn', INQUIRY))).toEqual([
      'midiOut F0 7E 00 06 02 00 20 29 48 01 00 00 01 01 0B 39 F7',
    ]);
  });
});

describe('the DAW claim handshake', () => {
  let device: Device;
  beforeEach(() => {
    device = new Device();
  });

  it('echoes the probe, which is what makes it a probe', () => {
    // Live opens with `02 00` and waits for the device to say the same back.
    expect(hex(device.receive('dawIn', RELEASE))).toEqual(['dawOut F0 00 20 29 02 15 02 00 F7']);
  });

  it('acknowledges the claim and says nothing else', () => {
    // Hardware, 2026-09-12: a claim gets the acknowledgement and no mode
    // report. The emulator used to volunteer one; it does not any more.
    expect(hex(device.receive('dawIn', CLAIM))).toEqual(['dawOut F0 00 20 29 02 15 02 7F F7']);
    expect(device.state.dawMode).toBe(true);
    expect(device.state.mode.label).toBe('DAW Control');
  });

  it('reports the Custom Mode it falls back to when released', () => {
    device.receive('dawIn', CLAIM);
    // CC 1Fh follows CC 1Eh because the device, not the host, caused this.
    expect(hex(device.receive('dawIn', RELEASE))).toEqual([
      'dawOut B6 1E 06',
      'dawOut B6 1F 06',
      'dawOut F0 00 20 29 02 15 02 00 F7',
    ]);
  });

  it('runs the whole sequence a DAW sends on startup', () => {
    const conversation = [RELEASE, INQUIRY, CLAIM].flatMap((bytes) => hex(device.receive('dawIn', bytes)));
    expect(conversation).toEqual([
      'dawOut F0 00 20 29 02 15 02 00 F7',
      'dawOut F0 7E 00 06 02 00 20 29 48 01 00 01 01 01 0B 39 F7',
      'dawOut F0 00 20 29 02 15 02 7F F7',
    ]);
  });

  it('returns to standalone and its custom mode when released', () => {
    device.receive('dawIn', CLAIM);
    device.receive('dawIn', RELEASE);
    expect(device.state.dawMode).toBe(false);
    expect(device.state.mode.kind).toBe('custom');
  });
});

describe('surface modes', () => {
  let device: Device;
  beforeEach(() => {
    device = new Device();
    device.receive('dawIn', CLAIM);
  });

  it('maps every mode value the guide lists', () => {
    expect(MODES).toHaveLength(18);
    expect(MODES.find((m) => m.value === 1)?.label).toBe('DAW Mixer');
    expect(MODES.find((m) => m.slot === 4)?.value).toBe(9);
    expect(MODES.find((m) => m.slot === 5)?.value).toBe(18);
    expect(MODES.find((m) => m.slot === 16)?.value).toBe(29);
    // 15 editable Custom Modes plus a factory Default in slot 16, per the user guide.
    expect(MODES.find((m) => m.slot === 16)?.label).toBe('Default (slot 16)');
    expect(MODES.filter((m) => m.label.startsWith('Custom '))).toHaveLength(15);
  });

  it('reports a mode the host selected, just as it reports one the user picked', () => {
    // Hardware, 2026-09-12: each select produced a report and each query its
    // own reply — twelve messages for six select/query pairs. The device does
    // not distinguish who asked.
    expect(hex(device.receive('dawIn', [0xb6, 0x1e, 0x01]))).toEqual(['dawOut B6 1E 01']);
    expect(device.state.mode.label).toBe('DAW Mixer');
  });

  it('adds CC 31 when the user picked the mode, and not when the host did', () => {
    // Hardware, 2026-09-12: twelve 1Eh and zero 1Fh for host selects; matched
    // 1Eh/1Fh pairs every time the user pressed Mode.
    expect(hex(device.apply({ kind: 'selectMode', mode: 1 }))).toEqual(['dawOut B6 1E 01', 'dawOut B6 1F 01']);
    expect(hex(device.receive('dawIn', [0xb6, 0x1e, 0x02]))).toEqual(['dawOut B6 1E 02']);
  });

  it('answers a query about the current mode on channel 7', () => {
    device.receive('dawIn', [0xb6, 0x1e, 0x01]);
    expect(hex(device.receive('dawIn', [0xb7, 0x1e, 0x00]))).toEqual(['dawOut B6 1E 01']);
  });

  it('goes quiet on the DAW port once a Custom Mode is picked', () => {
    device.apply({ kind: 'selectMode', mode: 6 });
    expect(device.apply({ kind: 'setValue', controlId: 'fader1', value: 100 })).toEqual([]);
  });

  it('resumes on the DAW port when a DAW surface comes back', () => {
    device.apply({ kind: 'selectMode', mode: 6 });
    device.apply({ kind: 'selectMode', mode: 2 });
    expect(hex(device.apply({ kind: 'setValue', controlId: 'fader1', value: 100 }))).toEqual(['dawOut BF 05 64']);
  });

  it('rejects a mode value that is not in the table', () => {
    expect(() => device.apply({ kind: 'selectMode', mode: 3 })).toThrow(/unknown mode value/);
  });
});

describe('feature controls', () => {
  let device: Device;
  beforeEach(() => {
    device = new Device();
  });

  it('stores a set from channel 7', () => {
    device.receive('dawIn', [0xb6, 111, 40]);
    expect(device.state.features[111]).toBe(40);
  });

  it('answers a channel 8 query on channel 7, once the controls are awake', () => {
    device.receive('dawIn', [0x9f, 0x0b, 0x7f]);
    device.receive('dawIn', [0xb6, 112, 90]);
    expect(hex(device.receive('dawIn', [0xb7, 112, 0]))).toEqual(['dawOut B6 70 5A']);
  });

  it('ignores queries in standalone mode until woken, which hardware does too', () => {
    // Hardware ignored all thirteen queries until `9F 0B 7F` had been sent.
    expect(device.receive('dawIn', [0xb7, 112, 0])).toEqual([]);
  });

  it('echoes the wake-up note back', () => {
    expect(hex(device.receive('dawIn', [0x9f, 0x0b, 0x7f]))).toEqual(['dawOut 9F 0B 7F']);
  });

  it('stays silent on sets until a host asks for confirmations', () => {
    expect(device.receive('dawIn', [0xb6, 111, 40])).toEqual([]);
    device.receive('dawIn', [0x9f, 0x0b, 0x7f]);
    expect(hex(device.receive('dawIn', [0xb6, 111, 50]))).toEqual(['dawOut B6 6F 32']);
    device.receive('dawIn', [0x9f, 0x0b, 0x00]);
    expect(device.receive('dawIn', [0xb6, 111, 60])).toEqual([]);
  });

  it('does not confirm sets in DAW mode, per the guide', () => {
    device.receive('dawIn', [0x9f, 0x0b, 0x7f]);
    device.receive('dawIn', CLAIM);
    expect(device.receive('dawIn', [0xb6, 111, 70])).toEqual([]);
    expect(device.state.features[111]).toBe(70);
  });

  it('still answers queries in DAW mode', () => {
    device.receive('dawIn', CLAIM);
    expect(device.receive('dawIn', [0xb7, 111, 0])).toHaveLength(1);
  });

  it('ignores a CC that is not a documented feature control', () => {
    expect(device.receive('dawIn', [0xb6, 5, 100])).toEqual([]);
    expect(device.receive('dawIn', [0xb7, 5, 0])).toEqual([]);
  });

  it('tracks Shift through its feature control as well as the wire', () => {
    device.receive('dawIn', CLAIM);
    expect(hex(device.apply({ kind: 'press', controlId: 'shift' }))).toEqual(['dawOut B6 3F 7F']);
    expect(device.state.features[63]).toBe(127);
    device.apply({ kind: 'release', controlId: 'shift' });
    expect(device.state.features[63]).toBe(0);
  });
});

describe('non-volatile settings', () => {
  it('covers the six the guide marks with an asterisk', () => {
    expect([...NON_VOLATILE_CCS].sort((a, b) => a - b)).toEqual([100, 111, 112, 113, 120, 121]);
  });

  it('survives a power cycle, while volatile ones do not', () => {
    const device = new Device();
    device.receive('dawIn', [0xb6, 111, 40]); // LED brightness, non-volatile
    device.receive('dawIn', [0xb6, 71, 127]); // touch events, volatile

    device.reset();

    expect(device.state.features[111]).toBe(40);
    expect(device.state.features[71]).toBe(0);
  });

  it('round-trips through a snapshot, for a bridge that persists it', () => {
    const device = new Device();
    device.receive('dawIn', [0xb6, 112, 33]);
    const saved = device.nonVolatile;

    const replacement = new Device();
    replacement.restoreNonVolatile(saved);
    expect(replacement.state.features[112]).toBe(33);
  });

  it('ignores junk in a restored snapshot rather than trusting it', () => {
    const device = new Device();
    device.restoreNonVolatile({ 71: 127, 999: 5, 111: 12 });
    expect(device.state.features[71]).toBe(0); // volatile, not restorable
    expect(device.state.features[111]).toBe(12);
  });
});
