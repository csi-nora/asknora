/**
 * Render CSI Nora 5-minute demo video from the animated HTML deck.
 *
 * Usage (from docs/demo-5min):
 *   npm install playwright
 *   node record-demo.mjs
 *
 * Output: output/csi-nora-5min-demo.mp4 (~5:00)
 */
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'output');
const FRAMES = path.join(OUT, 'frames');
const SLIDES = 5;
const HOLD_SEC = 57;       // hold final frame
const ANIM_FRAMES = 12;    // animated intro per slide
const ANIM_FPS = 6;        // ~2s of motion
const W = 1280, H = 720;

function whichFfmpeg() {
  const r = spawnSync('where', ['ffmpeg'], { encoding: 'utf8', shell: true });
  const line = (r.stdout || '').split(/\r?\n/).find(Boolean);
  return line || 'ffmpeg';
}

async function main() {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const deck = path.join(ROOT, 'index.html');
  const fileUrl = 'file:///' + deck.replace(/\\/g, '/');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

  console.log('Capturing animated slides...');
  for (let s = 0; s < SLIDES; s++) {
    await page.goto(`${fileUrl}?record&slide=${s}&ms=999999`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    // Force-activate slide (URL param already does) and let CSS animations run
    await page.evaluate((n) => window.__deck.show(n), s);
    for (let f = 0; f < ANIM_FRAMES; f++) {
      await page.waitForTimeout(Math.round(1000 / ANIM_FPS));
      const fp = path.join(FRAMES, `s${s}_a${String(f).padStart(2, '0')}.png`);
      await page.screenshot({ path: fp, type: 'png' });
    }
    // Final hold frame
    const hold = path.join(FRAMES, `s${s}_hold.png`);
    await page.screenshot({ path: hold, type: 'png' });
    console.log(`  slide ${s + 1}/${SLIDES}`);
  }

  // Optional live B-roll (app must be up)
  let hasBroll = false;
  try {
    await page.goto('http://localhost:9090/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(FRAMES, 'broll.png'), type: 'png' });
    hasBroll = true;
    console.log('  captured live app B-roll');
  } catch {
    console.log('  (skip B-roll — localhost:9090 not reachable)');
  }

  await browser.close();

  const ffmpeg = whichFfmpeg();
  const clips = [];
  console.log('Encoding slide clips with', ffmpeg);

  for (let s = 0; s < SLIDES; s++) {
    const animList = path.join(OUT, `s${s}_anim.txt`);
    const lines = [];
    for (let f = 0; f < ANIM_FRAMES; f++) {
      const fp = path.join(FRAMES, `s${s}_a${String(f).padStart(2, '0')}.png`).replace(/\\/g, '/');
      lines.push(`file '${fp}'`);
      lines.push(`duration ${1 / ANIM_FPS}`);
    }
    const hold = path.join(FRAMES, `s${s}_hold.png`).replace(/\\/g, '/');
    lines.push(`file '${hold}'`);
    fs.writeFileSync(animList, lines.join('\n'));

    const animMp4 = path.join(OUT, `s${s}_anim.mp4`);
    let r = spawnSync(ffmpeg, [
      '-y', '-f', 'concat', '-safe', '0', '-i', animList,
      '-vsync', 'vfr', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', animMp4,
    ], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(r.stderr);
      throw new Error('ffmpeg anim failed for slide ' + s);
    }

    // Hold last frame
    const holdMp4 = path.join(OUT, `s${s}_hold.mp4`);
    r = spawnSync(ffmpeg, [
      '-y', '-loop', '1', '-i', path.join(FRAMES, `s${s}_hold.png`),
      '-t', String(HOLD_SEC), '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', holdMp4,
    ], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('ffmpeg hold failed for slide ' + s);

    const slideMp4 = path.join(OUT, `s${s}.mp4`);
    const concatSlide = path.join(OUT, `s${s}_list.txt`);
    fs.writeFileSync(concatSlide, [
      `file '${animMp4.replace(/\\/g, '/')}'`,
      `file '${holdMp4.replace(/\\/g, '/')}'`,
    ].join('\n'));
    r = spawnSync(ffmpeg, [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatSlide,
      '-c', 'copy', slideMp4,
    ], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('ffmpeg concat slide failed');
    clips.push(slideMp4);
  }

  if (hasBroll) {
    const broll = path.join(OUT, 'broll.mp4');
    const r = spawnSync(ffmpeg, [
      '-y', '-loop', '1', '-i', path.join(FRAMES, 'broll.png'),
      '-t', '8', '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', broll,
    ], { encoding: 'utf8' });
    if (r.status === 0) clips.splice(2, 0, broll); // after architecture slide
  }

  const listPath = path.join(OUT, 'all.txt');
  fs.writeFileSync(listPath, clips.map(c => `file '${c.replace(/\\/g, '/')}'`).join('\n'));
  const finalMp4 = path.join(OUT, 'csi-nora-5min-demo.mp4');
  const r = spawnSync(ffmpeg, [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', finalMp4,
  ], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr);
    throw new Error('final concat failed');
  }

  // Probe duration
  const probe = spawnSync(ffmpeg, ['-i', finalMp4], { encoding: 'utf8' });
  const dur = /Duration:\s*([\d:.]+)/.exec(probe.stderr || '')?.[1];
  console.log('\nDONE:', finalMp4);
  console.log('Duration:', dur || '(see ffprobe)');
  const mb = (fs.statSync(finalMp4).size / (1024 * 1024)).toFixed(1);
  console.log('Size:', mb, 'MB');
}

main().catch((e) => { console.error(e); process.exit(1); });
