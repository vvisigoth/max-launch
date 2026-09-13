/**
 * The trace format both the emulator and a hardware capture write.
 *
 * The whole point of phase 8 is running one scripted sweep against the real
 * device and against the emulator and diffing the results, so the two must be
 * the same shape. Traces are aligned by **step**, never by timestamp: two runs
 * on different days will never agree on timing, but they agree on which step
 * they were in.
 */
export const TRACE_VERSION = 2;

export interface TraceHeader {
  readonly kind: 'header';
  readonly version: number;
  /** Which side produced this trace — the whole point of the diff. */
  readonly source: 'emulator' | 'hardware';
  readonly deviceId: number;
  readonly portNames: Readonly<Record<string, string>>;
  readonly startedAt: string;
  readonly note?: string;
}

export interface TraceStep {
  readonly kind: 'step';
  readonly id: string;
  readonly describe: string;
  /** Assumption ids this step is designed to falsify. */
  readonly assumptions: readonly string[];
}

export interface TraceIO {
  readonly kind: 'io';
  /** Milliseconds since the capture opened. Ignored when diffing. */
  readonly at: number;
  readonly port: string;
  readonly dir: string;
  readonly bytes: string;
}

/** An answer to something only a human looking at the device could tell us. */
export interface TraceNote {
  readonly kind: 'note';
  readonly step: string;
  readonly question: string;
  readonly answer: string;
}

export type TraceLine = TraceHeader | TraceStep | TraceIO | TraceNote;

/** Older traces had no `kind` on their event lines. */
export const parseTraceLine = (raw: string): TraceLine | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const line = value as Record<string, unknown>;
  const kind = line['kind'];
  if (kind === 'header' || kind === 'step' || kind === 'io' || kind === 'note') return line as unknown as TraceLine;
  if (typeof line['bytes'] === 'string') return { kind: 'io', ...line } as TraceIO;
  return undefined;
};

export const readTrace = (contents: string): TraceLine[] =>
  contents
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(parseTraceLine)
    .filter((line): line is TraceLine => line !== undefined);
