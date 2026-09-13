#!/usr/bin/env node
/**
 * Follow-up probe — closes the three questions the full sweep left open.
 *
 *   A. Do the buttons emit at all? The sweep produced 2902 messages and every
 *      one was on channel 16. The button CC map has no evidence behind it.
 *   B. Does text need an open/commit bracket? The sweep configured a display and
 *      set two fields and nothing appeared. Live's capture brackets it.
 *   C. Does an encoder adopt a position the host sends? Nothing observable
 *      distinguishes "adopted silently" from "ignored" — unless you then turn it.
 *
 *   node --experimental-strip-types scripts/followup-probe.mjs
 */
import { createInterface } from 'node:readline/promises';
import { writeFileSync } from 'node:fs';
import { Input, Output } from '@julusian/midi';
import { controlForCC, decode, toHex } from '../packages/core/src/index.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sysex = (...body) => [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, ...body, 0xf7];
const ascii = (t) => [...t].map((c) => c.charCodeAt(0));

const input = new Input();
input.ignoreTypes(false, false, false);
let seen = [];
input.on('message', (_d, m) => seen.push([...m]));
input.openPortByName('LCXL3 1 DAW Out');

const output = new Output();
output.openPortByName('LCXL3 1 DAW In');
await sleep(300);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);
const send = async (bytes, ms = 200) => {
  output.sendMessage(bytes);
  await sleep(ms);
};
const transcript = [];
const record = (label, messages, note) => transcript.push({ label, messages: messages.map(toHex), note });

console.log('\n=== Follow-up probe ===\n');

await send(sysex(0x02, 0x7f), 400); // claim
await send([0xb6, 0x1e, 0x02], 400); // DAW Control explicitly
seen = [];
await send([0xb7, 0x1e, 0x00], 400); // ...and read it back
const mode = seen.find((m) => m[0] === 0xb6 && m[1] === 0x1e);
console.log(`Surface mode reported as: ${mode ? toHex(mode) : 'NO REPLY'}`);
record('mode-check', seen);

// ---------------------------------------------------------------- A. buttons
console.log('\n--- A. Buttons ---');
console.log('Press these, one at a time, taking your time:');
console.log('  the 8 TOP buttons left to right');
console.log('  the 8 BOTTOM buttons left to right');
console.log('  Solo/Arm, Mute/Select, then Track < >, Page ^ v, Record, Play');
console.log('  and finally Shift');
seen = [];
await ask('\nPress Enter when you have pressed them all: ');
const buttons = seen.slice();
record('buttons', buttons);

const channels = new Set();
const indices = new Set();
for (const m of buttons) {
  if (m.length === 3 && (m[0] & 0xf0) === 0xb0) {
    channels.add((m[0] & 0x0f) + 1);
    indices.add(m[1]);
  }
}
console.log(`\n  ${buttons.length} messages, channels seen: ${[...channels].sort((a, b) => a - b).join(', ') || 'none'}`);
console.log(`  CC indices: ${[...indices].sort((a, b) => a - b).join(', ') || 'none'}`);
for (const m of buttons.slice(0, 40)) {
  const d = decode(m, 'fromDevice');
  const known = m.length === 3 ? controlForCC((m[0] & 0x0f) + 1, m[1]) : undefined;
  console.log(`    ${toHex(m).padEnd(12)} ${d.summary}${known ? '' : '   <-- not in our map'}`);
}

// ------------------------------------------------------------ B. display text
console.log('\n--- B. Display text ---');

seen = [];
await send(sysex(0x04, 0x35, 0x41));
await send(sysex(0x06, 0x35, 0x00, ...ascii('NOCOMMIT')));
await send(sysex(0x06, 0x35, 0x01, ...ascii('one')), 1500);
const b1 = await ask('  B1 (no commit) — anything on the screen? ');
record('text-no-commit', seen, b1);

seen = [];
await send(sysex(0x04, 0x35, 0x41));
await send(sysex(0x06, 0x35, 0x00, ...ascii('COMMIT')));
await send(sysex(0x06, 0x35, 0x01, ...ascii('two')));
await send(sysex(0x04, 0x35, 0x7f), 1500);
const b2 = await ask('  B2 (committed with 04 35 7F) — anything now? ');
record('text-commit', seen, b2);

seen = [];
await send(sysex(0x04, 0x36, 0x62));
await send(sysex(0x06, 0x36, 0x01, ...ascii('LIVE STYLE')));
await send(sysex(0x04, 0x36, 0x7f), 1500);
const b3 = await ask('  B3 (Live\'s exact pattern, target 0x36) — anything now? ');
record('text-live-pattern', seen, b3);

// -------------------------------------------------- C. encoder position adopt
console.log('\n--- C. Does an encoder adopt a host-sent position? ---');
await send([0xb6, 121, 0], 300); // slow curve, so one click is one unit
seen = [];
await send([0xbf, 0x0d, 100], 600); // park encoder 1.1 at 100
console.log('  Sent BF 0D 64 — encoder 1.1 position to 100.');
seen = [];
await ask('  Now turn encoder 1.1 exactly ONE CLICK CLOCKWISE, then press Enter: ');
const turns = seen.filter((m) => m.length === 3 && m[1] === 0x0d);
record('encoder-adopt', seen);
console.log(`  encoder 1.1 emitted: ${turns.map(toHex).join(' | ') || 'nothing'}`);
if (turns.length) {
  const v = turns[0][2];
  console.log(v >= 99 && v <= 103
    ? `  -> ${v}: it ADOPTED the position the host sent.`
    : `  -> ${v}: it did NOT adopt; it carried on from its own position.`);
}

await send(sysex(0x02, 0x00), 300);
rl.close();
input.closePort();
output.closePort();

writeFileSync('traces/followup.json', `${JSON.stringify(transcript, null, 2)}\n`);
console.log('\nWrote traces/followup.json');
