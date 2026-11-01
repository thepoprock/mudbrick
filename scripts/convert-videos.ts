/**
 * Browsers cannot play the original films (Intel Indeo). This turns the player's own copies into
 * MP4 beside the game's files, so the game can show them. It needs ffmpeg, and nothing leaves the
 * machine. The converted films are the player's own and must not be shared or committed.
 *   npx vite-node scripts/convert-videos.ts <folder with the AVI files> <game folder>
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error('usage: convert-videos.ts <avi-folder> <game-folder>');
for (const file of readdirSync(from)) {
  if (!/\.avi$/i.test(file)) continue;
  const name = file.replace(/\.avi$/i, '').toUpperCase();
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      join(from, file),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      join(to, `${name}.mp4`),
    ],
    { stdio: 'inherit' },
  );
  console.log(name);
}
