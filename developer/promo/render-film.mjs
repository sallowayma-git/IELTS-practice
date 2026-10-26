// Renders atlas-film.html to a video, frame by frame, so playback speed never drops frames.
// Usage: node render-film.mjs atlas-film.html atlas-film.mp4 [fps=60] [from=0] [to=duration]
//        node render-film.mjs atlas-film.html atlas-film.mp4 60 --cut music-cut.json --audio song.mp3
// A cut file retimes the film to a soundtrack: `points` are [videoSeconds, filmSeconds] pairs,
// linearly interpolated (a flat pair is a hold), and `audioStart` is where the song is cut in.
// Needs: npm i playwright && npx playwright install chromium, plus ffmpeg on PATH.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv.splice(i, 2)[1]; };
const cutPath = flag('--cut'), audio = flag('--audio');
const [input = 'atlas-film.html', output = 'atlas-film.mp4', fpsArg = '60', fromArg, toArg] = argv;
const fps = Number(fpsArg);
const cut = cutPath ? JSON.parse(readFileSync(cutPath, 'utf8')) : null;
function filmTime(v) {
  if (!cut) return v;
  const pts = cut.points;
  if (v <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [v0, f0] = pts[i - 1], [v1, f1] = pts[i];
    if (v <= v1) return v1 === v0 ? f1 : f0 + ((v - v0) / (v1 - v0)) * (f1 - f0);
  }
  return pts[pts.length - 1][1];
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.resolve(input)).href + '?export=1');
await page.waitForFunction(() => window.__atlasFilm);
await page.evaluate(() => window.__atlasFilm.ready);
const duration = cut ? cut.duration : await page.evaluate(() => window.__atlasFilm.duration);
const from = fromArg ? Number(fromArg) : 0;
const to = toArg ? Number(toArg) : duration;
const frames = Math.round((to - from) * fps);

const len = to - from;
const audioArgs = [];
if (audio) {
  const start = (cut?.audioStart ?? 0) + from;
  const fadeOut = cut?.audioFadeOut ?? 1.5;
  audioArgs.push('-ss', String(start), '-t', String(len), '-i', audio, '-map', '0:v', '-map', '1:a',
    '-af', `afade=t=in:d=0.12,afade=t=out:st=${Math.max(0, len - fadeOut)}:d=${fadeOut}`, '-c:a', 'aac', '-b:a', '256k', '-shortest');
}
const vf = cut?.videoFadeOut ? ['-vf', `fade=t=out:st=${len - cut.videoFadeOut}:d=${cut.videoFadeOut}`] : [];
const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', ...audioArgs, ...vf,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
], { stdio: ['pipe', 'inherit', 'inherit'] });

for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.__atlasFilm.render(t), filmTime(from + i / fps));
  const png = await page.screenshot({ type: 'png' });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % fps === 0) process.stdout.write(`\r${(i / fps).toFixed(0)}s / ${(to - from).toFixed(1)}s`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log(`\nwrote ${output}`);
