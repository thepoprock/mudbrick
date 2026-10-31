/**
 * Render an original .MP map to a PNG without a browser, using the debug terrain palette.
 * Useful for checking the parser and the isometric coordinate mapping in CI or a terminal.
 *
 *   npx vite-node scripts/render-map.ts /path/to/WORLD.MP out.png [scale]
 *
 * scale = pixels per half-tile step (default 4 → a 150×120 map becomes 604×484).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { DEBUG_TERRAIN_COLOURS, decodeSquare, hexToRgb, parseMap } from '@epochs/formats';

const [, , inPath, outPath, scaleArg] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: render-map.ts <map.MP> <out.png> [scale]');
  process.exit(2);
}
const scale = Number(scaleArg ?? 4);

const map = parseMap(new Uint8Array(readFileSync(inPath)));
const width = (map.columns * 2 + 1) * scale;
const height = (map.rows + 1) * scale;
const rgb = new Uint8Array(width * height * 3);

function fillDiamond(cx: number, cy: number, half: number, colour: [number, number, number]) {
  for (let dy = -half; dy <= half; dy++) {
    const span = half - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      rgb.set(colour, (y * width + x) * 3);
    }
  }
}

for (let y = 0; y < map.rows; y++) {
  for (let c = 0; c < map.columns; c++) {
    const s = decodeSquare(map, y * map.columns + c);
    const cx = (2 * c + (y & 1) + 1) * scale;
    const cy = (y + 1) * scale;
    fillDiamond(cx, cy, scale, hexToRgb(DEBUG_TERRAIN_COLOURS[s.terrain] ?? '#ff00ff'));
    if (s.river) fillDiamond(cx, cy, Math.max(1, scale >> 2), [74, 163, 255]);
  }
}
for (const p of map.startPositions) {
  if (p) fillDiamond((p.x + 1) * scale, (p.y + 1) * scale, Math.max(2, scale >> 1), [255, 59, 59]);
}

// Minimal PNG encoder: 8-bit RGB, one IDAT chunk.
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const raw = new Uint8Array((width * 3 + 1) * height);
for (let y = 0; y < height; y++) {
  raw[y * (width * 3 + 1)] = 0; // filter: none
  raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
}
const ihdr = new Uint8Array(13);
const iv = new DataView(ihdr.buffer);
iv.setUint32(0, width);
iv.setUint32(4, height);
ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', new Uint8Array(deflateSync(raw))),
  chunk('IEND', new Uint8Array(0)),
]);
writeFileSync(outPath, png);
console.log(
  `${inPath}: ${map.header.widthX2}×${map.rows}, ${map.header.area} squares → ${outPath} (${width}×${height})`,
);
