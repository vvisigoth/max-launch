import { BITMAP_BYTES, bytesToBase64, decodeScreenText } from '../surface/bitmap.ts';

/** Guide p.13: the permanent display, shown when nothing is layered over it. */
export const STATIONARY_TARGET = 0x35; // 53
/** The overlay that events raise and the timeout takes away. */
export const TEMPORARY_TARGET = 0x36; // 54
/** Faders 05h-0Ch and encoders 0Dh-24h each have their own temporary display. */
export const FIRST_CONTROL_TARGET = 0x05;
export const LAST_CONTROL_TARGET = 0x24;

/** Bitmap targets live in the `09` command's own namespace, not this one. */
export const BITMAP_STATIONARY_TARGET = 0x20;
export const BITMAP_TEMPORARY_TARGET = 0x21;

export const DEFAULT_ARRANGEMENT = 4;

export interface ScreenView {
  readonly kind: 'blank' | 'text' | 'bitmap';
  readonly source?: 'stationary' | 'temporary';
  readonly arrangement?: number;
  readonly title?: string;
  readonly lines?: readonly string[];
  /** Arrangement 3 lays its eight names out as two rows of four. */
  readonly grid?: boolean;
  /** 1216 bytes, base64. Unpack with `unpackBitmap`. */
  readonly bitmap?: string;
}

interface TargetState {
  arrangement: number;
  autoOnChange: boolean;
  autoOnTouch: boolean;
  fields: Map<number, string>;
  /**
   * Host-authored text stays invisible until it is committed with
   * `04 <target> 7F`. Confirmed on hardware: configure plus two text fields put
   * nothing on the screen; the same thing followed by the commit displayed it,
   * as did Live's own `04 36 62` / text / `04 36 7F` bracket (2026-09-13).
   *
   * Displays the device raises by itself - the auto-on-change temporaries - do
   * not need this, and never set it.
   */
  committed: boolean;
}

const freshTarget = (): TargetState => ({
  // The guide gives arrangement 4 as the default and both auto bits as "Set".
  arrangement: DEFAULT_ARRANGEMENT,
  autoOnChange: true,
  autoOnTouch: true,
  fields: new Map(),
  committed: false,
});

/**
 * The 128 × 64 screen.
 *
 * Time is an input, never ambient: temporary displays expire when `tick` is
 * called with a later timestamp. That keeps the whole device deterministic and
 * lets a test step through a timeout without waiting for one.
 */
export class Screen {
  readonly #targets = new Map<number, TargetState>();
  #bitmap: { target: number; bytes: readonly number[] } | undefined;
  #bitmapVisible = false;
  #temporary: { target: number; until: number; numeric?: number } | undefined;

  reset(): void {
    this.#targets.clear();
    this.#bitmap = undefined;
    this.#bitmapVisible = false;
    this.#temporary = undefined;
  }

  #target(target: number): TargetState {
    let state = this.#targets.get(target);
    if (!state) {
      state = freshTarget();
      this.#targets.set(target, state);
    }
    return state;
  }

  /**
   * `04 <target> <config>`. Bits 0-4 are the arrangement, bit 5 allows an
   * automatic display on touch and bit 6 on change. Arrangement 0 and 31 are
   * special — cancel and trigger — and deliberately leave the auto bits alone,
   * since `7Fh` sets both purely as a side effect of being the trigger value.
   */
  configure(target: number, config: number, now: number, timeoutMs: number): void {
    const arrangement = config & 0x1f;
    const state = this.#target(target);

    if (arrangement === 0) {
      this.#cancel(target);
      return;
    }
    if (arrangement === 31) {
      state.committed = true;
      this.#raise(target, now, timeoutMs);
      return;
    }

    // Re-configuring takes the display back down until it is committed again.
    state.committed = false;
    state.arrangement = arrangement;
    state.autoOnChange = (config & 0x40) !== 0;
    state.autoOnTouch = (config & 0x20) !== 0;
  }

  /** `06 <target> <field> <text…>`. */
  setText(target: number, field: number, text: readonly number[]): void {
    this.#target(target).fields.set(field, decodeScreenText(text));
  }

  /**
   * `09 <target> <1216 bytes>`. Returns whether the device should acknowledge,
   * which is what a host paces an animation against. The firmware holds one
   * bitmap at a time, so this replaces whatever was there.
   */
  setBitmap(target: number, data: readonly number[]): boolean {
    if (target !== BITMAP_STATIONARY_TARGET && target !== BITMAP_TEMPORARY_TARGET) return false;
    if (data.length !== BITMAP_BYTES) return false;
    this.#bitmap = { target, bytes: [...data] };
    this.#bitmapVisible = true;
    return true;
  }

  /**
   * A control moved. With auto-on-change set — which is the default — this is
   * what makes the screen show a parameter as you touch it, without the host
   * doing anything at all.
   */
  noteControlChange(target: number, numeric: number, now: number, timeoutMs: number): void {
    if (target < FIRST_CONTROL_TARGET || target > LAST_CONTROL_TARGET) return;
    if (!this.#target(target).autoOnChange) return;
    this.#temporary = { target, until: now + timeoutMs, numeric };
    // A bitmap is dismissed by the normal display coming up over it.
    this.#bitmapVisible = false;
  }

  /** Expire anything whose moment has passed. Returns true if the view changed. */
  tick(now: number): boolean {
    if (this.#temporary === undefined || now < this.#temporary.until) return false;
    this.#temporary = undefined;
    return true;
  }

  view(nameFor: (target: number) => string): ScreenView {
    if (this.#bitmapVisible && this.#bitmap) {
      return { kind: 'bitmap', bitmap: bytesToBase64(this.#bitmap.bytes) };
    }

    if (this.#temporary) {
      return this.#render(this.#temporary.target, 'temporary', nameFor, this.#temporary.numeric);
    }

    const stationary = this.#targets.get(STATIONARY_TARGET);
    if (stationary && stationary.committed && stationary.fields.size > 0) {
      return this.#render(STATIONARY_TARGET, 'stationary', nameFor);
    }
    return { kind: 'blank' };
  }

  #cancel(target: number): void {
    const state = this.#targets.get(target);
    if (state) state.committed = false;
    if (this.#temporary?.target === target) this.#temporary = undefined;
    if (target === BITMAP_STATIONARY_TARGET || target === BITMAP_TEMPORARY_TARGET) this.#bitmapVisible = false;
    this.#targets.get(target)?.fields.clear();
  }

  #raise(target: number, now: number, timeoutMs: number): void {
    this.#bitmapVisible = false;
    if (target === STATIONARY_TARGET) {
      this.#temporary = undefined;
      return;
    }
    this.#temporary = { target, until: now + timeoutMs };
  }

  /**
   * Field layout per arrangement, from the table on guide p.14. A field the
   * host has not set falls back to the MIDI entity the control drives, which is
   * what the guide says the device shows by default.
   */
  #render(
    target: number,
    source: 'stationary' | 'temporary',
    nameFor: (target: number) => string,
    numeric?: number,
  ): ScreenView {
    const state = this.#target(target);
    const field = (index: number): string => state.fields.get(index) ?? '';
    const name = state.fields.get(0) ?? nameFor(target);
    const base = { kind: 'text', source, arrangement: state.arrangement } as const;

    switch (state.arrangement) {
      case 1:
        return { ...base, lines: [name, field(1)] };
      case 2:
        return { ...base, title: field(0), lines: [field(1), field(2)] };
      case 3:
        return { ...base, title: field(0), lines: Array.from({ length: 8 }, (_, i) => field(i + 1)), grid: true };
      default:
        return { ...base, lines: [name, numeric === undefined ? '' : String(numeric)] };
    }
  }
}
