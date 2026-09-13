export type ModeKind = 'dawMixer' | 'dawControl' | 'custom';

export interface ModeInfo {
  /** The value carried by CC 30 on channel 7. */
  readonly value: number;
  readonly kind: ModeKind;
  /** 1-16, for custom modes only. */
  readonly slot?: number;
  readonly label: string;
}

/**
 * Surface modes, as selected and reported by CC 1Eh (30) on channel 7.
 *
 * The guide lists these twice and the two lists disagree. Page 17 gives
 * "Custom Modes 1-4: 06h-09h" and "Custom Modes 5-16: 12h-1Dh (18-29)", which
 * is consistent: 4 values for 4 modes, 12 for 12. Page 10 gives the same first
 * range, then "12h - 15h (18-21) for modes 5 - 8" and "16h-1dh (22-29): Custom
 * Modes 8 - 16", which double-books mode 8 and offers 8 values for 9 modes.
 * Page 17 is taken as correct; page 10 looks like an editing slip.
 */
const customValue = (slot: number): number => (slot <= 4 ? slot + 5 : slot + 13);

/**
 * Slot 16 is not a sixteenth Custom Mode. The user guide is explicit: "Your
 * Launch Control XL 3 has two DAW modes (DAW Control and DAW Mixer), 15 Custom
 * Modes, and one Default mode (slot 16)." The programmer's reference calls the
 * whole range "Custom Modes 1-16", which is where the widely repeated "15 slots"
 * confusion comes from - there are 16 slots, and the last one is the factory
 * Default.
 */
export const MODES: readonly ModeInfo[] = [
  { value: 1, kind: 'dawMixer', label: 'DAW Mixer' },
  { value: 2, kind: 'dawControl', label: 'DAW Control' },
  ...Array.from({ length: 16 }, (_, i) => {
    const slot = i + 1;
    return {
      value: customValue(slot),
      kind: 'custom' as const,
      slot,
      label: slot === 16 ? 'Default (slot 16)' : `Custom ${slot}`,
    };
  }),
];

const byValue = new Map(MODES.map((mode) => [mode.value, mode]));

export const modeFor = (value: number): ModeInfo | undefined => byValue.get(value);

/** Whether this mode's surface reports on the DAW port rather than a Custom Mode's mapping. */
export const isDawSurface = (mode: ModeInfo): boolean => mode.kind !== 'custom';

/** The mode a freshly powered device sits in: standalone, first custom slot. */
export const DEFAULT_MODE = modeFor(customValue(1))!;

/**
 * Where the device lands when a host claims it. The guide says the DAW modes
 * "become available" once DAW mode is enabled but does not say which one is
 * selected, and the capture of Live's handshake does not show a mode report
 * either. DAW Control is chosen as the general-purpose surface; the choice, and
 * whether the device reports it at all, are both on the phase 8 list.
 */
export const DAW_ENTRY_MODE = modeFor(2)!;
