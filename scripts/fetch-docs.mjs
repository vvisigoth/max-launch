#!/usr/bin/env node
/**
 * Pulls Novation's manuals into spec/reference/.
 *
 * They are not committed — 29 MB of someone else's copyrighted PDFs is a lot to
 * carry, and they are a click away from Novation. The extracted text and the
 * two table images ARE committed, because the code derives from them: the CC
 * map and the 128-colour palette are pictures in the original, not text.
 *
 *   node scripts/fetch-docs.mjs
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const BASE = 'https://fael-downloads-prod.focusrite.com/customer/prod/downloads';

const DOCS = [
  ['launch_control_xl_3_programmer_s_reference_guide-pdf_en.pdf', 'programmers-reference-v1.0.pdf'],
  ['launch_control_xl_3-pdf-en.pdf', 'user-guide-v2.0.pdf'],
];

await mkdir('spec/reference', { recursive: true });

for (const [remote, local] of DOCS) {
  const url = `${BASE}/${remote}`;
  process.stdout.write(`fetching ${local} ... `);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    console.log(`FAILED (${response.status})\n  ${url}`);
    continue;
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(`spec/reference/${local}`));
  console.log('done');
}

console.log('\nBoth are also linked from https://downloads.novationmusic.com/novation/launch-control-xl-3/launch-control-xl-3');
