import { base64ToBytes, SCREEN_HEIGHT, SCREEN_WIDTH, unpackBitmap, type ScreenView } from '@lcxl3/core';

/**
 * The device's 128 × 64 display.
 *
 * Bitmaps go to a canvas at exactly 1:1 and are scaled up with nearest-neighbour
 * so the pixel grid stays visible; text arrangements are laid out as DOM so they
 * stay legible and selectable. Both live in the same box and take turns.
 */
export class ScreenPanel {
  readonly #root: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #text: HTMLElement;
  readonly #context: CanvasRenderingContext2D | null;

  constructor() {
    this.#root = document.createElement('div');
    this.#root.className = 'screen';

    this.#canvas = document.createElement('canvas');
    this.#canvas.width = SCREEN_WIDTH;
    this.#canvas.height = SCREEN_HEIGHT;
    this.#canvas.className = 'screen__canvas';
    this.#context = this.#canvas.getContext('2d');

    this.#text = document.createElement('div');
    this.#text.className = 'screen__text';

    this.#root.append(this.#canvas, this.#text);
    this.update({ kind: 'blank' });
  }

  get element(): HTMLElement {
    return this.#root;
  }

  update(view: ScreenView): void {
    const isBitmap = view.kind === 'bitmap' && view.bitmap !== undefined;
    this.#canvas.hidden = !isBitmap;
    this.#text.hidden = isBitmap;

    if (isBitmap) {
      this.#drawBitmap(view.bitmap!);
      return;
    }

    this.#root.dataset['source'] = view.source ?? 'none';
    this.#text.replaceChildren();
    if (view.kind === 'blank') return;

    if (view.title !== undefined && view.title !== '') {
      const title = document.createElement('div');
      title.className = 'screen__title';
      title.textContent = view.title;
      this.#text.append(title);
    }

    const body = document.createElement('div');
    body.className = view.grid === true ? 'screen__grid' : 'screen__lines';
    for (const line of view.lines ?? []) {
      const node = document.createElement('div');
      node.textContent = line;
      body.append(node);
    }
    this.#text.append(body);
  }

  #drawBitmap(encoded: string): void {
    if (!this.#context) return;
    const pixels = unpackBitmap(base64ToBytes(encoded));
    const image = this.#context.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    for (let i = 0; i < pixels.length; i++) {
      const lit = pixels[i] === 1;
      const at = i * 4;
      image.data[at] = lit ? 0xe6 : 0x0d;
      image.data[at + 1] = lit ? 0xe7 : 0x0e;
      image.data[at + 2] = lit ? 0xea : 0x11;
      image.data[at + 3] = 0xff;
    }
    this.#context.putImageData(image, 0, 0);
  }
}
