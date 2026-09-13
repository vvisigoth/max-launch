/**
 * The screen is 128 × 64 monochrome, sent as 19 SysEx bytes per row for 64 rows
 * (1216 bytes total). Seven bits of each byte are pixels, most significant bit
 * leftmost, so 19 bytes cover 133 bit positions of which the last five are
 * unused.
 */
export const SCREEN_WIDTH = 128;
export const SCREEN_HEIGHT = 64;
export const BYTES_PER_ROW = 19;
export const BITMAP_BYTES = BYTES_PER_ROW * SCREEN_HEIGHT;

/** One byte per pixel, row-major, 0 or 1. */
export const unpackBitmap = (data: readonly number[] | Uint8Array): Uint8Array => {
  const pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const rowStart = y * BYTES_PER_ROW;
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const byte = data[rowStart + Math.floor(x / 7)] ?? 0;
      const bit = 6 - (x % 7);
      pixels[y * SCREEN_WIDTH + x] = (byte >> bit) & 1;
    }
  }
  return pixels;
};

/** The inverse, for building test fixtures and for the capture tooling. */
export const packBitmap = (pixels: Uint8Array): number[] => {
  const data = new Array<number>(BITMAP_BYTES).fill(0);
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const rowStart = y * BYTES_PER_ROW;
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      if (pixels[y * SCREEN_WIDTH + x] !== 1) continue;
      const index = rowStart + Math.floor(x / 7);
      data[index] = (data[index] ?? 0) | (1 << (6 - (x % 7)));
    }
  }
  return data;
};

export const bytesToBase64 = (bytes: readonly number[]): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const base64ToBytes = (encoded: string): number[] => {
  const binary = atob(encoded);
  const bytes = new Array<number>(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * ASCII 20h-7Eh, plus four control codes the guide reassigns to characters the
 * device has but ASCII does not. Anything else is rendered as a dot rather than
 * dropped, so a text bug shows up on screen instead of vanishing.
 */
const SPECIAL_CHARACTERS: Readonly<Record<number, string>> = {
  0x1b: '☐',
  0x1c: '■',
  0x1d: '♭',
  0x1e: '♥',
};

export const decodeScreenText = (bytes: readonly number[]): string =>
  bytes
    .map((b) => SPECIAL_CHARACTERS[b] ?? (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '·'))
    .join('');
