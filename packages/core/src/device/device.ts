import { DAW_CC_MAP } from '../spec/generated.ts';
import { toHex } from '../midi/hex.ts';
import { splitStatus, type MidiBytes, type PortRole } from '../midi/types.ts';
import { paletteLed, rgb7ToHex, type LedState } from '../surface/colour.ts';
import { CONTROLS, CONTROLS_BY_ID, controlForCC, controlForLedIndex, type ControlDef } from '../surface/controls.ts';
import {
  crosses,
  ENCODER_CURVE_CC,
  ENCODER_CURVE_FACTOR,
  FADER_PICKUP_CC,
  RELATIVE_PIVOT,
  RELATIVE_TOGGLE_CC,
  SHIFT_LATCH_WINDOW_MS,
  TOUCH_EVENTS_CC,
} from './behaviours.ts';
import { FEATURE_DEFAULTS, featureFor, MODE_SELECT_CC, NON_VOLATILE_CCS } from './features.ts';
import { DAW_ENTRY_MODE, DEFAULT_MODE, isDawSurface, modeFor, type ModeInfo } from './modes.ts';
import { Screen } from './screen.ts';
import type { Gesture, OutgoingMessage, SurfaceState } from './types.ts';

const clamp7 = (value: number): number => (value < 0 ? 0 : value > 127 ? 127 : Math.round(value));

const cc = (channel: number, index: number, value: number): number[] => [0xb0 | (channel - 1), index, value];

const HEADER = DAW_CC_MAP.sysex.header;
const DAW_MODE_PREFIX = [...HEADER, 0x02];
const RGB_COLOUR_PREFIX = [...HEADER, 0x01, 0x53];
const CONFIGURE_DISPLAY_PREFIX = [...HEADER, 0x04];
const SET_TEXT_PREFIX = [...HEADER, 0x06];
const BITMAP_PREFIX = [...HEADER, 0x09];

/**
 * The bitmap command appears not to be implemented in shipping firmware.
 *
 * Tested against a real unit on firmware 1.1 (2026-09-12): nine distinct
 * attempts - four framings and five device states - produced no acknowledgement
 * and drew nothing on the screen. Novation's own Bitwig integration has a full
 * display package (Arrangement, DisplayControl, DisplaySegment, ScreenTarget)
 * and no bitmap code at all; the v1.1 firmware release notes list screen
 * additions without mentioning custom graphics; and no community report of it
 * working exists.
 *
 * So the emulator accepts a bitmap and shows it in the panel - useful for
 * seeing what you sent, and ready if firmware ever implements it - but sends
 * **no acknowledgement**, because hardware sends none. Acking here would let a
 * patch be built around a reply that never comes on the real device, which is
 * the one failure this project exists to prevent.
 */
const BITMAP_ACKNOWLEDGED = false;

/** Temporary displays live for CC 113 tenths of a second, minimum one second. */
const DISPLAY_TIMEOUT_CC = 113;
const ENABLE_FEATURES_NOTE = toHex(DAW_CC_MAP.sysex.noteAliases.enableFeatureControls);
const DISABLE_FEATURES_NOTE = toHex(DAW_CC_MAP.sysex.noteAliases.disableFeatureControls);
const ENABLE_DAW_NOTE = toHex(DAW_CC_MAP.sysex.noteAliases.enableDawMode);
const DISABLE_DAW_NOTE = toHex(DAW_CC_MAP.sysex.noteAliases.disableDawMode);

const BUTTON_CHANNEL = DAW_CC_MAP.channels.buttons;
const CONTINUOUS_CHANNEL = DAW_CC_MAP.channels.encodersAndFaders;
const FEATURE_CHANNEL = DAW_CC_MAP.channels.featureControls;
const QUERY_CHANNEL = DAW_CC_MAP.channels.featureControlQueries;
const TOUCH_CHANNEL = DAW_CC_MAP.channels.touch;

/** `F0 7E <device> 06 01 F7` - any device id, including 7F for "all". */
const isDeviceInquiry = (bytes: MidiBytes): boolean =>
  bytes.length === 6 && bytes[0] === 0xf0 && bytes[1] === 0x7e && bytes[3] === 0x06 && bytes[4] === 0x01;

/**
 * The identity reply, confirmed against hardware on 2026-09-12.
 *
 * The device answers a device inquiry on *both* interfaces, and names which one
 * you reached in the member byte: 01 for the DAW interface, 00 for the MIDI
 * interface. Everything else is identical. Match on the manufacturer (00 20 29)
 * and family (48 01); the trailing four bytes are the firmware version and will
 * differ between units.
 */
const DEVICE_INQUIRY_REPLY_DAW: readonly number[] = [
  0xf0, 0x7e, 0x00, 0x06, 0x02, 0x00, 0x20, 0x29, 0x48, 0x01, 0x00, 0x01, 0x01, 0x01, 0x0b, 0x39, 0xf7,
];
const DEVICE_INQUIRY_REPLY_MIDI: readonly number[] = [
  0xf0, 0x7e, 0x00, 0x06, 0x02, 0x00, 0x20, 0x29, 0x48, 0x01, 0x00, 0x00, 0x01, 0x01, 0x0b, 0x39, 0xf7,
];

/**
 * The emulated Launch Control XL 3.
 *
 * Pure and synchronous: bytes and gestures in, bytes and state out. It owns no
 * ports and no timers, so the bridge can host it against real CoreMIDI while
 * tests drive it directly with no I/O at all.
 */
export class Device {
  #dawMode = false;
  #mode: ModeInfo = DEFAULT_MODE;
  #values = new Map<string, number>();
  /** Host-set values for faders, which pickup has to catch. */
  #parameters = new Map<string, number>();
  #pickedUp = new Set<string>();
  #pressed = new Set<string>();
  #shiftLatched = false;
  #lastShiftPress = Number.NEGATIVE_INFINITY;
  #previewing: string | undefined;
  #leds = new Map<string, LedState>();
  #features = new Map<number, number>();
  #screen = new Screen();
  /** Advanced by `tick`; time is an input so the device stays deterministic. */
  #now = 0;
  /**
   * Whether feature-control sets get a confirmation reply. Off until a host
   * asks for it with `9F 0B 7F`, per the guide's standalone-mode note.
   */
  #featureReplies = false;

  constructor() {
    this.#features = new Map(Object.entries(FEATURE_DEFAULTS).map(([k, v]) => [Number(k), v]));
    this.reset();
  }

  get state(): SurfaceState {
    return {
      dawMode: this.#dawMode,
      mode: this.#mode,
      values: Object.fromEntries(this.#values),
      parameters: Object.fromEntries(this.#parameters),
      pickedUp: Object.fromEntries([...this.#pickedUp].map((id) => [id, true])),
      pressed: Object.fromEntries([...this.#pressed].map((id) => [id, true])),
      shiftActive: this.#shiftActive,
      shiftLatched: this.#shiftLatched,
      previewing: this.#previewing ?? null,
      leds: Object.fromEntries(this.#leds),
      features: Object.fromEntries(this.#features),
      screen: this.#screen.view((target) => this.#defaultDisplayName(target)),
    };
  }

  /**
   * Power-cycle. The six feature controls marked (*) in the guide are
   * non-volatile and survive; everything else goes back to its default.
   */
  reset(): void {
    this.#dawMode = false;
    this.#mode = DEFAULT_MODE;
    this.#featureReplies = false;
    this.#values.clear();
    this.#parameters.clear();
    this.#pickedUp.clear();
    this.#pressed.clear();
    this.#shiftLatched = false;
    this.#lastShiftPress = Number.NEGATIVE_INFINITY;
    this.#previewing = undefined;
    this.#leds.clear();
    this.#screen.reset();
    for (const control of CONTROLS) {
      if (control.kind !== 'button') this.#values.set(control.id, 0);
    }
    for (const [cc_, value] of Object.entries(FEATURE_DEFAULTS)) {
      if (!NON_VOLATILE_CCS.includes(Number(cc_))) this.#features.set(Number(cc_), value);
    }
  }

  /**
   * Move the device's clock forward. The bridge calls this on a timer so
   * temporary displays expire; tests call it with exact values. Returns true if
   * anything visible changed.
   */
  tick(now: number): boolean {
    this.#now = now;
    return this.#screen.tick(now);
  }

  /** The non-volatile settings, for a bridge that wants to persist them. */
  get nonVolatile(): Readonly<Record<number, number>> {
    return Object.fromEntries(NON_VOLATILE_CCS.map((n) => [n, this.#features.get(n) ?? FEATURE_DEFAULTS[n] ?? 0]));
  }

  restoreNonVolatile(saved: Readonly<Record<number, number>>): void {
    for (const [key, value] of Object.entries(saved)) {
      const n = Number(key);
      if (NON_VOLATILE_CCS.includes(n) && Number.isInteger(value)) this.#features.set(n, clamp7(value));
    }
  }

  /**
   * Bytes arriving from the host on one of the device's input ports.
   *
   * The guide scopes all of this to the DAW In port. Honouring that strictly is
   * deliberate: a patch talking to the wrong port should fail here rather than
   * work on the emulator and then not on hardware.
   */
  receive(port: PortRole, bytes: MidiBytes): OutgoingMessage[] {
    // Device inquiry is a universal message, and hardware answers it on either
    // interface whether or not a host has claimed the device.
    if (isDeviceInquiry(bytes)) {
      if (port === 'dawIn') return [{ port: 'dawOut', bytes: DEVICE_INQUIRY_REPLY_DAW }];
      if (port === 'midiIn') return [{ port: 'midiOut', bytes: DEVICE_INQUIRY_REPLY_MIDI }];
      return [];
    }

    if (port !== 'dawIn') return [];
    if (bytes[0] === 0xf0) return this.#receiveSysEx(bytes);

    const status = splitStatus(bytes[0] ?? 0);
    if (status === null) return [];

    const hex = toHex(bytes);
    if (hex === ENABLE_DAW_NOTE) return this.#setDawMode(true);
    if (hex === DISABLE_DAW_NOTE) return this.#setDawMode(false);
    if (hex === ENABLE_FEATURES_NOTE || hex === DISABLE_FEATURES_NOTE) {
      this.#featureReplies = hex === ENABLE_FEATURES_NOTE;
      // Hardware echoes the note straight back. Confirmed 2026-09-12.
      return [{ port: 'dawOut', bytes: [...bytes] }];
    }

    if (status.type === 0xb0) return this.#receiveCC(status.channel, bytes[1] ?? 0, bytes[2] ?? 0);
    return [];
  }

  /** A physical action on the surface. */
  apply(gesture: Gesture): OutgoingMessage[] {
    if (gesture.kind === 'selectMode') {
      const mode = modeFor(gesture.mode);
      if (!mode) throw new Error(`unknown mode value: ${gesture.mode}`);
      // The guide is explicit that the device reports modes the user picks, and
      // that a DAW should follow them. This is the path that exercises it.
      return this.#setMode(mode, 'device');
    }

    const control = CONTROLS_BY_ID.get(gesture.controlId);
    if (!control) throw new Error(`unknown control: ${gesture.controlId}`);

    switch (gesture.kind) {
      case 'grab':
        return this.#grab(control);
      case 'letGo':
        return this.#letGo(control);
      case 'setValue':
        if (this.#previewing === control.id) return this.#preview(control);
        return this.#moveTo(control, clamp7(gesture.value));
      case 'turn': {
        if (this.#previewing === control.id) return this.#preview(control);
        const delta = gesture.delta * (ENCODER_CURVE_FACTOR[this.#features.get(ENCODER_CURVE_CC) ?? 1] ?? 1);
        return this.#turn(control, delta);
      }
      case 'press':
        if (this.#pressed.has(control.id)) return [];
        this.#pressed.add(control.id);
        if (control.id === 'shift') this.#pressShift();
        return this.#emit(control, 127);
      case 'release':
        if (!this.#pressed.delete(control.id)) return [];
        if (control.id === 'shift' && !this.#shiftLatched) this.#features.set(control.cc, 0);
        return this.#emit(control, 0);
    }
  }

  get #shiftActive(): boolean {
    return this.#pressed.has('shift') || this.#shiftLatched;
  }

  /**
   * Shift latches on a double press (user guide p.13), and the next press lets
   * it go again.
   */
  #pressShift(): void {
    if (this.#shiftLatched) {
      this.#shiftLatched = false;
    } else if (this.#now - this.#lastShiftPress < SHIFT_LATCH_WINDOW_MS) {
      this.#shiftLatched = true;
    }
    this.#lastShiftPress = this.#now;
    this.#features.set(63, 127);
  }

  /**
   * A hand landing on a continuous control.
   *
   * Touch On/Off brackets *any* handling of a fader or encoder, not only the
   * Shift gesture - a plain fader move produced `BE 08 7F` with Shift nowhere
   * near it (2026-09-12). Touch means "the user has hold of this", which is
   * what a DAW wants from it.
   *
   * Preview is narrower than the emulator first had it. Holding Shift and
   * moving a *fader* still sends the fader's CC: the cap has physically moved,
   * so there is no value to withhold, and hardware transmits the whole sweep.
   * Only an endless encoder can be rotated without applying the rotation.
   */
  #grab(control: ControlDef): OutgoingMessage[] {
    if (control.kind === 'button') return [];
    const out: OutgoingMessage[] = [];
    if (this.#shiftActive && control.kind === 'encoder') {
      this.#previewing = control.id;
      out.push(...this.#preview(control));
    }
    if (this.#touchEnabled()) out.push(this.#touch(control, 127));
    return out;
  }

  #letGo(control: ControlDef): OutgoingMessage[] {
    if (control.kind === 'button') return [];
    if (this.#previewing === control.id) this.#previewing = undefined;
    return this.#touchEnabled() ? [this.#touch(control, 0)] : [];
  }

  /** Raise the control's display without disturbing anything. */
  #preview(control: ControlDef): OutgoingMessage[] {
    this.#screen.noteControlChange(control.cc, this.#displayValue(control), this.#now, this.#displayTimeoutMs());
    return [];
  }

  #touchEnabled(): boolean {
    return (this.#features.get(TOUCH_EVENTS_CC) ?? 0) >= 0x40;
  }

  /**
   * Touch carries the control's *current* index: an encoder in relative mode
   * reports touch on its relative CC, not its absolute one. Observed as
   * `BE 4D 7F` while row 1 was switched over (2026-09-12).
   */
  #touch(control: ControlDef, value: number): OutgoingMessage {
    const index = this.#isRelative(control) && control.ccRelative !== undefined ? control.ccRelative : control.cc;
    return { port: 'dawOut', bytes: cc(TOUCH_CHANNEL, index, value) };
  }

  /** Whether this encoder's row has been switched to relative output. */
  #isRelative(control: ControlDef): boolean {
    if (control.kind !== 'encoder' || control.row === undefined) return false;
    const toggle = RELATIVE_TOGGLE_CC[control.row];
    return toggle !== undefined && (this.#features.get(toggle) ?? 0) >= 0x40;
  }

  /**
   * An endless encoder turning. In relative mode it reports movement rather
   * than position, so it keeps sending at the ends of its range - there are no
   * ends on an endless encoder. The tracked value still clamps, because that is
   * what the screen and the panel draw.
   */
  #turn(control: ControlDef, delta: number): OutgoingMessage[] {
    const stepped = Math.trunc(delta);
    if (stepped === 0) return [];

    const previous = this.#values.get(control.id) ?? 0;
    const next = clamp7(previous + stepped);
    this.#values.set(control.id, next);
    this.#screen.noteControlChange(control.cc, next, this.#now, this.#displayTimeoutMs());

    if (this.#isRelative(control) && control.ccRelative !== undefined) {
      if (!this.#dawMode || !isDawSurface(this.#mode)) return [];
      const encoded = clamp7(RELATIVE_PIVOT + stepped);
      return [{ port: 'dawOut', bytes: cc(control.channel, control.ccRelative, encoded) }];
    }

    if (next === previous) return [];
    return this.#emit(control, next);
  }

  #pickupEnabled(): boolean {
    return (this.#features.get(FADER_PICKUP_CC) ?? 0) >= 0x40;
  }

  /**
   * What the control's display should show. A fader that has not caught its
   * parameter is not controlling anything yet, so the value on screen is the
   * one it has to reach.
   */
  #displayValue(control: ControlDef): number {
    if (control.kind === 'fader' && this.#pickupEnabled() && !this.#pickedUp.has(control.id)) {
      return this.#parameters.get(control.id) ?? this.#values.get(control.id) ?? 0;
    }
    return this.#values.get(control.id) ?? 0;
  }

  #receiveSysEx(bytes: MidiBytes): OutgoingMessage[] {
    if (DAW_MODE_PREFIX.every((b, i) => bytes[i] === b)) {
      const flag = bytes[DAW_MODE_PREFIX.length];
      // `02 00` serves as both the probe a host opens with and the release it
      // closes with; the device echoes either, which is what makes the probe
      // work as a "are you there?".
      const echo: OutgoingMessage = { port: 'dawOut', bytes: [...bytes] };
      return [...this.#setDawMode(flag === 0x7f), echo];
    }

    if (RGB_COLOUR_PREFIX.every((b, i) => bytes[i] === b)) {
      const [index, r, g, b] = bytes.slice(RGB_COLOUR_PREFIX.length, RGB_COLOUR_PREFIX.length + 4);
      if (index !== undefined && r !== undefined && g !== undefined && b !== undefined) {
        this.#colour(index, { hex: rgb7ToHex(r, g, b), source: 'rgb' });
      }
      return [];
    }

    if (CONFIGURE_DISPLAY_PREFIX.every((b, i) => bytes[i] === b)) {
      const [target, config] = bytes.slice(CONFIGURE_DISPLAY_PREFIX.length);
      if (target !== undefined && config !== undefined) {
        this.#screen.configure(target, config, this.#now, this.#displayTimeoutMs());
      }
      return [];
    }

    if (SET_TEXT_PREFIX.every((b, i) => bytes[i] === b)) {
      const [target, field] = bytes.slice(SET_TEXT_PREFIX.length, SET_TEXT_PREFIX.length + 2);
      if (target !== undefined && field !== undefined) {
        this.#screen.setText(target, field, this.#payload(bytes, SET_TEXT_PREFIX.length + 2));
      }
      return [];
    }

    if (BITMAP_PREFIX.every((b, i) => bytes[i] === b)) {
      const target = bytes[BITMAP_PREFIX.length];
      if (target === undefined) return [];
      const data = this.#payload(bytes, BITMAP_PREFIX.length + 1);
      const accepted = this.#screen.setBitmap(target, data);
      if (!accepted || !BITMAP_ACKNOWLEDGED) return [];
      return [{ port: 'dawOut', bytes: [...HEADER, 0x09, 0xf7] }];
    }

    return [];
  }

  /**
   * Payload between a command prefix and the terminator. The guide writes the
   * bitmap command as ending in `7Fh`, so a trailing `7F` is tolerated as well
   * as the `F7` every other message uses.
   */
  #payload(bytes: MidiBytes, from: number): number[] {
    let end = bytes.length;
    while (end > from && (bytes[end - 1] === 0xf7 || bytes[end - 1] === 0x7f)) end--;
    return bytes.slice(from, end);
  }

  #displayTimeoutMs(): number {
    const tenths = this.#features.get(DISPLAY_TIMEOUT_CC) ?? 0;
    return Math.max(1000, tenths * 100);
  }

  /**
   * What a control's display shows when the host has not named it. The guide:
   * "Unless provided by messages (SysEx), typically this is the MIDI entity
   * (such as note or CC)."
   */
  #defaultDisplayName(target: number): string {
    const control = controlForCC(CONTINUOUS_CHANNEL, target);
    return control ? `${control.control.label}  CC ${target}` : `CC ${target}`;
  }

  /**
   * Host-to-device CCs carry several meanings on overlapping indices, and the
   * channel is what separates them: 7 sets a feature control, 8 queries one,
   * 1 colours an LED, and 16 sets a control's position.
   *
   * Colour versus position is the one that is inferred rather than stated.
   * Colouring is written as `B0h <index> <colour>` - channel 1 - while encoders
   * and faders report on channel 16 and separately pick up position the DAW
   * sends. Reading the channel is the only consistent way to tell them apart.
   * It is on the phase 8 list.
   */
  #receiveCC(channel: number, index: number, value: number): OutgoingMessage[] {
    if (channel === FEATURE_CHANNEL) return this.#setFeature(index, value);
    if (channel === QUERY_CHANNEL) return this.#queryFeature(index);

    if (!this.#dawMode) return [];

    if (channel === BUTTON_CHANNEL) {
      const led = paletteLed(value);
      if (led) this.#colour(index, led);
      return [];
    }
    if (channel === CONTINUOUS_CHANNEL) {
      const hit = controlForCC(channel, index);
      // Position the host sends is adopted silently. Echoing it back would
      // feed a loop through any patch that mirrors its own state.
      if (hit && hit.control.kind === 'encoder') {
        // Endless, so it simply takes the host's position - the guide's "if the
        // DAW sends them position information, they automatically pick that up".
        this.#values.set(hit.control.id, clamp7(value));
      } else if (hit && hit.control.kind === 'fader') {
        // A fader cannot move itself, so the host's value and the cap position
        // diverge, and pickup has to be re-earned.
        const target = clamp7(value);
        this.#parameters.set(hit.control.id, target);
        if (this.#values.get(hit.control.id) === target) this.#pickedUp.add(hit.control.id);
        else this.#pickedUp.delete(hit.control.id);
      }
    }
    return [];
  }

  #setFeature(index: number, value: number): OutgoingMessage[] {
    if (index === MODE_SELECT_CC) {
      const mode = modeFor(value);
      // The device reports every mode change, including ones the host asked
      // for - it does not distinguish. Confirmed against hardware 2026-09-12,
      // where each select produced a report and each query its own reply.
      return mode ? this.#setMode(mode, 'host') : [];
    }

    const feature = featureFor(index);
    if (!feature) return [];
    this.#features.set(index, clamp7(value));

    // "In DAW mode, all feature controls are listening, but will not send the
    // confirmation reply except for a few essential ones." The guide never says
    // which are essential, so nothing is confirmed in DAW mode; queries still
    // answer. Worth a hardware check in phase 8.
    if (this.#dawMode || !this.#featureReplies) return [];
    return [{ port: 'dawOut', bytes: cc(FEATURE_CHANNEL, index, clamp7(value)) }];
  }

  /**
   * Queries answer on channel 7 - but outside DAW mode they are gated behind
   * `9F 0B 7F` exactly as sets are. Hardware ignored all thirteen queries until
   * the feature controls had been woken up; the guide only says this of the
   * controls in general, not of queries specifically.
   */
  #queryFeature(index: number): OutgoingMessage[] {
    if (!this.#dawMode && !this.#featureReplies) return [];
    if (index === MODE_SELECT_CC) {
      return [{ port: 'dawOut', bytes: cc(FEATURE_CHANNEL, MODE_SELECT_CC, this.#mode.value) }];
    }
    const feature = featureFor(index);
    if (!feature) return [];
    return [{ port: 'dawOut', bytes: cc(FEATURE_CHANNEL, index, this.#features.get(index) ?? 0) }];
  }

  /**
   * A mode change is always reported on CC 1Eh. When the change *originated at
   * the device* - the user pressed Mode, or a release dropped the surface back
   * to its Custom Mode - an undocumented CC 1Fh (31) follows carrying the same
   * value. A host-driven change gets CC 1Eh alone.
   *
   * Confirmed 2026-09-12: host selects produced twelve 1Eh and zero 1Fh; user
   * presses and releases produced matched pairs every time. That makes CC 31
   * the signal a DAW needs to tell its own commands apart from the user's.
   */
  #setMode(mode: ModeInfo, origin: 'device' | 'host'): OutgoingMessage[] {
    if (this.#mode.value === mode.value) return [];
    this.#mode = mode;
    const report: OutgoingMessage[] = [{ port: 'dawOut', bytes: cc(FEATURE_CHANNEL, MODE_SELECT_CC, mode.value) }];
    if (origin === 'device') report.push({ port: 'dawOut', bytes: cc(FEATURE_CHANNEL, 0x1f, mode.value) });
    return report;
  }

  /**
   * Claiming the device does *not* produce a mode report - confirmed against
   * hardware, which answers a claim with the acknowledgement and nothing else.
   * Releasing it does: the surface goes back to its Custom Mode and says so.
   */
  #setDawMode(on: boolean): OutgoingMessage[] {
    if (this.#dawMode === on) return [];
    this.#dawMode = on;
    if (!on) {
      // LEDs survive. Asked directly whether every LED the host lit went out,
      // the answer was no - the device keeps them (2026-09-12).
      return this.#setMode(DEFAULT_MODE, 'device');
    }
    this.#mode = DAW_ENTRY_MODE;
    return [];
  }

  #colour(index: number, led: LedState): void {
    const control = controlForLedIndex(index);
    if (control) this.#leds.set(control.id, led);
  }

  /**
   * A fader moving to an absolute position.
   *
   * Under pickup the fader is mute until it catches the parameter: "the control
   * only outputs MIDI when you move it to the position of the parameter you're
   * controlling" (user guide). This is the single most common source of "works
   * on the emulator, not on the hardware", so the gate is real rather than
   * cosmetic - a fader that has not been caught genuinely emits nothing.
   */
  #moveTo(control: ControlDef, value: number): OutgoingMessage[] {
    if (control.kind === 'button') throw new Error(`${control.id} is a button, not a continuous control`);

    const previous = this.#values.get(control.id) ?? 0;
    if (previous === value) return [];
    this.#values.set(control.id, value);

    if (control.kind === 'fader' && this.#pickupEnabled() && !this.#pickedUp.has(control.id)) {
      const target = this.#parameters.get(control.id);
      if (target !== undefined && !crosses(previous, value, target)) {
        // Still hunting: show where it has to get to, and stay off the wire.
        this.#screen.noteControlChange(control.cc, target, this.#now, this.#displayTimeoutMs());
        return [];
      }
      this.#pickedUp.add(control.id);
    }

    // A control's display target is its own CC index (guide p.13).
    this.#screen.noteControlChange(control.cc, value, this.#now, this.#displayTimeoutMs());
    return this.#emit(control, value);
  }

  /**
   * In DAW mode the whole surface reports on the DAW port and nowhere else
   * (guide p.9) - but only while a DAW surface is selected. Switch to a Custom
   * Mode and output comes from that mode's own mapping on the MIDI port, which
   * this emulator does not carry, so the surface goes quiet. A patch that keeps
   * sending after the user has hit Mode will find out here.
   */
  #emit(control: ControlDef, value: number): OutgoingMessage[] {
    if (!this.#dawMode || !isDawSurface(this.#mode)) return [];
    return [{ port: 'dawOut', bytes: cc(control.channel, control.cc, value) }];
  }
}
