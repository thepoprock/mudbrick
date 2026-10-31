/**
 * Screenshot the viewer with a game loaded from `apps/web/dev-game`, using headless Chromium.
 * Needs the dev server running (`npm run dev`) and the dev-game symlink (README "Developing").
 *
 *   npx vite-node scripts/screenshot.ts WWII.SCN out.png [http://localhost:5173] [zoom] [x,y,w,h]
 *
 * The optional clip is in canvas pixels, to inspect a region at full size.
 *
 * Prints any browser console errors, so it also works as a smoke test of the whole web stack.
 */
import { chromium } from 'playwright';

const [, , game, outPath, base = 'http://localhost:5173', zoom = '1', clipArg] = process.argv;
if (!game || !outPath) {
  console.error('usage: screenshot.ts <GAME.SCN|.SAV|.MP> <out.png> [baseUrl] [zoom]');
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${base}/?game=${encodeURIComponent(game)}`);
await page.selectOption('#zoom', zoom);
// Loaded when the headline mentions cities (save) or squares (map) and the canvas has a size.
await page.waitForFunction(
  () => {
    const info = document.getElementById('info')?.textContent ?? '';
    const c = document.getElementById('map') as HTMLCanvasElement | null;
    return (info.includes('cities') || info.includes('squares')) && !!c && c.width > 0;
  },
  undefined,
  { timeout: 20_000 },
);
await page.waitForTimeout(300);
const headline = (await page.textContent('#info'))?.split('\n')[0] ?? '';
const status = (await page.textContent('#status')) ?? '';
// Read the pixels straight out of the canvas: element screenshots only cover the viewport, and
// the canvas is far wider than any window.
const clip = clipArg ? (clipArg.split(',').map(Number) as [number, number, number, number]) : null;
const dataUrl = await page.evaluate((c) => {
  const src = document.getElementById('map') as HTMLCanvasElement;
  const [x, y, w, h] = c ?? [0, 0, src.width, src.height];
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')?.drawImage(src, x, y, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}, clip);
const { writeFileSync } = await import('node:fs');
writeFileSync(outPath, Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'));
const size = await page.evaluate(() => {
  const c = document.getElementById('map') as HTMLCanvasElement;
  return `${c.width}×${c.height}`;
});
console.log(`canvas ${size} px${clip ? `, clip ${clip.join(',')}` : ''}`);
await browser.close();

console.log(headline);
console.log(`status: ${status}`);
if (errors.length) {
  console.error(`${errors.length} console error(s):\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`saved ${outPath}`);
