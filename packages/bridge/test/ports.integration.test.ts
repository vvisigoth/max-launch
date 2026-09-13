import { Input, Output } from '@julusian/midi';
import { afterEach, describe, expect, it } from 'vitest';
import type { PortRole, TimedMessage } from '@lcxl3/core';
import { listSystemPorts, VirtualPortSet } from '../src/ports.ts';

/**
 * The phase 1 milestone, automated: prove that the virtual endpoints are real
 * CoreMIDI ports another process can open by name, in both directions, with
 * SysEx intact.
 *
 * These names are deliberately not the `LCXL3 1 ...` ones so a running bridge
 * doesn't collide with the test suite.
 */
const NAMES: Record<PortRole, string> = {
  midiIn: 'LCXL3 TEST MIDI In',
  midiOut: 'LCXL3 TEST MIDI Out',
  dawIn: 'LCXL3 TEST DAW In',
  dawOut: 'LCXL3 TEST DAW Out',
  dinOut1: 'LCXL3 TEST To DIN Out',
  dinOut2: 'LCXL3 TEST To DIN Out 2',
};

const settle = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async <T>(predicate: () => T | undefined, timeoutMs = 2000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for MIDI');
    await settle(20);
  }
};

const openSet = (): VirtualPortSet => {
  const ports = new VirtualPortSet(NAMES);
  ports.open();
  return ports;
};

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

describe('virtual CoreMIDI ports', () => {
  it('publishes all six endpoints on the right side of CoreMIDI', async () => {
    const ports = openSet();
    cleanup.push(() => ports.close());
    await settle();

    const { sources, destinations } = listSystemPorts();

    // Device outputs are things a host can read from.
    expect(sources).toContain(NAMES.midiOut);
    expect(sources).toContain(NAMES.dawOut);

    // Device inputs are things a host can write to.
    expect(destinations).toContain(NAMES.midiIn);
    expect(destinations).toContain(NAMES.dawIn);
    expect(destinations).toContain(NAMES.dinOut1);
    expect(destinations).toContain(NAMES.dinOut2);
  });

  it('appears under exactly the requested name, undecorated', async () => {
    const ports = openSet();
    cleanup.push(() => ports.close());
    await settle();

    const { sources, destinations } = listSystemPorts();
    const all = [...sources, ...destinations];

    // A decorated endpoint would contain a name we asked for without being one
    // of them - "Node: LCXL3 TEST DAW Out" and the like. Note that our own
    // "To DIN Out 2" contains "To DIN Out", so the check has to exclude every
    // name we asked for, not just the one that matched. Anything else on the
    // system is none of our business: a real Launch Control XL 3 may well be
    // plugged in, which is the situation this whole project exists for.
    const ours: readonly string[] = Object.values(NAMES);
    const decorated = all.filter((name) => !ours.includes(name) && ours.some((want) => name.includes(want)));
    expect(decorated).toEqual([]);

    for (const want of ours) {
      expect(all.filter((name) => name === want)).toHaveLength(1);
    }
  });

  it('delivers bytes from a device output port to a host reading it by name', async () => {
    const ports = openSet();
    cleanup.push(() => ports.close());
    await settle();

    const host = new Input();
    host.ignoreTypes(false, false, false);
    const received: number[][] = [];
    host.on('message', (_delta, bytes) => received.push([...bytes]));
    host.openPortByName(NAMES.midiOut);
    cleanup.push(() => {
      host.closePort();
      host.destroy();
    });
    await settle();

    ports.send('midiOut', [0xbf, 0x05, 0x7f]);

    await waitFor(() => received.find((m) => m[0] === 0xbf));
    expect(received).toContainEqual([0xbf, 0x05, 0x7f]);
  });

  it('receives bytes a host writes to a device input port', async () => {
    const ports = openSet();
    cleanup.push(() => ports.close());

    const seen: TimedMessage[] = [];
    ports.onMessage((message) => seen.push(message));
    await settle();

    const host = new Output();
    host.openPortByName(NAMES.midiIn);
    cleanup.push(() => {
      host.closePort();
      host.destroy();
    });
    await settle();

    host.sendMessage([0xb0, 0x0d, 0x05]);

    const message = await waitFor(() => seen.find((m) => m.port === 'midiIn'));
    expect(message.bytes).toEqual([0xb0, 0x0d, 0x05]);
    expect(message.direction).toBe('toDevice');
  });

  it('passes SysEx through intact, which rtmidi drops unless asked not to', async () => {
    const ports = openSet();
    cleanup.push(() => ports.close());

    const seen: TimedMessage[] = [];
    ports.onMessage((message) => seen.push(message));
    await settle();

    const host = new Output();
    host.openPortByName(NAMES.dawIn);
    cleanup.push(() => {
      host.closePort();
      host.destroy();
    });
    await settle();

    const sysex = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, 0x02, 0x7f, 0xf7];
    host.sendMessage(sysex);

    const message = await waitFor(() => seen.find((m) => m.bytes[0] === 0xf0));
    expect(message.bytes).toEqual(sysex);
    expect(message.port).toBe('dawIn');
  });

  it('refuses to send on a host-to-device port and says why', () => {
    const ports = openSet();
    cleanup.push(() => ports.close());

    expect(() => ports.send('dawIn', [0x90, 0x40, 0x7f])).toThrow(/host-to-device/);
  });

  it('reports messages it sends as well as ones it receives, so the log shows both sides', async () => {
    const ports = openSet();
    cleanup.push(() => ports.close());

    const seen: TimedMessage[] = [];
    ports.onMessage((message) => seen.push(message));

    ports.send('dawOut', [0xb6, 0x1e, 0x02]);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.direction).toBe('fromDevice');
    expect(seen[0]?.port).toBe('dawOut');
  });
});
