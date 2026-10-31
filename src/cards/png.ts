import { crc32, deflateSync } from 'node:zlib';

/**
 * Writes an 8-bit palette PNG around already-laid-out rows (each starting with a
 * filter byte). zlib is native code, so even in a new isolate this costs far less
 * than JS loops over this many bytes would. Flat cards shrink to around 25 KB at
 * the lowest compression level, and higher levels cost more CPU for little gain.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function encodePng(rows: Uint8Array, width: number, height: number, palette: Uint8Array): Uint8Array {
  const data = deflateSync(rows, { level: 1 });
  const out = new Uint8Array(SIGNATURE.length + 25 + 12 + palette.length + 12 + data.length + 12);
  const view = new DataView(out.buffer);
  let at = SIGNATURE.length;
  out.set(SIGNATURE);

  /** Writes a chunk's length and type, runs `body` to fill it, then writes its checksum. */
  const chunk = (type: string, length: number, body: () => void) => {
    view.setUint32(at, length);
    at += 4;
    const start = at;
    for (let i = 0; i < 4; i++) out[at++] = type.charCodeAt(i);
    body();
    at = start + 4 + length;
    view.setUint32(at, crc32(out.subarray(start, at)));
    at += 4;
  };

  chunk('IHDR', 13, () => {
    view.setUint32(at, width);
    view.setUint32(at + 4, height);
    out.set([8, 3, 0, 0, 0], at + 8); // 8 bits per pixel, palette, default everything else
  });
  chunk('PLTE', palette.length, () => out.set(palette, at));
  chunk('IDAT', data.length, () => out.set(data, at));
  chunk('IEND', 0, () => {});
  return out;
}
