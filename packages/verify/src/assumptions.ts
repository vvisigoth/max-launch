export type AssumptionStatus = 'open' | 'confirmed' | 'refuted';

export interface Assumption {
  readonly id: string;
  /** Set once a hardware run has settled it. */
  readonly status?: AssumptionStatus;
  /** What the hardware actually did, and when. */
  readonly finding?: string;
  /** What the emulator currently does. */
  readonly claim: string;
  /** Where it came from, and how solid that is. */
  readonly source: string;
  /** What a difference in the trace would mean. */
  readonly ifWrong: string;
}

/**
 * Every inference the emulator rests on that the documents do not settle.
 *
 * These began life as comments scattered through the code. Collecting them here
 * with a probe apiece is what turns "I guessed" into "run this and find out" —
 * each id is referenced by a sweep step in `sweep.ts`, so a diff against a
 * hardware trace names the assumption rather than a byte offset.
 *
 * `confirmed` entries are kept deliberately: they were open questions that two
 * independent sources later settled, and the sweep should still check them.
 */
export const ASSUMPTIONS: readonly Assumption[] = [
  {
    id: 'probe-echo',
    status: 'confirmed',
    finding: 'Hardware echoed `02 00` back (2026-09-12).',
    claim: 'The device echoes `F0 00 20 29 02 15 02 00 F7` back at a host that sends it.',
    source: 'Community capture of Ableton Live 12 against a real unit. Not in the official guide.',
    ifWrong: 'A patch that waits for the echo before claiming the device would hang on hardware.',
  },
  {
    id: 'device-inquiry-reply',
    status: 'confirmed',
    finding: 'Byte-for-byte match on the DAW port, firmware 01 01 0B 39 included (2026-09-12).',
    claim: 'Identity reply is `F0 7E 00 06 02 00 20 29 48 01 00 01 01 01 0B 39 F7`.',
    source: 'One unit, one firmware, from the same community capture.',
    ifWrong: 'Manufacturer (00 20 29) and family (48 01) should hold; the trailing firmware bytes will differ per unit. Match on the first, never the second.',
  },
  {
    id: 'device-inquiry-port',
    status: 'refuted',
    finding: 'Hardware answers on BOTH interfaces and names which one in the member byte: 01 for DAW, 00 for MIDI. The emulator now does the same (2026-09-12).',
    claim: 'Device inquiry is answered on the DAW port only.',
    source: 'Inference. The capture only ever shows it on the DAW port; the guide does not say.',
    ifWrong: 'If hardware also answers on the MIDI port, the emulator is stricter than the device and a patch probing there would look broken here but work there.',
  },
  {
    id: 'daw-entry-mode',
    status: 'open',
    finding: 'Untestable so far: the device reports no mode on claim, so there is nothing to read. Needs a channel-8 query immediately after claiming.',
    claim: 'Claiming the device puts it in DAW Control (CC 30 value 2).',
    source: 'Chosen. The guide says the DAW modes "become available" but never which is selected.',
    ifWrong: 'Expect DAW Mixer (value 1) instead, or no change at all. One line in modes.ts.',
  },
  {
    id: 'daw-entry-reports',
    status: 'refuted',
    finding: 'A claim gets the acknowledgement and nothing else. The emulator no longer volunteers a mode report (2026-09-12).',
    claim: 'The device reports its mode on `B6 1E <mode>` immediately after being claimed.',
    source: 'Inference from "the DAW should follow them when setting up". The capture shows no such report.',
    ifWrong: 'The emulator emits a message the hardware does not. Harmless for a patch that follows mode reports; misleading for one that counts them.',
  },
  {
    id: 'mode-values',
    status: 'confirmed',
    finding: 'All six probed values (1, 2, 6, 9, 18, 29) selected and read back correctly, so guide p.17 is right and p.10 is the typo (2026-09-12).',
    claim: 'Custom 1-4 are 6-9 and Custom 5-16 are 18-29, per guide p.17.',
    source: 'Guide p.17. Guide p.10 gives a contradictory mapping that double-books mode 8.',
    ifWrong: 'p.10 was right and p.17 is the typo. Selecting a high custom mode would land on the wrong one.',
  },
  {
    id: 'slot-16-default',
    status: 'confirmed',
    finding: 'Value 29 selected and read back cleanly (2026-09-12).',
    claim: 'Slot 16 is an immutable factory Default, not a sixteenth editable Custom Mode.',
    source: 'CONFIRMED twice: user guide p.13 ("15 Custom Modes, and one Default mode (slot 16)") and the community protocol notes ("Slot 15 is reserved and immutable", zero-based).',
    ifWrong: 'Only the label is wrong; nothing on the wire changes.',
  },
  {
    id: 'colour-vs-position-channel',
    status: 'confirmed',
    finding: 'Encoder 1.1 lit RED when sent `B0 0D 05` on channel 1 (2026-09-12). The most load-bearing inference in the emulator, and it holds.',
    claim: 'A host CC on channel 1 colours an LED; the same index on channel 16 sets a position.',
    source: 'Inference, and the most load-bearing one in the emulator. Colouring is written `B0h` (channel 1) while encoders report on channel 16; both use the same control index, so the channel is the only discriminator available.',
    ifWrong: 'Everything about LED feedback and position pickup is addressed wrongly. Check this first — it is the one most likely to be wrong.',
  },
  {
    id: 'palette-values',
    status: 'open',
    finding: 'A spread of eight indices produced a spread of colours; exact values need the photograph compared against spec/lcxl3-palette.json.',
    claim: 'The 128 palette entries are the RGB values in spec/lcxl3-palette.json.',
    source: 'Sampled from the swatch image in the official guide — the document\'s rendering of the palette, not a measurement of the LEDs.',
    ifWrong: 'Colours are approximately right but not exact. Only matters if you are matching LED output to something else.',
  },
  {
    id: 'palette-zero',
    status: 'refuted',
    finding: 'Index 0 turns the LED OFF, not dim grey — confirmed twice, directly and via the palette spread. The emulator now renders it black (2026-09-12).',
    claim: 'Palette index 0 is the dim grey #616161, and "never coloured" is a distinct state from "coloured 0".',
    source: 'The guide\'s swatch draws index 0 as grey; other devices in the family treat 0 as off.',
    ifWrong: 'If 0 means off, the two states collapse into one and the panel should render index 0 as unlit.',
  },
  {
    id: 'led-clear-on-release',
    status: 'refuted',
    finding: 'LEDs survive a release: asked whether every one went out, the answer was no. The emulator no longer clears them (2026-09-12).',
    claim: 'Leaving DAW mode, or selecting a Custom Mode, drops every LED the host lit.',
    source: 'Inference: the surface returns to a Custom Mode whose colours the emulator does not carry.',
    ifWrong: 'The hardware may hold the last colours. A patch that repaints on reconnect would be doing unnecessary work, not broken work.',
  },
  {
    id: 'feature-defaults',
    status: 'open',
    finding: 'Observed on one configured unit: 6F=100, 70=99, 71=90, 79=1, everything else 0. These are that user\'s settings, not factory defaults — only a factory-reset device can settle this.',
    claim: 'Power-on values: LED and screen brightness 127, encoder curve medium, timeout 0, everything else 0.',
    source: 'Chosen to be usable. The guide documents ranges but no defaults.',
    ifWrong: 'One channel-8 query per feature control against a factory-reset unit replaces the whole table.',
  },
  {
    id: 'essential-feature-replies',
    status: 'confirmed',
    finding: 'No confirmation for any feature set while claimed (2026-09-12).',
    claim: 'No feature-control set is confirmed while in DAW mode.',
    source: 'The guide says all are listening "but will not send the confirmation reply except for a few essential ones" and never says which.',
    ifWrong: 'Some subset does reply. A patch waiting on a confirmation would hang here but work on hardware.',
  },
  {
    id: 'feature-reply-gate',
    status: 'refuted',
    finding: 'Stricter than assumed: in standalone mode QUERIES are gated too, not only sets. Hardware ignored all thirteen queries until `9F 0B 7F`. The device also echoes that note back. Both now emulated (2026-09-12).',
    claim: 'Outside DAW mode, sets are silent until a host sends `9F 0B 7F`.',
    source: 'Guide p.16, read strictly.',
    ifWrong: 'The device may confirm by default, making the emulator quieter than the hardware.',
  },
  {
    id: 'encoder-position-adopt',
    status: 'confirmed',
    finding: 'Parked encoder 1.1 at 100 with `BF 0D 64`, then one click clockwise returned `BF 0D 65` — 101. It adopts the host position, and confirms one click is one unit on the slow curve (2026-09-13).',
    claim: 'An encoder adopts a host-sent position directly; a fader gets a parameter instead and its cap does not move.',
    source: 'Guide: "If the DAW sends them position information, they automatically pick that up" — said of encoders. Faders have a separate pickup feature, which only makes sense if they cannot move themselves.',
    ifWrong: 'Fader pickup is modelled on the wrong thing entirely.',
  },
  {
    id: 'pickup-crossing',
    status: 'confirmed',
    finding: 'With the parameter parked at 100, the fader emitted nothing below it and came alive at 101 (2026-09-12).',
    claim: 'A fader catches its parameter by reaching it, not only by passing it.',
    source: 'Inference. "Move it to the position of the parameter" (user guide). Requiring a strict pass would make a parameter at 0 or 127 uncatchable.',
    ifWrong: 'Faders at the extremes would be permanently mute on hardware — a conspicuous bug, so this is likely right.',
  },
  {
    id: 'pickup-rearm',
    status: 'confirmed',
    finding: 'Confirmed in the same run (2026-09-12).',
    claim: 'Pickup is lost again whenever the host moves the parameter away from the cap.',
    source: 'Inference from what pickup is for.',
    ifWrong: 'A fader may stay live across a bank change, which is the opposite of what pickup exists to prevent.',
  },
  {
    id: 'pickup-display',
    status: 'confirmed',
    finding: 'A hunting fader showed 100, the target, not the cap position (2026-09-12).',
    claim: 'A fader still hunting shows the value it has to reach, not where the cap is.',
    source: 'Inference. The guide says the display shows "the current value" of what the control controls, which under pickup is the parameter.',
    ifWrong: 'Cosmetic only.',
  },
  {
    id: 'touch-is-shift-move',
    status: 'refuted',
    finding: 'Touch brackets ANY handling of a continuous control: a plain fader move with Shift nowhere near produced `BE 08 7F`. Touch means "the user has hold of this". Also uses the RELATIVE CC index while a row is switched over (2026-09-12).',
    claim: 'Channel-15 Touch On/Off brackets the Shift + move preview gesture. There is no capacitive sensing.',
    source: 'Guide p.13 annotates the display Touch bit "(this is the Shift + rotate)"; user guide p.13 describes the preview; the word "touch" appears nowhere in the 91-page user guide.',
    ifWrong: 'If the faders are touch-sensitive, Touch events fire on any contact and mean "the user has grabbed this", not "the user is inspecting this".',
  },
  {
    id: 'preview-is-silent',
    status: 'refuted',
    finding: 'Only true of encoders. Shift was held start to finish and fader 3 still transmitted its whole sweep — a fader cannot be moved without changing, so there is no value to withhold. Preview now applies to encoders only (2026-09-12).',
    claim: 'Shift + move emits no control CC and does not change the value.',
    source: 'User guide p.13: "the screen shows you the value without changing it."',
    ifWrong: 'Well documented; unlikely to be wrong.',
  },
  {
    id: 'shift-latch-window',
    status: 'confirmed',
    finding: 'Double press latched and Shift stayed lit. The 400 ms window itself is still a guess, but it worked at human speed (2026-09-12).',
    claim: 'A second Shift press within 400 ms latches it.',
    source: 'The user guide says double-press latches; the window is invented.',
    ifWrong: 'Feel only. Adjust SHIFT_LATCH_WINDOW_MS.',
  },
  {
    id: 'encoder-curve-ratios',
    status: 'refuted',
    finding: 'Hardware emits VARIABLE deltas by turn speed — +1, +2 and +4 all appeared in one sustained turn. It is an acceleration curve, not the fixed multiplier the emulator applies. Feel only, but the model is wrong (2026-09-12).',
    claim: 'Slow, medium and fast scale rotation by 1x, 2x and 4x.',
    source: 'Invented. The guide names the three curves and gives no ratios or acceleration formula.',
    ifWrong: 'Feel only, and probably wrong — real curves usually accelerate with speed rather than scaling linearly. One table in behaviours.ts.',
  },
  {
    id: 'relative-no-ends',
    status: 'confirmed',
    finding: '302 movement messages past the end of the range, still reporting (2026-09-12).',
    claim: 'A relative encoder keeps reporting movement at the ends of its range.',
    source: 'Inference from endless encoders having no ends.',
    ifWrong: 'The device may track an internal value and go quiet at the extremes even in relative mode.',
  },
  {
    id: 'bitmap-ack-terminator',
    status: 'refuted',
    finding:
      'Moot: the bitmap command appears unimplemented. Nine attempts (four framings, five device states) drew nothing and drew no reply on firmware 1.1. Novation\'s own Bitwig integration ships a full text-display package and no bitmap code; the v1.1 release notes list screen changes without mentioning graphics; no community report of it working exists. The emulator now sends no acknowledgement, matching hardware (2026-09-12).',
    claim: 'The bitmap acknowledgement is `F0 00 20 29 02 15 09 F7`.',
    source: 'Guide p.15 prints it as `F0 ... 09 7Fh` with no terminator, and prints the bitmap command ending in `7Fh` too. Both read as `F7h` typed backwards.',
    ifWrong: 'If the device really sends a `7F` byte before `F7`, the ack is 9 bytes. A patch matching the whole message exactly would miss it.',
  },
  {
    id: 'bitmap-ack-on-error',
    claim: 'A malformed or wrongly-targeted bitmap frame is not acknowledged.',
    source: 'Inference. The guide says the reply comes "upon success".',
    ifWrong: 'An animation paced on the ack would stall on the emulator where hardware would continue.',
  },
  {
    id: 'display-auto-defaults',
    status: 'confirmed',
    finding: 'Moving a fader raised its name and value unprompted (2026-09-12).',
    claim: 'Both auto-display bits default set, so moving a control raises its display with no host involvement.',
    source: 'Guide p.13 states "(default: Set)" for both.',
    ifWrong: 'Documented; unlikely to be wrong.',
  },
  {
    id: 'display-timeout-minimum',
    status: 'confirmed',
    finding: 'About one second at CC 113 = 0 (2026-09-12).',
    claim: 'CC 113 of 0 means a one-second temporary display.',
    source: 'Guide p.17: "1/10 sec units, minimum of 1 sec at 0."',
    ifWrong: 'Documented; unlikely to be wrong.',
  },
  {
    id: 'stationary-default',
    status: 'confirmed',
    finding: 'A cold device shows a blank screen (2026-09-12).',
    claim: 'The stationary display is blank until a host sets text.',
    source: 'Chosen. The guide does not say what a factory device shows.',
    ifWrong: 'Cosmetic. The hardware probably shows the mode name.',
  },
  {
    id: 'button-cc-map',
    status: 'confirmed',
    finding: 'All 25 buttons verified one by one (2026-09-13): top row 37-44, bottom 45-52, Solo/Arm 65, Mute/Select 66, Track prev/next 103/102, Page up/down 106/107, Record 118, Play 116 on channel 1, Shift 63 on channel 7. Exactly 50 messages for 25 presses. The map transcribed from the guide\'s artwork is right, side-column ordering included.',
    claim: 'Buttons report on channel 1 at the CC indices in spec/lcxl3-daw-cc-map.json, with Shift on channel 7.',
    source: 'Transcribed from the CC map image in the guide, which is a picture rather than text.',
    ifWrong: 'Every button binding in a patch would be on the wrong control.',
  },
  {
    id: 'port-names',
    status: 'confirmed',
    finding: 'The hardware presents exactly these six names, including the four that were only inferred from guide p.5 (2026-09-12).',
    claim: 'The six ports are named `LCXL3 <id> MIDI In/Out`, `DAW In/Out`, `To DIN Out`, `To DIN Out 2`.',
    source: 'The DAW pair is confirmed by a hardware capture; the other four follow the same pattern by inference from guide p.5.',
    ifWrong: 'Put the real strings in lcxl3.config.json. Nothing else changes.',
  },
];

/** Something the hardware does that no document describes. */
export interface OpenQuestion {
  readonly id: string;
  readonly observed: string;
  readonly matters: string;
}

export const OPEN_QUESTIONS: readonly OpenQuestion[] = [
  {
    id: 'cc-31-marks-device-origin',
    observed:
      'Undocumented CC 1Fh (31) follows the CC 1Eh mode report, carrying the same value, but ONLY when the change came from the device: twelve 1Eh and zero 1Fh across host-driven selects, matched pairs every time the user pressed Mode or a release dropped the surface back.',
    matters:
      'This is how a DAW tells its own command apart from the user reaching over. The emulator now emits it for device-originated changes only. Undocumented, so treat as firmware-dependent.',
  },
  {
    id: 'utility-button-unverified',
    observed:
      'Every button in the map was confirmed on 2026-09-13 except the small unlabelled one at CC 104 — the follow-up probe forgot to ask for it.',
    matters: 'One press away from settled. Everything around it checked out exactly.',
  },
  {
    id: 'display-text-commit-required',
    observed:
      'RESOLVED 2026-09-13. Configure plus text showed nothing; adding `04 <target> 7F` displayed it, as did Live\'s `04 36 62` / text / `04 36 7F` bracket. Host text must be committed; displays the device raises itself need no commit.',
    matters: 'Fixed — the emulator now holds host text back until committed, matching the device.',
  },
  {
    id: 'bitmap-unimplemented',
    observed:
      'The bitmap command (09) does nothing on firmware 1.1: no display, no acknowledgement, across four framings and five device states. The screen is reachable only through the text arrangements.',
    matters:
      'Guide p.14-15 documents the feature in full. Treat the whole bitmap section as describing something not yet shipped. Re-test after a firmware update — the probe is scripts/bitmap-probe.mjs.',
  },
];

export const assumptionFor = (id: string): Assumption | undefined => ASSUMPTIONS.find((a) => a.id === id);
