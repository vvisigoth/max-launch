#!/usr/bin/env node
/**
 * Bitmap probe — watch the device's screen while this runs.
 *
 * Hardware accepts a well-formed 1216-byte bitmap and sends no acknowledgement,
 * in every framing tried. The guide presents that acknowledgement as the clock
 * a host paces animation against, so the question is whether the bitmap draws
 * at all. That is the one thing no script can see.
 *
 * Each stage holds an unmistakable image for eight seconds and announces
 * itself, so you can tell afterwards which ones appeared.
 *
 *   node --experimental-strip-types scripts/bitmap-probe.mjs
 */
import { Input, Output } from '@julusian/midi';
import { packBitmap, SCREEN_HEIGHT, SCREEN_WIDTH } from '../packages/core/src/index.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (b) => [...b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const HOLD_MS = 8000;

const image = (fill) => {
  const px = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) px[y * SCREEN_WIDTH + x] = fill(x, y) ? 1 : 0;
  }
  return packBitmap(px);
};

const SOLID = image(() => true);
const STRIPES = image((_x, y) => Math.floor(y / 6) % 2 === 0);

const sysex = (...body) => [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, ...body, 0xf7];

const input = new Input();
input.ignoreTypes(false, false, false);
let replies = [];
input.on('message', (_d, m) => replies.push(hex(m)));
input.openPortByName('LCXL3 1 DAW Out');

const output = new Output();
output.openPortByName('LCXL3 1 DAW In');
await sleep(300);

const stage = async (label, send) => {
  replies = [];
  console.log(`\n>>> ${label}`);
  console.log('    watch the screen for 8 seconds...');
  for (const bytes of send) {
    output.sendMessage(bytes);
    await sleep(120);
  }
  await sleep(HOLD_MS);
  console.log(`    device replied: ${replies.length ? replies.join(' | ') : 'nothing'}`);
};

console.log('Watch the Launch Control XL 3 screen. Five stages, eight seconds each.');

await stage('1. SOLID WHITE, stationary target (0x20), device claimed', [
  sysex(0x02, 0x7f),
  sysex(0x09, 0x20, ...SOLID),
]);

await stage('2. STRIPES, temporary target (0x21), device claimed', [sysex(0x09, 0x21, ...STRIPES)]);

await stage('3. SOLID WHITE, stationary target, display configured first', [
  sysex(0x04, 0x20, 0x41),
  sysex(0x09, 0x20, ...SOLID),
]);

await stage('4. SOLID WHITE, stationary target, triggered afterwards', [
  sysex(0x09, 0x20, ...SOLID),
  sysex(0x04, 0x20, 0x7f),
]);

await stage('5. SOLID WHITE, device NOT claimed (standalone)', [
  sysex(0x02, 0x00),
  sysex(0x09, 0x20, ...SOLID),
]);

output.sendMessage(sysex(0x02, 0x00));
await sleep(200);
input.closePort();
output.closePort();

console.log('\nDone. Which stages, if any, put something on the screen?');
