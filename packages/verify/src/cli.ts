import { readFileSync } from 'node:fs';
import { ASSUMPTIONS } from './assumptions.ts';
import { diffTraces, formatReport } from './diff.ts';
import { SweepRunner, type Target } from './runner.ts';
import { SWEEP } from './sweep.ts';

const USAGE = `lcxl3 verify — probe the emulator's assumptions against real hardware

  npm run verify -- run --target emulator --out traces/emulator.jsonl
  npm run verify -- run --target hardware --out traces/hardware.jsonl
  npm run verify -- diff traces/emulator.jsonl traces/hardware.jsonl
  npm run verify -- assumptions
  npm run verify -- steps

Options for run:
  --device-id <n>     default 1; sets the port names
  --bridge <url>      default ws://localhost:7373 (emulator target only)
  --only <a,b,c>      run just these steps
  --note <text>       recorded in the trace header
  --settle <ms>       minimum wait per step; raise it for slow hardware

Against hardware, stop the bridge first — it publishes the same port names.
`;

const valueOf = (argv: readonly string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

const run = async (argv: readonly string[]): Promise<void> => {
  const target = (valueOf(argv, '--target') ?? 'emulator') as Target;
  if (target !== 'emulator' && target !== 'hardware') throw new Error('--target must be emulator or hardware');

  const out = valueOf(argv, '--out');
  if (out === undefined) throw new Error('--out <file> is required');

  const deviceId = Number(valueOf(argv, '--device-id') ?? '1');
  const only = valueOf(argv, '--only')?.split(',').map((s) => s.trim());
  const note = valueOf(argv, '--note');
  const bridgeUrl = valueOf(argv, '--bridge');
  const settle = valueOf(argv, '--settle');

  const runner = new SweepRunner({
    target,
    out,
    deviceId,
    portNames: {
      dawIn: `LCXL3 ${deviceId} DAW In`,
      dawOut: `LCXL3 ${deviceId} DAW Out`,
      midiIn: `LCXL3 ${deviceId} MIDI In`,
      midiOut: `LCXL3 ${deviceId} MIDI Out`,
    },
    ...(bridgeUrl === undefined ? {} : { bridgeUrl }),
    ...(note === undefined ? {} : { note }),
    ...(only === undefined ? {} : { only }),
    ...(settle === undefined ? {} : { settleFloorMs: Number(settle) }),
  });

  console.log(`Running ${only ? only.length : SWEEP.length} steps against the ${target}.`);
  await runner.run();
  console.log(`\nWrote ${out}`);
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  switch (argv[0]) {
    case 'run':
      await run(argv);
      return;
    case 'diff': {
      const [, a, b] = argv;
      if (a === undefined || b === undefined) throw new Error('diff needs two trace files');
      console.log(formatReport(diffTraces(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'))));
      return;
    }
    case 'assumptions':
      for (const assumption of ASSUMPTIONS) {
        console.log(`\n${assumption.id}`);
        console.log(`  claim:    ${assumption.claim}`);
        console.log(`  source:   ${assumption.source}`);
        console.log(`  if wrong: ${assumption.ifWrong}`);
      }
      console.log(`\n${ASSUMPTIONS.length} assumptions.`);
      return;
    case 'steps':
      for (const step of SWEEP) {
        const manual = step.actions.some((a) => a.kind !== 'send') ? '  [needs a human on hardware]' : '';
        console.log(`${step.id.padEnd(24)} ${step.describe}${manual}`);
        if (step.assumptions.length > 0) console.log(`${' '.repeat(24)} probes: ${step.assumptions.join(', ')}`);
      }
      console.log(`\n${SWEEP.length} steps.`);
      return;
    default:
      console.log(USAGE);
      process.exitCode = argv[0] === undefined || argv[0] === 'help' ? 0 : 1;
  }
};

await main();
