import { DAW_CC_MAP } from '../spec/generated.ts';

export type ControlKind = 'fader' | 'encoder' | 'button';

export interface ControlDef {
  readonly id: string;
  readonly kind: ControlKind;
  readonly label: string;
  /** 1-based row/column within the control's group, where the group is a grid. */
  readonly row?: number;
  readonly column?: number;
  readonly channel: number;
  /** CC index in DAW mode's default (absolute) encoder mode. */
  readonly cc: number;
  /** CC index when the control's encoder row is switched to relative mode. */
  readonly ccRelative?: number;
  /**
   * Whether the control has an addressable LED. Encoders and the button rows
   * clearly do (the guide's CC map draws their LEDs); the faders do not. The
   * guide explicitly excludes Shift from colouring because it is bound to a
   * feature control. Side-column LEDs are inferred from the guide's artwork
   * and are worth confirming in the phase 8 hardware sweep.
   */
  readonly hasLed: boolean;
}

const { controls } = DAW_CC_MAP;

const faders: ControlDef[] = controls.faders.cc.map((cc, i) => ({
  id: `fader${i + 1}`,
  kind: 'fader',
  label: `Fader ${i + 1}`,
  column: i + 1,
  channel: controls.faders.channel,
  cc,
  hasLed: false,
}));

const encoderRow = (row: 1 | 2 | 3): ControlDef[] => {
  const spec = row === 1 ? controls.encoderRow1 : row === 2 ? controls.encoderRow2 : controls.encoderRow3;
  return spec.ccAbsolute.map((cc, i) => ({
    id: `encoderR${row}C${i + 1}`,
    kind: 'encoder',
    label: `Encoder ${row}.${i + 1}`,
    row,
    column: i + 1,
    channel: spec.channel,
    cc,
    ccRelative: spec.ccRelative[i]!,
    hasLed: true,
  }));
};

const buttonRow = (which: 'Top' | 'Bottom'): ControlDef[] => {
  const spec = which === 'Top' ? controls.buttonRowTop : controls.buttonRowBottom;
  return spec.cc.map((cc, i) => ({
    id: `button${which}${i + 1}`,
    kind: 'button',
    label: `Button ${which.toLowerCase()} ${i + 1}`,
    row: which === 'Top' ? 1 : 2,
    column: i + 1,
    channel: spec.channel,
    cc,
    hasLed: true,
  }));
};

const side = (id: string, label: string, spec: { channel: number | null; cc: number | null }, hasLed: boolean): ControlDef[] =>
  spec.cc === null || spec.channel === null
    ? []
    : [{ id, kind: 'button', label, channel: spec.channel, cc: spec.cc, hasLed }];

/**
 * Every control that emits or receives MIDI, in a stable order. The Mode button
 * is deliberately absent: the guide lists it as "n/a" because it is a local UI
 * button that never reaches the wire.
 */
export const CONTROLS: readonly ControlDef[] = [
  ...encoderRow(1),
  ...encoderRow(2),
  ...encoderRow(3),
  ...faders,
  ...buttonRow('Top'),
  ...buttonRow('Bottom'),
  ...side('soloArm', 'Solo / Arm', controls.soloArm, true),
  ...side('muteSelect', 'Mute / Select', controls.muteSelect, true),
  ...side('utility', 'Utility', controls.utilitySmallButton, true),
  ...side('trackPrev', 'Track ◀', controls.trackPrev, true),
  ...side('trackNext', 'Track ▶', controls.trackNext, true),
  ...side('pageUp', 'Page ▲', controls.pageUp, true),
  ...side('pageDown', 'Page ▼', controls.pageDown, true),
  ...side('record', 'Record', controls.record, true),
  ...side('play', 'Play', controls.play, true),
  ...side('shift', 'Shift', controls.shift, false),
];

export const CONTROLS_BY_ID: ReadonlyMap<string, ControlDef> = new Map(CONTROLS.map((c) => [c.id, c]));

const key = (channel: number, cc: number): string => `${channel}:${cc}`;

const absoluteIndex = new Map<string, ControlDef>();
const relativeIndex = new Map<string, ControlDef>();
for (const control of CONTROLS) {
  absoluteIndex.set(key(control.channel, control.cc), control);
  if (control.ccRelative !== undefined) {
    relativeIndex.set(key(control.channel, control.ccRelative), control);
  }
}

/** Look up the control a DAW-mode CC belongs to, in either encoder mode. */
export const controlForCC = (
  channel: number,
  cc: number,
): { control: ControlDef; encoderMode: 'absolute' | 'relative' } | undefined => {
  const abs = absoluteIndex.get(key(channel, cc));
  if (abs) return { control: abs, encoderMode: 'absolute' };
  const rel = relativeIndex.get(key(channel, cc));
  if (rel) return { control: rel, encoderMode: 'relative' };
  return undefined;
};

/**
 * The control an LED-colouring message addresses. Colour messages carry the
 * control's own index, so this ignores the channel: the guide documents
 * channel 1, but captures of Live 12 show channel 16 in use as well.
 */
const ledIndex = new Map<number, ControlDef>();
for (const control of CONTROLS) {
  if (control.hasLed) ledIndex.set(control.cc, control);
}

export const controlForLedIndex = (index: number): ControlDef | undefined => ledIndex.get(index);
