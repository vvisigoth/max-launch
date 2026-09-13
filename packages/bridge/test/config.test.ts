import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultPortNames, loadConfig } from '../src/config.ts';

const writeConfig = (contents: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'lcxl3-')), 'lcxl3.config.json');
  writeFileSync(path, JSON.stringify(contents));
  return path;
};

describe('port names', () => {
  it('matches the strings a real unit presents on macOS', () => {
    const names = defaultPortNames(1);
    expect(names.dawIn).toBe('LCXL3 1 DAW In');
    expect(names.dawOut).toBe('LCXL3 1 DAW Out');
    expect(names.midiIn).toBe('LCXL3 1 MIDI In');
  });

  it('carries the device id, so two units do not collide', () => {
    expect(defaultPortNames(3).dawIn).toBe('LCXL3 3 DAW In');
  });
});

describe('loadConfig', () => {
  it('falls back to defaults when there is no config file', () => {
    expect(loadConfig(join(tmpdir(), 'definitely-not-here.json')).deviceId).toBe(1);
  });

  it('renumbers every port when the device id changes', () => {
    const config = loadConfig(writeConfig({ deviceId: 2 }));
    expect(config.portNames.dawOut).toBe('LCXL3 2 DAW Out');
    expect(config.portNames.dinOut2).toBe('LCXL3 2 To DIN Out 2');
  });

  it('lets a single port name be overridden, which is the escape hatch if Max shows something else', () => {
    const config = loadConfig(writeConfig({ portNames: { dawOut: 'Node: LCXL3 1 DAW Out' } }));
    expect(config.portNames.dawOut).toBe('Node: LCXL3 1 DAW Out');
    expect(config.portNames.dawIn).toBe('LCXL3 1 DAW In');
  });

  it('rejects a device id the hardware could not have', () => {
    expect(() => loadConfig(writeConfig({ deviceId: 9 }))).toThrow(/1-8/);
    expect(() => loadConfig(writeConfig({ deviceId: 0 }))).toThrow(/1-8/);
  });

  it('rejects an empty port name rather than creating an unnameable port', () => {
    expect(() => loadConfig(writeConfig({ portNames: { midiOut: '' } }))).toThrow(/non-empty/);
  });
});
