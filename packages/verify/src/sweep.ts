import { packBitmap, SCREEN_HEIGHT, SCREEN_WIDTH, type Gesture } from '@lcxl3/core';

export interface SendAction {
  readonly kind: 'send';
  readonly port: 'dawIn' | 'midiIn';
  readonly bytes: readonly number[];
}

/**
 * Something a script cannot do to a real device: turn a knob.
 *
 * Each carries both an instruction for a human at the hardware and the gesture
 * sequence that reproduces it on the emulator, so one sweep definition drives
 * both sides. Without this, every assumption about what the device *sends*
 * would be untestable.
 */
export interface ManualAction {
  readonly kind: 'manual';
  readonly instruct: string;
  readonly gestures: readonly Gesture[];
}

/** An observation only a human can make: what the screen or an LED looks like. */
export interface ObserveAction {
  readonly kind: 'observe';
  readonly question: string;
}

export type SweepAction = SendAction | ManualAction | ObserveAction;

export interface SweepStep {
  readonly id: string;
  readonly describe: string;
  readonly assumptions: readonly string[];
  readonly actions: readonly SweepAction[];
  /** How long to wait for replies after the step's actions. */
  readonly settleMs?: number;
}

const sysex = (...body: number[]): number[] => [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, ...body, 0xf7];
const daw = (bytes: readonly number[]): SendAction => ({ kind: 'send', port: 'dawIn', bytes });
const midi = (bytes: readonly number[]): SendAction => ({ kind: 'send', port: 'midiIn', bytes });

const CLAIM = sysex(0x02, 0x7f);
const RELEASE = sysex(0x02, 0x00);
const INQUIRY = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];

/** A frame with a border and a diagonal, distinctive enough to spot on a screen. */
const testFrame = (): number[] => {
  const pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  const set = (x: number, y: number): void => {
    if (x >= 0 && x < SCREEN_WIDTH && y >= 0 && y < SCREEN_HEIGHT) pixels[y * SCREEN_WIDTH + x] = 1;
  };
  for (let x = 0; x < SCREEN_WIDTH; x++) {
    set(x, 0);
    set(x, SCREEN_HEIGHT - 1);
    set(x, Math.floor((x * SCREEN_HEIGHT) / SCREEN_WIDTH));
  }
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    set(0, y);
    set(SCREEN_WIDTH - 1, y);
  }
  return packBitmap(pixels);
};

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/** Query every documented feature control on channel 8. */
const queryAllFeatures = (): SendAction[] =>
  [30, 63, 69, 70, 71, 72, 73, 100, 111, 112, 113, 120, 121].map((cc) => daw([0xb7, cc, 0x00]));

export const SWEEP: readonly SweepStep[] = [
  {
    id: 'cold-screen',
    describe: 'What a freshly powered device shows before any host talks to it',
    assumptions: ['stationary-default'],
    actions: [{ kind: 'observe', question: 'What is on the screen right now? (blank / mode name / something else)' }],
  },
  {
    id: 'inquiry-daw',
    describe: 'Universal Device Inquiry on the DAW port',
    assumptions: ['device-inquiry-reply'],
    actions: [daw(INQUIRY)],
  },
  {
    id: 'inquiry-midi',
    describe: 'Universal Device Inquiry on the MIDI port — does it answer there too?',
    assumptions: ['device-inquiry-port'],
    actions: [midi(INQUIRY)],
  },
  {
    id: 'probe',
    describe: 'The `02 00` probe a DAW opens with',
    assumptions: ['probe-echo'],
    actions: [daw(RELEASE)],
  },
  {
    id: 'features-at-rest',
    describe: 'Query every feature control before anything has set one',
    assumptions: ['feature-defaults'],
    // Feature controls have to be woken up first: in standalone mode the guide
    // gates them behind `9F 0B 7F`, and hardware turns out to gate the queries
    // too, not just the sets.
    actions: [daw([0x9f, 0x0b, 0x7f]), ...queryAllFeatures()],
  },
  {
    id: 'feature-gate-standalone',
    describe: 'A set before and after `9F 0B 7F`, outside DAW mode',
    assumptions: ['feature-reply-gate'],
    actions: [daw([0xb6, 111, 60]), daw([0x9f, 0x0b, 0x7f]), daw([0xb6, 111, 61]), daw([0x9f, 0x0b, 0x00])],
  },
  {
    id: 'claim',
    describe: 'Claim the device and see what it says',
    assumptions: ['daw-entry-mode', 'daw-entry-reports'],
    actions: [daw(CLAIM)],
  },
  {
    id: 'feature-set-in-daw',
    describe: 'A feature set while claimed — which, if any, confirm?',
    assumptions: ['essential-feature-replies'],
    actions: [daw([0xb6, 111, 100]), daw([0xb6, 71, 127]), daw([0xb6, 70, 127]), daw([0xb6, 113, 90])],
  },
  {
    id: 'mode-values',
    describe: 'Select each documented mode value and query it back',
    assumptions: ['mode-values', 'slot-16-default'],
    actions: [1, 2, 6, 9, 18, 29].flatMap((value) => [daw([0xb6, 0x1e, value]), daw([0xb7, 0x1e, 0x00])]),
  },
  {
    id: 'back-to-daw',
    describe: 'Return to a DAW surface',
    assumptions: [],
    actions: [daw([0xb6, 0x1e, 0x02])],
  },
  {
    id: 'colour-channel-1',
    describe: 'Colour encoder 1.1 on channel 1',
    assumptions: ['colour-vs-position-channel', 'palette-values'],
    actions: [
      daw([0xb0, 0x0d, 5]),
      { kind: 'observe', question: 'Did encoder 1.1 light RED, or did the knob position change instead?' },
    ],
  },
  {
    id: 'position-channel-16',
    describe: 'Send the same index on channel 16',
    assumptions: ['colour-vs-position-channel', 'encoder-position-adopt'],
    actions: [
      daw([0xbf, 0x0d, 100]),
      { kind: 'observe', question: 'Did encoder 1.1 change VALUE (screen shows ~100), or did its colour change?' },
    ],
  },
  {
    id: 'palette-zero',
    describe: 'Colour an LED with palette index 0',
    assumptions: ['palette-zero'],
    actions: [
      daw([0xb0, 0x0e, 0]),
      { kind: 'observe', question: 'Is encoder 1.2 OFF, or a dim grey?' },
    ],
  },
  {
    id: 'palette-spread',
    describe: 'Paint a spread of palette indices for a photograph',
    assumptions: ['palette-values'],
    actions: [
      ...Array.from({ length: 8 }, (_, i) => daw([0xb0, 0x0d + i, i * 16])),
      { kind: 'observe', question: 'Photograph the top encoder row for comparison against spec/lcxl3-palette.json.' },
    ],
  },
  {
    id: 'led-clear-on-release',
    describe: 'Release the device and see whether the LEDs survive',
    assumptions: ['led-clear-on-release'],
    actions: [
      daw(RELEASE),
      { kind: 'observe', question: 'Did every LED the host lit go out?' },
      daw(CLAIM),
    ],
  },
  {
    id: 'surface-sweep',
    describe: 'Every control through its range, to confirm the CC map',
    assumptions: ['port-names', 'button-cc-map'],
    actions: [
      {
        kind: 'manual',
        // One long sentence ending in "press every button once" got the faders
        // and encoders swept thoroughly and the buttons skipped entirely, which
        // left the button map unverified for a whole round trip. Numbered, and
        // with the buttons first.
        instruct: [
          'Work through all four, in order:',
          '  1. press the 8 TOP buttons, then the 8 BOTTOM buttons',
          '  2. press Solo/Arm, Mute/Select, the small unlabelled button,',
          '     Track < >, Page ^ v, Record, Play, and Shift',
          '  3. move every fader top to bottom',
          '  4. turn every encoder a full turn each way',
        ].join('\n    '),
        gestures: [
          ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
            { kind: 'setValue', controlId: `fader${n}`, value: 127 } as Gesture,
            { kind: 'setValue', controlId: `fader${n}`, value: 0 } as Gesture,
          ]),
          ...[1, 2, 3].flatMap((row) =>
            [1, 2, 3, 4, 5, 6, 7, 8].flatMap((col) => [
              { kind: 'turn', controlId: `encoderR${row}C${col}`, delta: 20 } as Gesture,
              { kind: 'turn', controlId: `encoderR${row}C${col}`, delta: -20 } as Gesture,
            ]),
          ),
          ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
            { kind: 'press', controlId: `buttonTop${n}` } as Gesture,
            { kind: 'release', controlId: `buttonTop${n}` } as Gesture,
            { kind: 'press', controlId: `buttonBottom${n}` } as Gesture,
            { kind: 'release', controlId: `buttonBottom${n}` } as Gesture,
          ]),
          ...[
            'soloArm',
            'muteSelect',
            'utility',
            'trackPrev',
            'trackNext',
            'pageUp',
            'pageDown',
            'record',
            'play',
            'shift',
          ].flatMap((id) => [
            { kind: 'press', controlId: id } as Gesture,
            { kind: 'release', controlId: id } as Gesture,
          ]),
        ],
      },
    ],
    settleMs: 1500,
  },
  {
    id: 'display-auto-on-change',
    describe: 'Moving a control with no host display configured',
    assumptions: ['display-auto-defaults'],
    actions: [
      {
        kind: 'manual',
        instruct: 'Move fader 1 a little.',
        gestures: [{ kind: 'setValue', controlId: 'fader1', value: 64 }],
      },
      { kind: 'observe', question: 'Did the screen show fader 1 and its value by itself?' },
    ],
  },
  {
    id: 'display-timeout',
    describe: 'How long a temporary display lingers at CC 113 = 0',
    assumptions: ['display-timeout-minimum'],
    actions: [
      daw([0xb6, 113, 0]),
      {
        kind: 'manual',
        instruct: 'Move fader 2 a little, then leave the device alone.',
        gestures: [{ kind: 'setValue', controlId: 'fader2', value: 100 }],
      },
      {
        kind: 'observe',
        question: 'Roughly how long did the display stay up before clearing? (expecting about 1 second)',
      },
      daw([0xb6, 113, 90]),
    ],
    settleMs: 1500,
  },
  {
    id: 'display-text',
    describe: 'Stationary display, arrangement 1',
    assumptions: [],
    actions: [
      daw(sysex(0x04, 0x35, 0x41)),
      daw(sysex(0x06, 0x35, 0x00, ...ascii('LCXL3'))),
      daw(sysex(0x06, 0x35, 0x01, ...ascii('verify'))),
      { kind: 'observe', question: 'Does the screen show "LCXL3" over "verify"?' },
    ],
  },
  {
    id: 'bitmap-good',
    describe: 'A well-formed 1216-byte bitmap',
    assumptions: ['bitmap-ack-terminator'],
    actions: [daw(sysex(0x09, 0x20, ...testFrame()))],
    settleMs: 400,
  },
  {
    id: 'bitmap-short',
    describe: 'A bitmap of the wrong length',
    assumptions: ['bitmap-ack-on-error'],
    actions: [daw(sysex(0x09, 0x20, ...testFrame().slice(0, 200)))],
    settleMs: 400,
  },
  {
    id: 'touch-shift-preview',
    describe: 'Shift + move: does it preview, and what does it send?',
    assumptions: ['touch-is-shift-move', 'preview-is-silent'],
    actions: [
      daw([0xb6, 71, 127]),
      {
        kind: 'manual',
        instruct: 'Hold Shift and move fader 3 up and down, then release both.',
        gestures: [
          { kind: 'press', controlId: 'shift' },
          { kind: 'grab', controlId: 'fader3' },
          { kind: 'setValue', controlId: 'fader3', value: 100 },
          { kind: 'letGo', controlId: 'fader3' },
          { kind: 'release', controlId: 'shift' },
        ],
      },
      { kind: 'observe', question: 'Did fader 3 stay put and only the screen react?' },
    ],
  },
  {
    id: 'touch-without-shift',
    describe: 'Moving a fader without Shift — any touch events?',
    assumptions: ['touch-is-shift-move'],
    actions: [
      {
        kind: 'manual',
        instruct: 'Move fader 4 without touching Shift.',
        gestures: [
          { kind: 'grab', controlId: 'fader4' },
          { kind: 'setValue', controlId: 'fader4', value: 100 },
          { kind: 'letGo', controlId: 'fader4' },
        ],
      },
    ],
  },
  {
    id: 'pickup',
    describe: 'A fader hunting a parameter the host parked away from it',
    assumptions: ['pickup-crossing', 'pickup-rearm', 'pickup-display'],
    actions: [
      daw([0xb6, 70, 127]),
      {
        kind: 'manual',
        instruct: 'Move fader 5 to the very bottom.',
        gestures: [{ kind: 'setValue', controlId: 'fader5', value: 0 }],
      },
      daw([0xbf, 0x09, 100]),
      {
        kind: 'manual',
        instruct: 'Now raise fader 5 slowly all the way to the top.',
        gestures: [
          { kind: 'setValue', controlId: 'fader5', value: 40 },
          { kind: 'setValue', controlId: 'fader5', value: 80 },
          { kind: 'setValue', controlId: 'fader5', value: 110 },
          { kind: 'setValue', controlId: 'fader5', value: 127 },
        ],
      },
      { kind: 'observe', question: 'While below 100, did the screen show 100 (the target) or the cap position?' },
    ],
  },
  {
    id: 'pickup-extreme',
    describe: 'A parameter parked at 127, which nothing can pass',
    assumptions: ['pickup-crossing'],
    actions: [
      daw([0xbf, 0x0a, 127]),
      {
        kind: 'manual',
        instruct: 'Move fader 6 to the very top.',
        gestures: [
          { kind: 'setValue', controlId: 'fader6', value: 0 },
          { kind: 'setValue', controlId: 'fader6', value: 127 },
        ],
      },
    ],
  },
  {
    id: 'relative-encoders',
    describe: 'Row 1 in relative mode, turned past the end of its range',
    assumptions: ['relative-no-ends'],
    actions: [
      daw([0xb6, 69, 127]),
      {
        kind: 'manual',
        instruct: 'Turn encoder 1.1 clockwise a long way — well past where it would run out.',
        gestures: Array.from({ length: 12 }, () => ({ kind: 'turn', controlId: 'encoderR1C1', delta: 12 }) as Gesture),
      },
      daw([0xb6, 69, 0]),
    ],
    settleMs: 800,
  },
  {
    id: 'encoder-curve',
    describe: 'One detent of rotation at each curve setting',
    assumptions: ['encoder-curve-ratios'],
    actions: [
      ...[0, 1, 2].flatMap((curve) => [
        daw([0xb6, 121, curve]),
        daw([0xbf, 0x15, 64]),
        {
          kind: 'manual',
          instruct: `Encoder curve ${['slow', 'medium', 'fast'][curve]}: turn encoder 2.1 exactly one detent clockwise.`,
          gestures: [{ kind: 'turn', controlId: 'encoderR2C1', delta: 1 }],
        } as ManualAction,
      ]),
      daw([0xb6, 121, 1]),
    ],
  },
  {
    id: 'shift-latch',
    describe: 'Double-press Shift to latch it',
    assumptions: ['shift-latch-window'],
    actions: [
      {
        kind: 'manual',
        instruct: 'Double-press Shift, then move fader 7, then press Shift once more.',
        gestures: [
          { kind: 'press', controlId: 'shift' },
          { kind: 'release', controlId: 'shift' },
          { kind: 'press', controlId: 'shift' },
          { kind: 'release', controlId: 'shift' },
          { kind: 'grab', controlId: 'fader7' },
          { kind: 'setValue', controlId: 'fader7', value: 90 },
          { kind: 'letGo', controlId: 'fader7' },
          { kind: 'press', controlId: 'shift' },
          { kind: 'release', controlId: 'shift' },
        ],
      },
      { kind: 'observe', question: 'Did Shift stay lit after the double press, and did fader 7 stay put?' },
    ],
  },
  {
    id: 'user-mode-change',
    describe: 'The user reaching for the Mode button',
    assumptions: ['daw-entry-reports'],
    actions: [
      {
        kind: 'manual',
        instruct: 'Press Mode and select Custom 1, then press Mode and select DAW Control again.',
        gestures: [
          { kind: 'selectMode', mode: 6 },
          { kind: 'selectMode', mode: 2 },
        ],
      },
    ],
    settleMs: 600,
  },
  {
    id: 'release',
    describe: 'Hand the device back',
    assumptions: [],
    actions: [daw(RELEASE)],
  },
];

export const stepFor = (id: string): SweepStep | undefined => SWEEP.find((step) => step.id === id);
