/**
 * Smoke-test the playable mode in headless Chromium: load a save from `apps/web/dev-game`,
 * press Play, give a few orders, end some turns, and report what the page logged. Fails on any
 * browser console error.
 *
 *   npx vite-node scripts/play-smoke.ts TUTORIAL.SAV out.png [http://localhost:5173] [turns]
 */
import { chromium } from 'playwright';

const [, , game, outPath, base = 'http://localhost:5173', turnsArg = '3'] = process.argv;
if (!game || !outPath) {
  console.error('usage: play-smoke.ts <GAME.SAV|.SCN> <out.png> [baseUrl] [turns]');
  process.exit(2);
}
const turns = Number(turnsArg);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => {
  void d.accept(d.defaultValue());
});

await page.goto(`${base}/?game=${encodeURIComponent(game)}`);
await page.waitForFunction(
  () => {
    const info = document.getElementById('info')?.textContent ?? '';
    const c = document.getElementById('map') as HTMLCanvasElement | null;
    return info.includes('cities') && !!c && c.width > 0;
  },
  undefined,
  { timeout: 30_000 },
);
await page.click('#play');
await page.waitForFunction(
  () => (document.getElementById('status')?.textContent ?? '').includes('Turn'),
  undefined,
  {
    timeout: 10_000,
  },
);
const statusBefore = (await page.textContent('#status')) ?? '';
const unitBefore = (await page.textContent('#unitPanel')) ?? '';

// Exercise a few orders on whatever is selected: move, fortify, next unit, then end turns.
await page.click('#info'); // keyboard focus away from the header controls
// Found a city with the first unit (the name prompt is auto-accepted), then end turns.
const keys = ['ArrowUp', 'b'];
for (const k of keys) {
  await page.keyboard.press(k);
  await page.waitForTimeout(60);
}
for (let i = 0; i < turns; i++) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}
await page.waitForTimeout(300);

const statusAfter = (await page.textContent('#status')) ?? '';
const cityPanel = (await page.textContent('#cityPanel')) ?? '';
const unitAfter = (await page.textContent('#unitPanel')) ?? '';
const log = (await page.textContent('#log')) ?? '';
const research = (await page.textContent('#researchPanel')) ?? '';
await page.screenshot({ path: outPath });
await browser.close();

console.log(`before: ${statusBefore}`);
console.log(`unit:   ${unitBefore.split('\n')[0] ?? ''}`);
console.log(`after:  ${statusAfter}`);
console.log(`unit:   ${unitAfter.split('\n')[0] ?? ''}`);
console.log(`research: ${research.split('\n')[0] ?? ''}`);
console.log('--- city ---');
console.log(cityPanel.trim() || '(no city open)');
console.log('--- log ---');
console.log(log);
if (errors.length) {
  console.error(`${errors.length} console error(s):\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`saved ${outPath}`);
