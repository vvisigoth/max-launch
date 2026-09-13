import { toHex, type Decoded, type TimedMessage } from '@lcxl3/core';

const MAX_ENTRIES = 500;

/**
 * The MIDI traffic log. Both directions, decoded, newest at the bottom, with
 * auto-scroll that gives up the moment you scroll away to read something.
 */
export class TrafficLog {
  readonly #root: HTMLElement;
  readonly #list: HTMLElement;
  #follow = true;

  constructor() {
    this.#root = document.createElement('div');
    this.#root.className = 'log';

    const head = document.createElement('div');
    head.className = 'log__head';
    head.append(document.createTextNode('MIDI traffic'));

    const clear = document.createElement('button');
    clear.textContent = 'clear';
    clear.addEventListener('click', () => {
      this.#list.replaceChildren();
    });
    head.append(clear);

    this.#list = document.createElement('div');
    this.#list.className = 'log__list';
    this.#list.addEventListener('scroll', () => {
      const distanceFromBottom = this.#list.scrollHeight - this.#list.scrollTop - this.#list.clientHeight;
      this.#follow = distanceFromBottom < 24;
    });

    this.#root.append(head, this.#list);
  }

  get element(): HTMLElement {
    return this.#root;
  }

  append(message: TimedMessage, decoded: Decoded): void {
    const entry = document.createElement('div');
    entry.className = 'entry';
    entry.dataset['direction'] = message.direction;

    const cell = (className: string, text: string): HTMLElement => {
      const node = document.createElement('span');
      node.className = className;
      node.textContent = text;
      return node;
    };

    const hex = message.bytes.length > 12 ? `${toHex(message.bytes.slice(0, 12))}… (${message.bytes.length})` : toHex(message.bytes);

    entry.append(
      cell('entry__time', (message.at / 1000).toFixed(3)),
      cell('entry__arrow', message.direction === 'toDevice' ? '→' : '←'),
      cell('entry__port', message.port),
      cell('entry__text', decoded.summary),
    );

    const hexCell = cell('entry__hex', hex);
    hexCell.style.gridColumn = '4';
    entry.append(hexCell);
    entry.title = toHex(message.bytes) + (decoded.detail === undefined ? '' : `\n${decoded.detail}`);

    this.#list.append(entry);
    while (this.#list.childElementCount > MAX_ENTRIES) this.#list.firstElementChild?.remove();
    if (this.#follow) this.#list.scrollTop = this.#list.scrollHeight;
  }
}
