// Renders atlas-film.html to a video, frame by frame, so playback speed never drops frames.
// Usage: node render-film.mjs atlas-film.html atlas-film.mp4 [fps=60] [from=0] [to=duration]
// Needs: npm i playwright && npx playwright install chromium, plus ffmpeg on PATH.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [input = 'atlas-film.html', output = 'atlas-film.mp4', fpsArg = '60', fromArg, toArg] = process.argv.slice(2);
const fps = Number(fpsArg);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.resolve(input)).href + '?export=1');
await page.waitForFunction(() => window.__atlasFilm);
await page.evaluate(() => window.__atlasFilm.ready);
const duration = await page.evaluate(() => window.__atlasFilm.duration);
const from = fromArg ? Number(fromArg) : 0;
const to = toArg ? Number(toArg) : duration;
const frames = Math.round((to - from) * fps);

const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
], { stdio: ['pipe', 'inherit', 'inherit'] });

for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.__atlasFilm.render(t), from + i / fps);
  const png = await page.screenshot({ type: 'png' });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % fps === 0) process.stdout.write(`\r${(i / fps).toFixed(0)}s / ${(to - from).toFixed(1)}s`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log(`\nwrote ${output}`);
