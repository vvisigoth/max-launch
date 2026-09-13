import { readFileSync, writeFileSync } from 'node:fs';

/**
 * The six feature controls the guide marks (*) are non-volatile: LED and screen
 * brightness, display timeout, global MIDI channel, DIN thru and encoder curve
 * all survive a power cycle on the hardware. Emulating that means surviving a
 * bridge restart, so they live in a small file beside the config.
 */
export const DEFAULT_STATE_PATH = 'lcxl3.state.json';

export const loadNonVolatile = (path = DEFAULT_STATE_PATH): Record<number, number> => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // A missing or unreadable file is a factory-fresh device, not an error.
    return {};
  }
  if (typeof raw !== 'object' || raw === null) return {};

  const out: Record<number, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const cc = Number(key);
    if (Number.isInteger(cc) && typeof value === 'number' && Number.isInteger(value)) out[cc] = value;
  }
  return out;
};

export const saveNonVolatile = (values: Readonly<Record<number, number>>, path = DEFAULT_STATE_PATH): void => {
  writeFileSync(path, `${JSON.stringify(values, null, 2)}\n`);
};
