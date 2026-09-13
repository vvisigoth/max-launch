# max-launch

A faithful software emulation of the **Novation Launch Control XL 3**, exposed to Max (or any
host) as real CoreMIDI ports under the hardware's own names, with a browser panel for driving
the surface by hand.

Built to develop a Max patch against when the hardware isn't around — and then verified
against the hardware, which corrected nine things the documentation had wrong or unsaid.

![The panel: the emulated surface with LEDs lit, two faders showing pickup targets, the
128×64 screen, and a decoded MIDI traffic log](docs/panel.png)

```
┌──────────────────────┐   WebSocket    ┌──────────────────────────────┐
│  panel (browser)     │◄──────────────►│  bridge (Node)               │
│  surface · LEDs      │  gestures →    │  virtual CoreMIDI ports      │
│  128×64 screen       │  ← state       │  hosts the device model      │
│  MIDI traffic log    │                │  trace recorder              │
└──────────────────────┘                └──────────────┬───────────────┘
                                                       │ CoreMIDI
                                        ┌──────────────▼───────────────┐
                                        │  Max / Max for Live          │
                                        └──────────────────────────────┘
```

## Requirements

Node 22+ (uses native TypeScript stripping), macOS.

```bash
npm install
npm run panel:build
```

## Running

```bash
npm run bridge -- start        # panel at http://localhost:7373
```

Six virtual CoreMIDI endpoints appear under exactly the names the hardware uses — verified
against a real unit:

| Role | Port name | Direction |
|---|---|---|
| `midiIn` | `LCXL3 1 MIDI In` | host writes |
| `midiOut` | `LCXL3 1 MIDI Out` | host reads |
| `dawIn` | `LCXL3 1 DAW In` | host writes |
| `dawOut` | `LCXL3 1 DAW Out` | host reads |
| `dinOut1` | `LCXL3 1 To DIN Out` | host writes |
| `dinOut2` | `LCXL3 1 To DIN Out 2` | host writes |

With the real device plugged in as well, put `{"deviceId": 2}` in `lcxl3.config.json` so the
two don't collide on names.

For the panel with live reload, `npm run panel` in a second terminal, then
<http://localhost:5173>.

### The REPL

```
send dawOut B0 05 7F      emit bytes from a device output port
send dawOut d176 d5 d127  same, in decimal, as the Novation docs print it
daw on | daw off          shortcut for the DAW mode switch, bypassing the wire
state                     current surface state
features                  every feature control and its value
ports                     what CoreMIDI currently reports
```

## Talking to it

The device powers up standalone and the surface sends **nothing** until a host claims it:

```
→ F0 00 20 29 02 15 02 00 F7    probe; the device echoes it back
→ F0 7E 7F 06 01 F7             device inquiry; it identifies itself
→ F0 00 20 29 02 15 02 7F F7    claim; it acknowledges
```

`9F 0C 7F` is a shorter alias for the claim; `... 02 00 F7` releases it.

Two things are separate: whether a host has **claimed** the device, and which **surface mode**
is showing. Only a DAW surface reports on the DAW port — select a Custom Mode and the DAW port
goes quiet.

```
B0 0D 05                       colour encoder 1.1 red (channel 1 = colour)
BF 0D 64                       set encoder 1.1's position (channel 16 = position)
B6 6F 40                       LED brightness to 64
B7 6F 00                       query it; replies B6 6F 40
F0 00 20 29 02 15 04 35 41 F7  configure the stationary display
F0 00 20 29 02 15 06 35 00 …   set field 0
F0 00 20 29 02 15 04 35 7F F7  commit it — without this, nothing appears
```

Full control map in [`spec/lcxl3-daw-cc-map.json`](spec/lcxl3-daw-cc-map.json), all 128 palette
colours in [`spec/lcxl3-palette.json`](spec/lcxl3-palette.json).

## What emulating it faithfully means

Not just the CC map. The parts a mock would skip are the parts that bite:

- **Fader pickup** — a fader under pickup emits nothing until it catches its parameter. The
  panel draws the gap as a dashed target line.
- **Relative encoders**, per row, pivot 64, CC index +64 — and they keep reporting at the ends
  of the range, because an endless encoder has no ends.
- **Touch events** bracketing any handling of a continuous control, on the relative CC when a
  row is switched over.
- **Shift** previewing an encoder without turning it, and latching on a double press.
- **The screen**: four text arrangements, per-control temporary displays that raise themselves
  when you move something, the timeout, and the commit requirement.
- **Mode reporting**, including the undocumented CC 31 that marks a change as the *user's*
  rather than the host's.

## Verifying against hardware

The emulator began as 29 inferences the documents don't settle. Each is registered with its
source, its consequence, and a sweep step that probes it:

```bash
npm run verify -- assumptions   # every claim, its status, and what hardware did
npm run verify -- steps         # the sweep, and what each step probes
```

With the device connected:

```bash
npm run bridge -- start                                          # terminal 1, deviceId 2
npm run verify -- run --target emulator --device-id 2 --settle 1200 \
  --out traces/emulator.jsonl

# stop the bridge, then:
npm run verify -- run --target hardware --device-id 1 --settle 1200 \
  --out traces/hardware.jsonl

npm run verify -- diff traces/emulator.jsonl traces/hardware.jsonl
```

The diff names the assumptions the hardware contradicted, not byte offsets. Steps needing a
hand on the device prompt you; the emulator performs the same steps as gestures, so one sweep
definition covers both sides. Steps producing no MIDI — is palette 0 off or grey, what does a
cold screen show — ask you to look.

### What the hardware corrected

Confirmed, among others: channel 1 means colour and channel 16 means position (the most
load-bearing guess in the project); the entire CC map including button ordering read off a
picture in the PDF; pickup; relative encoders; the identity reply.

Refuted, and since fixed:

| | The documents implied | The hardware does |
|---|---|---|
| Palette 0 | dim grey `#616161` | turns the LED **off** |
| LEDs on release | cleared | **survive** |
| Touch events | the Shift gesture only | brackets **any** handling |
| Shift + move a fader | silent | still transmits — the cap moved |
| Encoder curve | fixed multiplier | **acceleration** (+1, +2, +4 by speed) |
| Device inquiry | DAW port only | **both**, with the interface in the member byte |
| Claim | reports a mode | acknowledgement only |
| Host mode select | not echoed | **reported**, like any other |
| Feature queries | always answered | **gated** behind `9F 0B 7F` in standalone |

Undocumented behaviour found along the way:

- **CC 31 (`B6 1F`)** follows the CC 30 mode report, same value, but *only* when the change
  came from the device — the user pressing Mode, or a release. Host-driven selects get CC 30
  alone. That's how a DAW tells its own command from the user reaching over.
- **Host text must be committed** with `04 <target> 7F`. Without it the screen stays blank.
- **Bitmaps (command `09`) appear unimplemented.** Nine attempts across four framings and five
  device states drew nothing and drew no acknowledgement on firmware 1.1. Novation's own
  Bitwig integration ships a complete text-display package and no bitmap code; the v1.1
  release notes mention screen changes but never custom graphics. The guide documents the
  feature in full. Re-test with `scripts/bitmap-probe.mjs` after a firmware update.

## Development

```bash
npm test           # unit tests plus a real CoreMIDI round-trip
npm run typecheck
npm run gen:spec   # regenerate typed constants from spec/*.json
```

`spec/*.json` is the source of truth for the protocol. Edit the JSON, run `gen:spec`, and the
typed constants in `@lcxl3/core` follow; a shape mistake fails the typecheck.

## Packages

- **`@lcxl3/core`** — the device model. Pure and synchronous: bytes and gestures in, bytes and
  state out. No I/O, no timers (time is passed to `tick`), so it runs in a browser, in the
  bridge, or in a test with nothing attached.
- **`@lcxl3/bridge`** — virtual CoreMIDI ports, traffic log, trace recorder, panel server.
- **`@lcxl3/panel`** — the browser surface. A view only: it sends gestures and renders state,
  and never decides what goes on the wire.
- **`@lcxl3/verify`** — the assumption register, the sweep, and the trace diff.

The device model lives in the bridge, never in the browser: the emulator has to answer a
device inquiry whether or not a tab is open, and that's what makes it testable headlessly.

## Documents

`node scripts/fetch-docs.mjs` downloads Novation's manuals into `spec/reference/` — they
aren't committed. The extracted text and the two table images are, because the CC map and the
colour palette are *pictures* in the original rather than text, and the code derives from them.

- [Programmer's Reference Guide v1.0](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/launch_control_xl_3_programmer_s_reference_guide-pdf_en.pdf)
- [User Guide v2.0](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/launch_control_xl_3-pdf-en.pdf) — settles several things the programmer's reference leaves ambiguous
- [audiocontrol/launch-control-xl3](https://github.com/audiocontrol-org/audiocontrol/blob/main/modules/launch-control-xl3/docs/PROTOCOL.md) — reverse-engineered custom-mode protocol and handshake traces
