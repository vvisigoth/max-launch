import { createWriteStream, type WriteStream } from 'node:fs';
import { toHex, TRACE_VERSION, type TimedMessage, type TraceHeader, type TraceIO } from '@lcxl3/core';
import type { BridgeConfig } from './config.ts';

/**
 * JSONL trace format, shared by the emulator and by hardware captures.
 *
 * Phase 8 works by running the same scripted sweep against the real device and
 * against the emulator and diffing the two traces, so the format is fixed here,
 * in phase 1, before anything depends on it. One header object, then one object
 * per message. `at` is milliseconds since the capture opened - relative, so two
 * runs on different days line up.
 */
export const CAPTURE_VERSION = TRACE_VERSION;

export class CaptureWriter {
  readonly #stream: WriteStream;

  constructor(path: string, config: BridgeConfig, source: TraceHeader['source'], note?: string) {
    this.#stream = createWriteStream(path, { flags: 'a' });
    const header: TraceHeader = {
      kind: 'header',
      version: CAPTURE_VERSION,
      source,
      deviceId: config.deviceId,
      portNames: config.portNames,
      startedAt: new Date().toISOString(),
      ...(note === undefined ? {} : { note }),
    };
    this.#write(header);
  }

  record(message: TimedMessage): void {
    const event: TraceIO = {
      kind: 'io',
      at: Number(message.at.toFixed(3)),
      port: message.port,
      dir: message.direction,
      bytes: toHex(message.bytes),
    };
    this.#write(event);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.#stream.end(resolve));
  }

  #write(value: unknown): void {
    this.#stream.write(`${JSON.stringify(value)}\n`);
  }
}
