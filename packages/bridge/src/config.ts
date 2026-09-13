import { readFileSync } from 'node:fs';
import { PORT_ROLES, type PortRole } from '@lcxl3/core';

export interface BridgeConfig {
  /**
   * Set in the hardware's bootloader, 1-8, and appended to the port names so
   * several units can coexist. Ours defaults to 1; confirm yours if the port
   * names below don't match what Max shows when the device is plugged in.
   */
  readonly deviceId: number;
  readonly portNames: Readonly<Record<PortRole, string>>;
  readonly wsPort: number;
}

/**
 * Port names as the hardware presents them on macOS.
 *
 * Community captures against a real unit name the DAW pair `LCXL3 1 DAW In` and
 * `LCXL3 1 DAW Out`, and the guide (p.5) names the four interfaces "MIDI In/Out",
 * "DAW In/Out", "To DIN Out" and "To DIN Out 2". The MIDI and DIN strings follow
 * that pattern but have not been checked against hardware - they are config
 * precisely so that a mismatch is a one-line fix rather than a rebuild.
 */
export const defaultPortNames = (deviceId: number): Record<PortRole, string> => ({
  midiIn: `LCXL3 ${deviceId} MIDI In`,
  midiOut: `LCXL3 ${deviceId} MIDI Out`,
  dawIn: `LCXL3 ${deviceId} DAW In`,
  dawOut: `LCXL3 ${deviceId} DAW Out`,
  dinOut1: `LCXL3 ${deviceId} To DIN Out`,
  dinOut2: `LCXL3 ${deviceId} To DIN Out 2`,
});

export const DEFAULT_CONFIG: BridgeConfig = {
  deviceId: 1,
  portNames: defaultPortNames(1),
  wsPort: 7373,
};

/**
 * Reads `lcxl3.config.json` from the repo root if present. Any field may be
 * omitted; `portNames` may override individual roles.
 */
export const loadConfig = (path = 'lcxl3.config.json'): BridgeConfig => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_CONFIG;
    throw new Error(`could not read ${path}: ${(error as Error).message}`);
  }

  if (typeof raw !== 'object' || raw === null) throw new Error(`${path} must contain an object`);
  const file = raw as Partial<BridgeConfig> & { portNames?: Partial<Record<PortRole, string>> };

  const deviceId = file.deviceId ?? DEFAULT_CONFIG.deviceId;
  if (!Number.isInteger(deviceId) || deviceId < 1 || deviceId > 8) {
    throw new Error(`deviceId must be an integer 1-8, got ${deviceId}`);
  }

  const names = defaultPortNames(deviceId);
  for (const role of PORT_ROLES) {
    const override = file.portNames?.[role];
    if (override !== undefined) {
      if (typeof override !== 'string' || override.length === 0) {
        throw new Error(`portNames.${role} must be a non-empty string`);
      }
      names[role] = override;
    }
  }

  return { deviceId, portNames: names, wsPort: file.wsPort ?? DEFAULT_CONFIG.wsPort };
};
