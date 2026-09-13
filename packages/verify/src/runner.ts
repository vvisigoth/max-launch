import { createWriteStream, type WriteStream } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Input, Output } from '@julusian/midi';
import { toHex, TRACE_VERSION, type Gesture, type TraceHeader, type TraceIO, type TraceNote, type TraceStep } from '@lcxl3/core';
import { SWEEP, type SweepStep } from './sweep.ts';

export type Target = 'emulator' | 'hardware';

export interface RunOptions {
  readonly target: Target;
  readonly out: string;
  readonly portNames: { readonly dawIn: string; readonly dawOut: string; readonly midiIn: string; readonly midiOut: string };
  readonly deviceId: number;
  /** WebSocket to the running bridge, used to perform manual steps on the emulator. */
  readonly bridgeUrl?: string;
  readonly note?: string;
  readonly only?: readonly string[];
  /**
   * Minimum wait after each step. Real hardware answers more slowly than the
   * emulator, and a reply that lands after the step boundary looks like a
   * difference in two steps at once - the step that should have had it, and the
   * one that did.
   */
  readonly settleFloorMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives the sweep against whichever side is listening and records what comes
 * back.
 *
 * Manual steps are the reason this is not just a script: a human performs them
 * on hardware, while the emulator performs the equivalent gestures over the
 * bridge's WebSocket. Same sweep, same trace shape, both sides.
 */
export class SweepRunner {
  readonly #options: RunOptions;
  readonly #stream: WriteStream;
  readonly #outputs = new Map<'dawIn' | 'midiIn', Output>();
  readonly #inputs: Input[] = [];
  readonly #startedAt = performance.now();
  #socket: WebSocket | undefined;

  constructor(options: RunOptions) {
    this.#options = options;
    this.#stream = createWriteStream(options.out);
  }

  async run(): Promise<void> {
    this.#openPorts();
    if (this.#options.target === 'emulator') await this.#openBridge();

    const header: TraceHeader = {
      kind: 'header',
      version: TRACE_VERSION,
      source: this.#options.target,
      deviceId: this.#options.deviceId,
      portNames: this.#options.portNames,
      startedAt: new Date().toISOString(),
      ...(this.#options.note === undefined ? {} : { note: this.#options.note }),
    };
    this.#write(header);

    const steps = this.#options.only
      ? SWEEP.filter((step) => this.#options.only?.includes(step.id))
      : SWEEP;

    for (const step of steps) await this.#runStep(step);

    await this.#close();
  }

  async #runStep(step: SweepStep): Promise<void> {
    const line: TraceStep = { kind: 'step', id: step.id, describe: step.describe, assumptions: step.assumptions };
    this.#write(line);
    process.stdout.write(`\n  ${step.id} — ${step.describe}\n`);

    for (const action of step.actions) {
      switch (action.kind) {
        case 'send':
          this.#send(action.port, action.bytes);
          await sleep(30);
          break;
        case 'manual':
          await this.#manual(step, action.instruct, action.gestures);
          break;
        case 'observe':
          await this.#observe(step, action.question);
          break;
      }
    }
    await sleep(Math.max(step.settleMs ?? 250, this.#options.settleFloorMs ?? 0));
  }

  async #manual(step: SweepStep, instruct: string, gestures: readonly Gesture[]): Promise<void> {
    if (this.#options.target === 'emulator') {
      for (const gesture of gestures) {
        this.#socket?.send(JSON.stringify({ type: 'gesture', gesture }));
        await sleep(25);
      }
      return;
    }
    await this.#ask(`    ${instruct}\n    Press Enter when done: `);
    void step;
  }

  async #observe(step: SweepStep, question: string): Promise<void> {
    // The emulator's answer is whatever we already implemented, so asking would
    // only record our own assumption back at us. Only a human at the hardware
    // can settle these.
    if (this.#options.target === 'emulator') return;
    const answer = await this.#ask(`    ${question}\n    > `);
    const note: TraceNote = { kind: 'note', step: step.id, question, answer };
    this.#write(note);
  }

  async #ask(prompt: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(prompt);
    rl.close();
    return answer.trim();
  }

  #openPorts(): void {
    for (const [role, name] of [
      ['dawIn', this.#options.portNames.dawIn],
      ['midiIn', this.#options.portNames.midiIn],
    ] as const) {
      const output = new Output();
      output.openPortByName(name);
      this.#outputs.set(role, output);
    }

    for (const [role, name] of [
      ['dawOut', this.#options.portNames.dawOut],
      ['midiOut', this.#options.portNames.midiOut],
    ] as const) {
      const input = new Input();
      input.ignoreTypes(false, false, false);
      input.on('message', (_delta, bytes) => this.#record(role, 'fromDevice', [...bytes]));
      input.openPortByName(name);
      this.#inputs.push(input);
    }
  }

  async #openBridge(): Promise<void> {
    const url = this.#options.bridgeUrl ?? 'ws://localhost:7373';
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error(`could not reach the bridge at ${url}`)));
    });
    this.#socket = socket;
  }

  #send(port: 'dawIn' | 'midiIn', bytes: readonly number[]): void {
    this.#outputs.get(port)?.sendMessage([...bytes]);
    this.#record(port, 'toDevice', bytes);
  }

  #record(port: string, dir: string, bytes: readonly number[]): void {
    const io: TraceIO = {
      kind: 'io',
      at: Number((performance.now() - this.#startedAt).toFixed(3)),
      port,
      dir,
      bytes: toHex(bytes),
    };
    this.#write(io);
  }

  #write(value: unknown): void {
    this.#stream.write(`${JSON.stringify(value)}\n`);
  }

  async #close(): Promise<void> {
    this.#socket?.close();
    for (const input of this.#inputs) {
      input.closePort();
      input.destroy();
    }
    for (const output of this.#outputs.values()) {
      output.closePort();
      output.destroy();
    }
    await new Promise<void>((resolve) => this.#stream.end(resolve));
  }
}
