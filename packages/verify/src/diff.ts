import { readTrace, type TraceIO, type TraceLine, type TraceNote } from '@lcxl3/core';
import { assumptionFor } from './assumptions.ts';

export interface StepTraffic {
  readonly id: string;
  readonly describe: string;
  readonly assumptions: readonly string[];
  /** What the host sent, in order. Should match by construction. */
  readonly sent: readonly string[];
  /** What the device replied, in order. This is what actually gets compared. */
  readonly received: readonly string[];
}

export interface StepDifference {
  readonly id: string;
  readonly describe: string;
  readonly assumptions: readonly string[];
  readonly expected: readonly string[];
  readonly actual: readonly string[];
  /** A sweep mismatch rather than a device difference. */
  readonly sentDiffers: boolean;
}

export interface DiffReport {
  readonly differences: readonly StepDifference[];
  readonly matched: number;
  readonly missingFromB: readonly string[];
  readonly notes: readonly TraceNote[];
  /** Assumption id to the steps that contradicted it. */
  readonly suspect: ReadonlyMap<string, readonly string[]>;
}

const label = (io: TraceIO): string => `${io.port} ${io.bytes}`;

/** Groups a trace's traffic by the step it happened in. Timestamps are dropped. */
export const groupByStep = (lines: readonly TraceLine[]): Map<string, StepTraffic> => {
  const steps = new Map<string, StepTraffic>();
  let current: { id: string; describe: string; assumptions: readonly string[]; sent: string[]; received: string[] } | undefined;

  const flush = (): void => {
    if (current) steps.set(current.id, { ...current });
  };

  for (const line of lines) {
    if (line.kind === 'step') {
      flush();
      current = { id: line.id, describe: line.describe, assumptions: line.assumptions, sent: [], received: [] };
    } else if (line.kind === 'io' && current) {
      (line.dir === 'toDevice' ? current.sent : current.received).push(label(line));
    }
  }
  flush();
  return steps;
};

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Compares a reference trace (usually the emulator) against an observed one
 * (usually the hardware), step by step.
 *
 * Only what the *device* sent is compared. What the host sent is identical by
 * construction, so a difference there means the two runs used different sweep
 * versions, which is worth saying out loud rather than silently diffing noise.
 */
export const diffTraces = (expected: string, actual: string): DiffReport => {
  const a = groupByStep(readTrace(expected));
  const b = groupByStep(readTrace(actual));

  const differences: StepDifference[] = [];
  const missingFromB: string[] = [];
  const suspect = new Map<string, string[]>();
  let matched = 0;

  for (const [id, left] of a) {
    const right = b.get(id);
    if (!right) {
      missingFromB.push(id);
      continue;
    }
    if (same(left.received, right.received)) {
      matched++;
      continue;
    }
    differences.push({
      id,
      describe: left.describe,
      assumptions: left.assumptions,
      expected: left.received,
      actual: right.received,
      sentDiffers: !same(left.sent, right.sent),
    });
    for (const assumption of left.assumptions) {
      const list = suspect.get(assumption) ?? [];
      list.push(id);
      suspect.set(assumption, list);
    }
  }

  const notes = readTrace(actual).filter((line): line is TraceNote => line.kind === 'note');
  return { differences, matched, missingFromB, notes, suspect };
};

const bullet = (lines: readonly string[]): string =>
  lines.length === 0 ? '      (nothing)' : lines.map((l) => `      ${l}`).join('\n');

export const formatReport = (report: DiffReport): string => {
  const out: string[] = [];

  out.push(`${report.matched} steps matched, ${report.differences.length} differed.`);
  if (report.missingFromB.length > 0) {
    out.push(`Not present in the observed trace: ${report.missingFromB.join(', ')}`);
  }

  if (report.suspect.size > 0) {
    out.push('\nAssumptions contradicted by the hardware:\n');
    for (const [id, steps] of report.suspect) {
      const assumption = assumptionFor(id);
      out.push(`  ${id}  (steps: ${steps.join(', ')})`);
      if (assumption) {
        out.push(`    we assume: ${assumption.claim}`);
        out.push(`    source:    ${assumption.source}`);
        out.push(`    if wrong:  ${assumption.ifWrong}`);
      }
      out.push('');
    }
  }

  if (report.differences.length > 0) {
    out.push('\nStep by step:\n');
    for (const difference of report.differences) {
      out.push(`  ${difference.id} — ${difference.describe}`);
      if (difference.sentDiffers) {
        out.push('    ! the host sent different bytes in the two runs — the sweeps do not match');
      }
      out.push('    emulator sent back:');
      out.push(bullet(difference.expected));
      out.push('    hardware sent back:');
      out.push(bullet(difference.actual));
      out.push('');
    }
  }

  if (report.notes.length > 0) {
    out.push('\nOperator observations:\n');
    for (const note of report.notes) {
      out.push(`  ${note.step}: ${note.question}`);
      out.push(`    > ${note.answer}`);
    }
  }

  if (report.differences.length === 0 && report.suspect.size === 0) {
    out.push('\nNo differences. Every assumption the sweep probes held.');
  }

  return out.join('\n');
};
