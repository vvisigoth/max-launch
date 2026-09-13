# Launch Control XL 3 emulator — implementation plan

A browser-driven, byte-faithful emulation of the Novation Launch Control XL 3, exposed to
Max as real CoreMIDI ports so a Max patch cannot tell it apart from the hardware.

**Status:** phases 0–5, 7 and 8's tooling complete. Phase 6 (custom modes) is skipped as optional; phase 8's actual verification needs the hardware. `spec/` holds the verified protocol assets extracted
from Novation's official documentation; `packages/core` and `packages/bridge` are working.
See [README.md](README.md) to run it.

---

## 1. Decisions already made

| Question | Answer |
|---|---|
| Transport | Local Node bridge creating virtual CoreMIDI ports; browser UI over WebSocket |
| Fidelity scope | Full: surface I/O, custom-mode SysEx, DAW handshake, LED + screen |
| Hardware access | Intermittent — build against docs now, verify against captures later |
| UI | Hardware-faithful panel plus a live MIDI traffic log |
| Target port pair | **DAW In/Out** — the patch is a DAW-like host |

### Why DAW mode and not Custom Modes

A Custom Mode is device-resident configuration, not code: a table saying what each of the 24
encoders, 8 faders and 16 buttons emits, authored in Components and written into one of the
device's 16 slots. A Max patch can never *be* a Custom Mode — it is the host on the other end
of the wire.

Standalone (Custom Mode) operation is also a smaller surface than it first appears. The guide
(p.7) says the Page, Track, Record, Play, Solo/Arm and Mute/Select buttons are **unused** in
that mode, and everything on the host-to-device side that this project cares about — LED
colouring, the screen, the feature controls — sits in the DAW-mode chapter, which opens (p.8)
with "only available once DAW mode is enabled" and "accessible through the DAW In/Out (USB)
interface". Custom Modes carry static per-control colours set in Components; host-driven
dynamic LED feedback on the MIDI port is not documented, and the community project lists it
as unresolved.

So DAW mode is both the better-documented path and the smaller one: its CC map is fixed
(already transcribed in `spec/lcxl3-daw-cc-map.json`) and no Custom Mode is needed at all.
The cost is that the patch must claim the device with `F0 00 20 29 02 15 02 7F F7` on startup
and release it on exit.

**Custom-mode SysEx therefore drops off the critical path** — it stays in the plan as the last
phase, and is the right place to stop if effort runs short, since it is also the most
uncertain part of the protocol.

### Why a bridge and not pure Web MIDI

A browser cannot create a MIDI port. Web MIDI only enumerates ports that already exist, so
a page alone can never *be* a device — at best it drives an IAC bus, which shows up in Max
under the wrong name and forces the patch to branch on "is the real hardware here?". A small
Node process using CoreMIDI virtual endpoints appears in Max's port list as `LCXL3 1 DAW Out`,
`LCXL3 1 MIDI In`, and so on. The patch is then genuinely untouched between hardware and
emulator, which is the whole point of the exercise.

---

## 2. What the spec actually says (verified)

Sources are in `spec/reference/`, which holds both the **Programmer's Reference Guide v1.0**
and the **User Guide v2.0** — the user guide settles several things the programmer's reference
leaves ambiguous, so check it before guessing. The primary one is Novation's **Launch Control
XL 3 Programmer's Reference Guide v1.0** (PDF + extracted text + the two table images that carry
the CC map and colour palette, which are pictures rather than text in the original).

### Ports

Six endpoints, named from the *device's* perspective — two bidirectional pairs plus two
host-to-device-only ports:

- **MIDI In / MIDI Out** — Custom Mode traffic and external MIDI input. **Our target.**
- **DAW In / DAW Out** — everything in the guide's DAW-mode chapter.
- **To DIN Out / To DIN Out 2** — host-to-DIN-jack passthrough, host-to-device only.

There is no DIN *input* endpoint: the DIN in stream is merged into the USB MIDI Out port when
the active Custom Mode asks for it, which is a routing option rather than a port.

A community capture against real hardware on macOS names the DAW pair `LCXL3 1 DAW In` and
`LCXL3 1 DAW Out`; the `1` is the device ID, settable 1–8 in the bootloader. The other four
names follow that pattern but are unconfirmed, so they live in config (§4 phase 1).

### SysEx framing

```
F0 00 20 29 02 15 <cmd> [payload...] F7
   └── Focusrite/Novation ──┘
       manufacturer ID       product family 02 15
```

Commands used: `01 53` RGB colour, `02` DAW mode on/off, `04` configure display,
`06` set display text, `09` bitmap (with an ACK the host can pace animation against).

### DAW-mode control map

Transcribed to `spec/lcxl3-daw-cc-map.json`. Summary:

| Control | CC | Channel |
|---|---|---|
| Faders 1–8 | 5–12 | 16 |
| Encoder row 1 / 2 / 3 | 13–20 / 21–28 / 29–36 | 16 |
| Encoder rows in *relative* mode | 77–84 / 85–92 / 93–100 | 16 |
| Button row top / bottom | 37–44 / 45–52 | 1 |
| Solo/Arm, Mute/Select | 65, 66 | 1 |
| Track ◀ / ▶ | 103 / 102 | 1 |
| Page ▲ / ▼ | 106 / 107 | 1 |
| Record / Play | 118 / 116 | 1 |
| Shift | 63 | 7 |
| Mode | — | — |

The same index doubles as the LED address. Relative encoders pivot on 64. Touch events,
when enabled, arrive as CC on channel 15 with the control's own index.

### Colour palette

All 128 palette entries are extracted to `spec/lcxl3-palette.json` by sampling the swatch
image in the official guide. These are the document's rendering of the palette, accurate to
the swatch — good enough to drive the panel, worth re-deriving from hardware photos if you
ever need exact LED output.

### Feature controls

Fourteen CCs on channel 7 (query on channel 8, reply always on 7) covering surface mode
select, per-row relative mode, fader pickup, touch events, LED and screen brightness,
display timeout, global MIDI channel, encoder curve, and DIN thru. Five are non-volatile and
must survive an emulator restart. Full table in `spec/lcxl3-daw-cc-map.json`.

### Not in the official docs

The **custom-mode read/write SysEx** — the protocol Novation Components uses to push
layouts into the 16 slots — is undocumented. It has been reverse-engineered by the
`audiocontrol` project, whose write-up is mirrored at
`spec/reference/community-custom-mode-protocol.md`: read is `F0 00 20 29 02 15 05 00 40
<slot> 02 F7`, write is `... 05 00 45 <slot> ...`, payload is 8-bit data packed to 7-bit via
a Midimunge-style encoder, controls are 7-byte records with length-prefixed labels. Their
own status notes flag mode-name truncation and control-ID exceptions as unresolved. Treat
this as best-effort and gate it behind hardware verification.

---

## 3. Architecture

```
┌──────────────────────┐   WebSocket    ┌──────────────────────────────┐
│  panel (browser)     │◄──────────────►│  bridge (Node)               │
│  - SVG surface       │  gestures →    │  - CoreMIDI virtual ports    │
│  - LED render        │  ← surface     │  - hosts @lcxl3/core         │
│  - 128×64 screen     │    state       │  - static file server        │
│  - traffic log       │                │  - capture/replay recorder   │
└──────────────────────┘                └──────────────┬───────────────┘
                                                       │ CoreMIDI
                                        ┌──────────────▼───────────────┐
                                        │  Max / Max for Live          │
                                        └──────────────────────────────┘
```

Three packages in one npm workspace (no pnpm on this machine; npm 10 workspaces are fine):

**`@lcxl3/core`** — pure TypeScript, zero I/O. The device state machine. Consumes
`(midiBytes, port)` and `(gesture)`; emits `(midiBytes, port)` and a `SurfaceState`
snapshot. Deterministic, synchronous except for explicitly modelled timers.

**`@lcxl3/bridge`** — Node host. Owns the virtual ports, pumps bytes into core, broadcasts
`SurfaceState` diffs over WebSocket, records traces.

**`@lcxl3/panel`** — browser view. Renders `SurfaceState`, sends gestures. Deliberately dumb.

### The one structural rule

**Device state lives in core, inside the bridge process — never in the browser.**

The bridge must answer a device inquiry, ACK a bitmap, and echo a DAW claim with correct
timing whether or not a browser tab is open. Making the panel authoritative would mean your
Max patch's handshake fails when you close the tab, and would make headless conformance
tests impossible. The panel is an input device and a display, nothing more. This also means
the whole emulator is testable with no browser at all, which is what makes §8 work.

---

## 4. Phases

Phases 1–3 are the useful MVP: at the end of phase 3 you can develop a Max patch against the
emulator for anything that isn't screen or custom-mode work.

### Phase 0 — Skeleton ✅
npm workspace, TypeScript strict, vitest. `scripts/gen-spec.mjs` turns `spec/*.json` into
typed constants in `@lcxl3/core` with `satisfies` clauses, so a hand-edit that breaks the
shape fails the typecheck rather than emitting a wrong byte. Everything runs through Node's
native type stripping — no build step, no `dist/`. Vite arrives with the panel in phase 2.

### Phase 1 — Bridge and ports ✅
`@julusian/midi` v3.8.1 on Node 22.13.1, prebuilt binary, no compilation needed. Six virtual
endpoints, not four pairs: the guide (p.5) gives two bidirectional pairs plus two
host-to-device-only DIN passthrough ports, and the DIN *input* is not an endpoint at all —
it is merged into the USB MIDI Out stream when the active Custom Mode asks for it.

Direction inverts crossing into rtmidi: a port the host writes to is something this process
reads, so it is an rtmidi `Input`. `PORT_DIRECTION` in `@lcxl3/core` is the single source of
truth for that. rtmidi also drops SysEx by default, which for this project would be fatal —
`ignoreTypes(false, false, false)` is set on every input.

*Milestone met.* `npm test` includes a real CoreMIDI round-trip: a second rtmidi client opens
each port by name and exchanges bytes with the bridge, SysEx intact. Confirmed separately
that a different **process** enumerates all six under exactly the hardware names.

*Naming risk: retired.* CoreMIDI reports the endpoints undecorated — no client-name prefix.
`lcxl3.config.json` can still override any individual name if Max disagrees.

*Left for you:* the one thing this machine can't check without you — open Max, confirm
`LCXL3 1 MIDI Out` appears in `[midiin]`'s port list, and that `send midiOut B0 05 7F` in
the bridge REPL arrives.

### Phase 2 — Surface model, DAW CC map, panel v1 ✅
`Device` in `@lcxl3/core` is the state machine: gestures and bytes in, bytes and a
`SurfaceState` out, no I/O and no timers, so tests drive it directly. The bridge hosts it and
serves the panel over WebSocket on port 7373; the panel sends gestures and renders state and
traffic, and decides nothing.

Gesture types follow the hardware rather than the UI. Faders carry a value because they are
physical absolute positions; encoders carry a *delta* because they are endless — the guide
gives them a relative output mode, an acceleration curve, and has them pick up position from
the host, none of which describe a potentiometer. The device tracks where each encoder is.

Standalone mode is silent, faithfully: surface output there comes from a Custom Mode this
emulator does not carry. The panel says so in a banner rather than leaving you wondering.

*Borrowed from phase 4:* the DAW mode enable/disable messages (SysEx `02` and the `9F 0C`
note alias), because without them phase 2 has no demonstrable milestone. The rest of the
handshake — device inquiry, claim acknowledgement, mode reporting, feature controls — is
still phase 4.

*Milestone met.* An end-to-end run confirms a gesture in the browser arrives as the right
bytes at a host reading `LCXL3 1 DAW Out`: fader → `BF 05 7F`, encoder → `BF 17 2A`, button
→ `B0 29 7F` / `B0 29 00`, Shift → `B6 3F 7F`, and nothing at all while standalone.

### Phase 3 — LED and colour engine ✅
`B0h <index> <palette>` and the `01 53` RGB SysEx, rendered onto the panel from
`spec/lcxl3-palette.json`. Position feedback landed here too, since it shares the same
control indices and had to be told apart from colour.

**The channel is what separates a colour from a position.** Both use the same control index,
and the guide gives no other discriminator: colouring is written as `B0h` (channel 1) while
encoders and faders report on channel 16, and encoders separately "pick up" position the DAW
sends. Channel 1 is therefore read as colour and channel 16 as position. This is an
inference, not something the guide states, and it is the single most likely thing in the
emulator to be wrong — it is first on the phase 8 list. An earlier draft of this plan said to
accept colour on both channels; that turns out to be unimplementable, because it makes the
two meanings indistinguishable.

Position the host sends is adopted silently and never echoed — echoing would loop through any
patch that mirrors its own state.

**Two states, not one, for an unlit LED.** Whether palette index 0 means "off" or the dim
grey `#616161` the guide's own swatch draws is unclear. Rather than guess, an LED the host
has never addressed has no entry at all, so "untouched" stays distinguishable from "set to 0"
and the ambiguity resolves with one fixture in phase 8 instead of a rewrite.

Leaving DAW mode drops every LED, on the reasoning that the surface returns to a Custom Mode
whose colours this emulator does not carry.

*Milestone met.* A host painting the three encoder rows, both button rows, the side column
and an RGB SysEx on Record produces the right colours on the panel, and moving an encoder
from the host moves its pointer.

### Phase 4 — Handshake, modes, feature controls ← next

DAW probe echo, Universal Device Inquiry response
(`F0 7E 00 06 02 00 20 29 48 01 00 01 01 01 0B 39 F7`), DAW claim and its acknowledgement,
the `9F 0C 7F` note alias, mode select and *reporting* on CC 30 channel 7, and the full
feature-control table including channel-8 queries and persistence for the five non-volatile
entries.

Mode *reporting* is the easy thing to skip and the expensive thing to skip: the guide is
explicit that a DAW should follow mode changes the user initiates. Emulating it is how you
find out your patch doesn't.

*Milestone:* a Max patch that does full device detection connects, and the panel shows
"DAW mode" without the patch being modified.

128×64 monochrome. Configure-display (`04`), text fields (`06`) with the four documented
arrangements and the four reassigned control characters (empty box, filled box, flat, heart),
bitmap (`09`) with the 19-bytes-per-row 7-bit packing and — importantly — the ACK, since
that is the host's animation clock. Temporary-display timeout from CC 113, brightness from
CC 112, and the auto-on-change / auto-on-touch config bits.

### Phase 6 — Custom modes (optional, last)
Midimunge codec with round-trip property tests. Slot read/write. Import `.syx` files saved
from Components so you can load your real layouts. Standalone mode then derives its entire
output mapping from the loaded custom mode rather than from a hardcoded table — which is
what the hardware does, and the reason standalone mode has no fixed CC map to copy.

Mark this package's fidelity as *unverified* in the UI until phase 8 confirms it.

### Phase 7 — The subtle behaviours ✅
The things that make the emulator worth having rather than a mock. All verified end to end
over CoreMIDI.

**Fader pickup** (CC 70). A fader under pickup emits *nothing* until it catches its parameter:
move it to 40, to 70 — silence — then past 100 and it goes live with `BF 05 69`. The screen
shows the value it has to reach while it is still hunting. Pickup has to be re-earned whenever
the host moves the parameter away. This is the single most common source of "works on the
emulator, not on the hardware", so the gate is real rather than cosmetic.

**Faders and encoders now diverge, and that is the point.** Position feedback on an encoder is
adopted directly — it is endless, so it simply takes the host's value. A fader cannot move
itself, so the host's value lands in a separate `parameters` map and the cap stays where the
user left it. The panel draws the gap as a dashed target line.

**Relative encoders** (CC 69 / 72 / 73), per row: `BF 4E 44` is four steps clockwise on
encoder 1.2, `BF 4E 3E` two anticlockwise, pivot 64, CC index +64. A relative encoder keeps
reporting at the ends of its range, because an endless encoder has no ends — an absolute one
goes quiet there.

**Shift + move is a preview, not a movement.** Grab a control with Shift down and the device
sends `BE <index> 7F` on channel 15, raises that control's display showing the current value,
and *never* emits the control's own CC. Let go and it sends `BE <index> 00`. The value does not
move. This needed two new gestures — `grab` and `letGo` — because the panel is the only thing
that knows when a hand arrives and leaves. Shift latches on a double press inside 400 ms.

**Encoder curve** (CC 121) scales rotation into value, and **LED brightness** (CC 111) dims the
whole surface.

*Unverified, for phase 8:* the curve multipliers (the guide names slow/medium/fast and gives no
ratios — they sit in one table in `behaviours.ts` for exactly this reason), the 400 ms latch
window, and whether a hunting fader really shows its target value on screen.

### Phase 8 — Verify against hardware ✅ (tooling) / ⏳ (the run itself)
The half that does not need the device is built: a scripted sweep, an assumption register, and
a trace diff. `npm run verify -- assumptions` lists all 29; `npm run verify -- steps` lists the
31 sweep steps and which assumptions each probes.

**The assumption register is the real deliverable.** Every inference the emulator rests on used
to be a comment buried in the code. Each is now an entry with a claim, where it came from, and
what a difference would mean — and a test asserts that every one of them is probed by at least
one sweep step, so none can quietly become documentation nobody checks. That test caught a real
gap on its first run.

**One sweep definition drives both sides.** A script cannot turn a knob on real hardware, so
steps that need a hand carry both an instruction for a human and the gesture sequence that
reproduces it on the emulator through the bridge's WebSocket. Without that, every assumption
about what the device *sends* would be untestable.

**Traces align by step, never by timestamp** — two runs on different days will never agree on
timing. Only what the *device* sent is compared; what the host sent is identical by
construction, so a difference there means the two runs used different sweep versions, which the
report says out loud rather than blaming the device.

Some things produce no MIDI at all — whether palette index 0 is off or grey, how long a display
lingers, what a cold device shows. Those are `observe` steps: the operator is asked, and the
answer is recorded in the hardware trace and reproduced in the diff report.

*Verified in both directions:* a trace diffed against itself reports nothing, and a trace with
two injected disagreements names `daw-entry-mode`, `daw-entry-reports` and
`bitmap-ack-terminator` with their sources and consequences.

**When you next have the device:**

```bash
npm run bridge -- start                                          # terminal 1
npm run verify -- run --target emulator --out traces/emulator.jsonl
# stop the bridge — it publishes the same port names as the hardware
npm run verify -- run --target hardware --out traces/hardware.jsonl
npm run verify -- diff traces/emulator.jsonl traces/hardware.jsonl
```

## 5. Max-side notes

- Use `[midiin]`/`[midiout]` with explicit port names, plus `[sysexin]` for SysEx. Take the
  port name from a patcher argument or a `coll` so hardware and emulator swap in one place.
- Max caches its MIDI port list. If a newly created virtual port doesn't appear, reopen the
  MIDI Setup window; occasionally Max needs a restart. Start the bridge before Max.
- **If the target is Max for Live** — and you have Max 9 plus M4L devices in your Ableton
  user library, so it may well be — Live's Control Surface preferences will claim the DAW
  ports if an LCXL3 script is selected there. Set that slot to None while developing against
  the emulator, or the bytes go to Live's script instead of your device. Worth settling
  early, since it changes which port pair your patch should target.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Native module won't build | `@julusian/midi` ships prebuilds for Node 22; fallbacks are `midi`, or a tiny Swift CoreMIDI helper over stdio |
| Virtual port naming differs from hardware | Retire in phase 1; names are config, not constants |
| Custom-mode protocol is reverse-engineered | Isolated in one package, flagged unverified in the UI, gated on phase 8 |
| Palette sampled from a PDF rendering | Fine for the panel; re-derive from hardware if exact output matters |
| Emulator drifts from hardware over firmware updates | Conformance fixtures make drift a failing test rather than a mystery |

## 7. Effort

Rough, assuming familiarity with the stack:

- Phases 0–3 (usable MVP): 2–3 days
- Phase 4 (handshake and modes): 1 day
- Phase 5 (screen): 1–2 days
- Phase 6 (custom modes): 2–3 days, the most uncertain by a distance
- Phase 7 (subtleties): 1 day
- Phase 8 (verification): half a day of work plus however long the device is in front of you

## 8. Open questions

1. **Max or Max for Live?** Changes the port-claiming story in §5 and whether the panel
   should also offer a Live-like host name in the handshake.
2. ~~Which port pair does your patch use~~ — answered: the DAW pair. Custom modes drop to
   last and become optional.
3. **Device ID** — do you run yours as `1`, or has it been changed in the bootloader? It's
   in the port names, and `lcxl3.config.json` sets it.
4. **Does the patch need standalone mode at all?** If it only ever runs as a DAW-like host,
   phase 6 can be dropped entirely rather than merely deferred.

---

## Sources

- [Launch Control XL 3 Programmer's Reference Guide v1.0](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/launch_control_xl_3_programmer_s_reference_guide-pdf_en.pdf) — mirrored in `spec/reference/`
- [Novation user guides: Launch Control XL 3 programmer's reference](https://userguides.novationmusic.com/hc/en-gb/sections/27840433446546-Launch-Control-XL-3-programmer-s-reference-guide)
- [audiocontrol — launch-control-xl3 module](https://github.com/audiocontrol-org/audiocontrol/blob/main/modules/launch-control-xl3/docs/PROTOCOL.md) — reverse-engineered custom-mode protocol and handshake traces
- [Novation downloads: Launch Control XL 3](https://downloads.novationmusic.com/novation/launch-control-xl-3/launch-control-xl-3)
