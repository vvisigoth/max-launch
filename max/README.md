# Max patches

Two patches for talking to the emulator (or the hardware — they're identical on the wire).

- **`lcxl3.connect.maxpat`** — the abstraction. Claims the device on load, releases it on
  close, and gives you three outlets of `(cc value)` plus an inlet for lighting LEDs.
- **`lcxl3.test.maxpat`** — open this first. Prints everything arriving, lets you poke LEDs by
  hand, and lights a button when you press it, which proves both directions at once.

Put `lcxl3.connect.maxpat` somewhere on Max's search path — beside the device that uses it is
simplest, or `~/Documents/Max 9/Library/`.

## In Max for Live

`lcxl3.connect` is an abstraction, so it drops into an `.amxd` device unchanged. Three things
differ from plain Max, and the abstraction already handles them:

**`loadbang` fires too early.** In a device, `[live.thisdevice]` is the one that bangs when
the device is *fully initialised* — and again on every preset load, which is exactly when you
want to re-claim. Both are wired, so the abstraction works in plain Max too.

**`closebang` is actively wrong.** Max's own reference: it "sends a bang whenever the patcher
**window** within which it resides is closed". In a device that's just you closing the Max
editor — the device is still running, and releasing the controller there would be a mystery to
debug. `[freebang]` fires when the patcher is genuinely freed, which is what you want.

**Disabling the device hands the controller back.** `live.thisdevice`'s middle outlet reports
enable/disable, so switching the device off in Live releases the LCXL3 and switching it on
re-claims it.

### One instance only

Two copies of the device both claim the controller, both receive every control, and removing
either one releases it for both. This is inherent to sharing one surface — nothing in the
protocol arbitrates. Run one instance, or gate the input per-instance on something like the
track's arm state.

### Live will take the port if you let it

If the Launch Control XL 3 is selected as a Control Surface in Live's MIDI preferences, Live
claims the DAW port exclusively and your Max objects see nothing at all. Set that slot to
**None**. This applies to the real hardware; the emulator's ports are only visible to Live if
you've pointed a Control Surface at them.

### `midiin`/`midiout` mean two different things

Bare `[midiout]` in a Max MIDI Effect sends to Live's device chain — that's the one your
sequencer already uses to play notes. `[midiout "LCXL3 1 DAW In"]` with a port argument
addresses that port instead ("transmits raw MIDI data to a specified port", per the reference).
They coexist; just don't confuse which is which when patching.

## Using it

```
npm run bridge -- start        # in the repo
```

Then open `lcxl3.test.maxpat`. The browser panel's badge should flip to **claimed** about
300 ms after the patch loads. Move a fader in the panel and the Max console shows
`ch16: 5 <value>`.

**If nothing arrives**, it's almost always one of three things:

1. **The device isn't claimed.** The surface sends nothing until a host claims it — that's
   faithful, not a bug. `lcxl3.connect` does it on load; check the panel badge.
2. **Max can't resolve the port name.** `[ctlin "LCXL3 1 DAW Out" 16]` relies on Max accepting
   a quoted multi-word port name. If it doesn't, open Max's MIDI Setup, note the abbreviation
   letter Max assigned the port, and use that instead: `[ctlin a 16]`.
3. **Live has the port.** In Max for Live, if the Launch Control XL 3 is selected as a Control
   Surface in Live's MIDI preferences, Live takes the DAW port exclusively and Max objects see
   nothing. Set that slot to **None**.

## The three outlets

Everything comes out as a 2-element list, `(cc value)`, ready for `[route]`:

| Outlet | Channel | Carries |
|---|---|---|
| 0 | 16 | faders `5–12`, encoders `13–36` |
| 1 | 1 | buttons `37–52`, Solo/Arm `65`, Mute/Select `66`, Track `103`/`102`, Page `106`/`107`, Record `118`, Play `116` |
| 2 | 7 | Shift `63`, surface mode `30`, and `31` when the *user* changed mode rather than you |

## LEDs

Send `(index colour)` to the inlet. The index is the control's own CC number, so button 1 is
`37` and encoder 1.1 is `13`:

```
13 5     encoder 1.1 red
37 21    button top 1 green
13 0     off
```

Colour is a palette index, 0–127 — all of them are in
[`../spec/lcxl3-palette.json`](../spec/lcxl3-palette.json). Index 0 turns an LED off.

Faders have no LEDs. Shift is excluded by the hardware.

## Mapping a 16-step sequencer

The surface fits a 16-step sequencer almost exactly — two rows of eight buttons *are* sixteen
steps:

| What | Control | CC |
|---|---|---|
| Steps 1–8 on/off | top button row | `37–44` |
| Steps 9–16 on/off | bottom button row | `45–52` |
| NOTE, steps 1–8 | encoder row 1 | `13–20` |
| NOTE, steps 9–16 | encoder row 2 | `21–28` |
| DUR, steps 1–8 | encoder row 3 | `29–36` |
| DUR, steps 9–16 | faders | `5–12` |

Which keeps "top is 1–8, bottom is 9–16" consistent across buttons and encoder pairs.

For the LEDs, two things are worth showing: whether a step is on, and where the playhead is.
Feed `[counter 0 15]` into a `[pack 0 0]` that sends `(36 + step)` with a bright colour, and
repaint the step it just left in its on/off colour.

A note on the encoders: they're endless, and in absolute mode they adopt whatever position you
send them. So if you send a step's current NOTE back to its encoder when you change steps or
pages, the encoder picks it up and won't jump the next time it's turned. Same CC, channel 16:

```
13 60    encoder 1.1 now sits at 60
```

Careful not to confuse that with LED colouring, which uses the *same index* on channel 1. The
channel is the only thing separating them.
