import type { ControlDef, Gesture, LedState, SurfaceState } from '@lcxl3/core';
import { FADER_PICKUP_CC, LED_BRIGHTNESS_CC } from '@lcxl3/core';
import { ScreenPanel } from './screen.ts';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** How far the pointer travels for one step of an encoder or the full fader. */
const PIXELS_PER_ENCODER_STEP = 2.5;

/** Rotation sweep of an encoder pointer, mirroring a physical detented knob. */
const SWEEP_DEGREES = 270;

export type GestureSink = (gesture: Gesture) => void;

interface Rendered {
  readonly setValue: (value: number) => void;
  readonly setPressed: (pressed: boolean) => void;
  readonly setLed: (led: LedState | undefined) => void;
  /** The parameter a fader under pickup has to catch, or undefined. */
  readonly setTarget: (target: number | undefined) => void;
}

/**
 * Paints an LED. An unaddressed LED keeps its inert colour rather than going
 * black, so "the host has not touched this" stays visibly different from "the
 * host set it dark".
 */
const paintLed = (node: HTMLElement, led: LedState | undefined): void => {
  if (led === undefined) {
    node.style.removeProperty('background');
    node.style.removeProperty('box-shadow');
    node.removeAttribute('title');
    return;
  }
  node.style.background = led.hex;
  node.style.boxShadow = `0 0 6px ${led.hex}, 0 0 2px ${led.hex}`;
  node.title = led.source === 'palette' ? `palette ${led.palette} ${led.hex}` : `RGB ${led.hex}`;
};

/**
 * Draws the surface with the hardware's geometry: three rows of eight encoders
 * over eight faders, two rows of eight buttons beneath, and the side column.
 * Positions come from each control's row/column in the spec rather than being
 * hand-placed, so a correction to the CC map moves the picture too.
 */
export class Surface {
  readonly #root: HTMLElement;
  readonly #rendered = new Map<string, Rendered>();
  readonly #send: GestureSink;
  readonly #screen = new ScreenPanel();

  constructor(controls: readonly ControlDef[], send: GestureSink) {
    this.#send = send;
    this.#root = el('div', 'device');

    const byId = (id: string): ControlDef | undefined => controls.find((c) => c.id === id);

    const mainSidebar = el('div', 'sidebar sidebar--main');
    mainSidebar.append(this.#screen.element);
    for (const id of ['pageUp', 'pageDown', 'trackPrev', 'trackNext', 'record', 'play', 'shift']) {
      const control = byId(id);
      if (control) mainSidebar.append(this.#button(control, 'button button--wide button--sidebar'));
    }
    this.#root.append(mainSidebar);

    for (const control of controls) {
      if (control.kind === 'encoder' && control.row !== undefined && control.column !== undefined) {
        const node = this.#encoder(control);
        node.style.gridRow = String(control.row);
        node.style.gridColumn = String(control.column + 1);
        this.#root.append(node);
      }
      if (control.kind === 'fader' && control.column !== undefined) {
        const node = this.#fader(control);
        node.style.gridColumn = String(control.column + 1);
        this.#root.append(node);
      }
    }

    const buttonSidebar = el('div', 'sidebar sidebar--buttons');
    for (const id of ['soloArm', 'muteSelect', 'utility']) {
      const control = byId(id);
      if (control) buttonSidebar.append(this.#button(control, 'button button--wide button--sidebar'));
    }
    this.#root.append(buttonSidebar);

    for (const control of controls) {
      if (control.kind !== 'button' || control.row === undefined || control.column === undefined) continue;
      const node = this.#button(control, 'button');
      node.style.gridRow = String(control.row + 4);
      node.style.gridColumn = String(control.column + 1);
      this.#root.append(node);
    }
  }

  get element(): HTMLElement {
    return this.#root;
  }

  update(state: SurfaceState): void {
    // CC 111 dims the whole surface, 0 to 127.
    const brightness = (state.features[LED_BRIGHTNESS_CC] ?? 127) / 127;
    this.#root.style.setProperty('--led-brightness', brightness.toFixed(3));
    this.#root.dataset['shift'] = state.shiftActive ? (state.shiftLatched ? 'latched' : 'held') : 'off';

    const pickup = (state.features[FADER_PICKUP_CC] ?? 0) >= 64;

    for (const [id, rendered] of this.#rendered) {
      const value = state.values[id];
      if (value !== undefined) rendered.setValue(value);
      rendered.setPressed(state.pressed[id] === true);
      rendered.setLed(state.leds[id]);
      rendered.setTarget(pickup && state.pickedUp[id] !== true ? state.parameters[id] : undefined);
    }
    this.#screen.update(state.screen);
  }

  #encoder(control: ControlDef): HTMLElement {
    const wrap = el('div', 'control');
    const led2 = el('div', 'led');
    const knob = el('div', 'encoder');
    const pointer = el('div', 'encoder__pointer');
    const label = el('div', 'control__label', '0');
    knob.append(pointer);
    wrap.append(led2, knob, label);

    this.#rendered.set(control.id, {
      setValue: (value) => {
        pointer.style.transform = `rotate(${(value / 127) * SWEEP_DEGREES - SWEEP_DEGREES / 2}deg)`;
        label.textContent = String(value);
      },
      setPressed: () => {},
      setLed: (led) => paintLed(led2, led),
      setTarget: () => {},
    });

    knob.title = `${control.label} — CC ${control.cc} ch ${control.channel}`;

    let carry = 0;
    knob.addEventListener('pointerdown', (event) => {
      knob.setPointerCapture(event.pointerId);
      carry = 0;
      wrap.classList.add('control--active');
      // Sent before any movement: with Shift down this makes it a preview.
      this.#send({ kind: 'grab', controlId: control.id });
    });
    knob.addEventListener('pointermove', (event) => {
      if (!knob.hasPointerCapture(event.pointerId)) return;
      carry -= event.movementY;
      const steps = Math.trunc(carry / PIXELS_PER_ENCODER_STEP);
      if (steps === 0) return;
      carry -= steps * PIXELS_PER_ENCODER_STEP;
      this.#send({ kind: 'turn', controlId: control.id, delta: steps });
    });
    const end = (event: PointerEvent): void => {
      if (knob.hasPointerCapture(event.pointerId)) knob.releasePointerCapture(event.pointerId);
      wrap.classList.remove('control--active');
      this.#send({ kind: 'letGo', controlId: control.id });
    };
    knob.addEventListener('pointerup', end);
    knob.addEventListener('pointercancel', end);
    knob.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.#send({ kind: 'turn', controlId: control.id, delta: event.deltaY < 0 ? 1 : -1 });
      },
      { passive: false },
    );

    // Prevent a drag from selecting the page while the pointer is captured.
    knob.addEventListener('dragstart', (event) => event.preventDefault());
    return wrap;
  }

  #fader(control: ControlDef): HTMLElement {
    const wrap = el('div', 'control fader');
    const track = el('div', 'fader__track');
    const cap = el('div', 'fader__cap');
    const ghost = el('div', 'fader__target');
    const label = el('div', 'control__label', '0');
    track.append(ghost, cap);
    wrap.append(track, label);

    track.title = `${control.label} — CC ${control.cc} ch ${control.channel}`;

    this.#rendered.set(control.id, {
      setValue: (value) => {
        cap.style.top = `${(1 - value / 127) * 100}%`;
        label.textContent = String(value);
      },
      setPressed: () => {},
      setLed: () => {},
      setTarget: (target) => {
        ghost.hidden = target === undefined;
        if (target !== undefined) {
          ghost.style.top = `${(1 - target / 127) * 100}%`;
          ghost.title = `pickup: move to ${target}`;
        }
      },
    });

    const valueFromEvent = (event: PointerEvent): number => {
      const box = track.getBoundingClientRect();
      const ratio = 1 - (event.clientY - box.top) / box.height;
      return Math.round(Math.min(1, Math.max(0, ratio)) * 127);
    };

    track.addEventListener('pointerdown', (event) => {
      track.setPointerCapture(event.pointerId);
      wrap.classList.add('control--active');
      this.#send({ kind: 'grab', controlId: control.id });
      this.#send({ kind: 'setValue', controlId: control.id, value: valueFromEvent(event) });
    });
    track.addEventListener('pointermove', (event) => {
      if (!track.hasPointerCapture(event.pointerId)) return;
      this.#send({ kind: 'setValue', controlId: control.id, value: valueFromEvent(event) });
    });
    const end = (event: PointerEvent): void => {
      if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
      wrap.classList.remove('control--active');
      this.#send({ kind: 'letGo', controlId: control.id });
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);

    return wrap;
  }

  #button(control: ControlDef, className: string): HTMLElement {
    const node = el('button', className);
    const led = el('div', 'led');
    const text = el('span', undefined, control.label.replace(/^Button (top|bottom) /, ''));
    if (control.hasLed) node.append(led);
    node.append(text);
    node.title = `${control.label} — CC ${control.cc} ch ${control.channel}`;

    this.#rendered.set(control.id, {
      setValue: () => {},
      setPressed: (pressed) => node.setAttribute('data-pressed', String(pressed)),
      setLed: (state) => paintLed(led, state),
      setTarget: () => {},
    });

    node.addEventListener('pointerdown', (event) => {
      node.setPointerCapture(event.pointerId);
      this.#send({ kind: 'press', controlId: control.id });
    });
    const release = (event: PointerEvent): void => {
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      this.#send({ kind: 'release', controlId: control.id });
    };
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);

    return node;
  }
}
