import { Input, Output } from '@julusian/midi';
import { PORT_DIRECTION, PORT_ROLES, type MidiBytes, type PortRole, type TimedMessage } from '@lcxl3/core';

export type MessageHandler = (message: TimedMessage) => void;

/**
 * The six CoreMIDI virtual endpoints that make up a Launch Control XL 3.
 *
 * Direction is from the host's point of view, and it inverts when it crosses
 * into rtmidi: a port the host *writes to* is something this process must
 * *read*, so it is an rtmidi `Input`. A port the host reads from is an rtmidi
 * `Output`. Getting this backwards produces ports that appear in Max's lists on
 * the wrong side, which is a confusing thing to debug, hence the table in
 * `PORT_DIRECTION` being the single source of truth.
 */
export class VirtualPortSet {
  readonly #names: Readonly<Record<PortRole, string>>;
  readonly #inputs = new Map<PortRole, Input>();
  readonly #outputs = new Map<PortRole, Output>();
  readonly #handlers = new Set<MessageHandler>();
  #startedAt = 0;
  #open = false;

  constructor(names: Readonly<Record<PortRole, string>>) {
    this.#names = names;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /** Milliseconds since `open()`, the timebase for every `TimedMessage`. */
  now(): number {
    return this.#startedAt === 0 ? 0 : performance.now() - this.#startedAt;
  }

  onMessage(handler: MessageHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  open(): void {
    if (this.#open) throw new Error('ports are already open');
    this.#startedAt = performance.now();

    try {
      for (const role of PORT_ROLES) {
        const name = this.#names[role];
        if (PORT_DIRECTION[role] === 'toDevice') {
          const input = new Input();
          // rtmidi drops SysEx, timing and active sensing by default. The whole
          // point of this project is the SysEx, so turn all three back on.
          input.ignoreTypes(false, false, false);
          input.on('message', (_delta, bytes) => this.#emit(role, bytes));
          input.openVirtualPort(name);
          this.#inputs.set(role, input);
        } else {
          const output = new Output();
          output.openVirtualPort(name);
          this.#outputs.set(role, output);
        }
      }
    } catch (error) {
      this.close();
      throw error;
    }

    this.#open = true;
  }

  /** Sends bytes out of one of the device's output ports, towards the host. */
  send(role: PortRole, bytes: MidiBytes): void {
    const output = this.#outputs.get(role);
    if (!output) {
      const direction = PORT_DIRECTION[role];
      throw new Error(
        direction === 'toDevice'
          ? `cannot send on ${role}: it is a host-to-device port, the device only receives on it`
          : `cannot send on ${role}: ports are not open`,
      );
    }
    output.sendMessage([...bytes]);
    this.#emit(role, bytes);
  }

  close(): void {
    for (const input of this.#inputs.values()) {
      input.closePort();
      input.destroy();
    }
    for (const output of this.#outputs.values()) {
      output.closePort();
      output.destroy();
    }
    this.#inputs.clear();
    this.#outputs.clear();
    this.#open = false;
  }

  #emit(role: PortRole, bytes: MidiBytes): void {
    const message: TimedMessage = {
      at: this.now(),
      port: role,
      direction: PORT_DIRECTION[role],
      bytes: [...bytes],
    };
    for (const handler of this.#handlers) handler(message);
  }
}

/**
 * What CoreMIDI currently reports, from rtmidi's point of view. Used to confirm
 * that our virtual endpoints appear under the names we asked for rather than
 * decorated with a client name.
 */
export const listSystemPorts = (): { sources: string[]; destinations: string[] } => ({
  sources: Input.getPortNames(),
  destinations: Output.getPortNames(),
});
