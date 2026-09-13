import { describe, expect, it } from 'vitest';
import { ASSUMPTIONS } from '../src/assumptions.ts';
import { diffTraces, groupByStep } from '../src/diff.ts';
import { SWEEP } from '../src/sweep.ts';
import { readTrace } from '@lcxl3/core';

const trace = (...lines: unknown[]): string => lines.map((l) => JSON.stringify(l)).join('\n');

const header = { kind: 'header', version: 2, source: 'emulator', deviceId: 1, portNames: {}, startedAt: 'now' };
const step = (id: string, assumptions: string[] = []) => ({ kind: 'step', id, describe: id, assumptions });
const io = (dir: string, bytes: string, at = 0) => ({ kind: 'io', at, port: 'dawOut', dir, bytes });

describe('the sweep and the assumption register', () => {
  it('gives every step a unique id', () => {
    const ids = SWEEP.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every assumption a unique id', () => {
    const ids = ASSUMPTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only references assumptions that exist — a typo here would silently lose a probe', () => {
    const known = new Set(ASSUMPTIONS.map((a) => a.id));
    for (const step of SWEEP) {
      for (const id of step.assumptions) {
        expect(known, `step ${step.id} references unknown assumption ${id}`).toContain(id);
      }
    }
  });

  it('probes every assumption at least once, so none is merely documented', () => {
    const probed = new Set(SWEEP.flatMap((s) => s.assumptions));
    const unprobed = ASSUMPTIONS.map((a) => a.id).filter((id) => !probed.has(id));
    expect(unprobed).toEqual([]);
  });

  it('gives every manual step gestures the emulator can perform', () => {
    for (const step of SWEEP) {
      for (const action of step.actions) {
        if (action.kind === 'manual') {
          expect(action.gestures.length, `${step.id} has an empty manual step`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('grouping', () => {
  it('splits traffic by step and drops timestamps', () => {
    const grouped = groupByStep(
      readTrace(trace(header, step('one'), io('toDevice', 'F0 01 F7', 12), io('fromDevice', 'B6 1E 02', 34), step('two'))),
    );
    expect(grouped.get('one')?.sent).toEqual(['dawOut F0 01 F7']);
    expect(grouped.get('one')?.received).toEqual(['dawOut B6 1E 02']);
    expect(grouped.get('two')?.received).toEqual([]);
  });
});

describe('diffing two traces', () => {
  it('reports nothing when a trace is compared with itself', () => {
    const one = trace(header, step('claim', ['daw-entry-mode']), io('toDevice', 'F0 02 7F F7'), io('fromDevice', 'B6 1E 02'));
    const report = diffTraces(one, one);
    expect(report.differences).toEqual([]);
    expect(report.suspect.size).toBe(0);
    expect(report.matched).toBe(1);
  });

  it('ignores timing, which never matches between two runs', () => {
    const a = trace(header, step('claim'), io('fromDevice', 'B6 1E 02', 10));
    const b = trace(header, step('claim'), io('fromDevice', 'B6 1E 02', 9999));
    expect(diffTraces(a, b).differences).toEqual([]);
  });

  it('names the assumption when the device disagrees', () => {
    const emulator = trace(header, step('claim', ['daw-entry-mode']), io('fromDevice', 'B6 1E 02'));
    const hardware = trace(header, step('claim', ['daw-entry-mode']), io('fromDevice', 'B6 1E 01'));

    const report = diffTraces(emulator, hardware);
    expect(report.differences).toHaveLength(1);
    expect(report.suspect.get('daw-entry-mode')).toEqual(['claim']);
    expect(report.differences[0]?.expected).toEqual(['dawOut B6 1E 02']);
    expect(report.differences[0]?.actual).toEqual(['dawOut B6 1E 01']);
  });

  it('catches a reply the hardware simply does not send', () => {
    const emulator = trace(header, step('claim', ['daw-entry-reports']), io('fromDevice', 'B6 1E 02'));
    const hardware = trace(header, step('claim', ['daw-entry-reports']));
    expect(diffTraces(emulator, hardware).suspect.has('daw-entry-reports')).toBe(true);
  });

  it('flags when the two runs used different sweeps, rather than blaming the device', () => {
    const emulator = trace(header, step('claim'), io('toDevice', 'F0 02 7F F7'), io('fromDevice', 'B6 1E 02'));
    const hardware = trace(header, step('claim'), io('toDevice', 'F0 02 00 F7'), io('fromDevice', 'B6 1E 01'));
    expect(diffTraces(emulator, hardware).differences[0]?.sentDiffers).toBe(true);
  });

  it('reports a step the hardware run never reached', () => {
    const emulator = trace(header, step('claim'), step('release'));
    const hardware = trace(header, step('claim'));
    expect(diffTraces(emulator, hardware).missingFromB).toEqual(['release']);
  });

  it('carries the operator observations through', () => {
    const emulator = trace(header, step('palette-zero', ['palette-zero']));
    const hardware = trace(
      header,
      step('palette-zero', ['palette-zero']),
      { kind: 'note', step: 'palette-zero', question: 'Is it off or grey?', answer: 'fully off' },
    );
    expect(diffTraces(emulator, hardware).notes[0]?.answer).toBe('fully off');
  });
});
