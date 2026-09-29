import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const exec = promisify(execFile);

// Uses Recordly's ScreenCaptureKit helper, adapted to isolated-window capture.
// The desktop and unrelated applications are never included in the recording.
export class RecordlyCapture {
  constructor(out) { this.out = out; this.samples = []; this.agentSamples = []; this.recorders = []; this.windows = []; this.height = process.env.LATTICE_FINAL_DEMO ? 1440 : 1120; }
  async prepare(pages) {
    for (const page of pages) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await cdp.detach();
    }
    await delay(700);
  }
  async start(pages) {
    await this.prepare(pages);
    for (const [i, name] of ['Maya', 'Noah'].entries()) {
      let window;
      for(let attempt=0;attempt<12&&!window;attempt++){
        await pages[i].bringToFront();
        await delay(400);
        const windows = JSON.parse((await exec('/tmp/lattice-recordly-window-list')).stdout);
        window = windows.find(w => (w.appName === 'Code'||w.bundleId === 'com.microsoft.VSCode') && w.windowTitle?.includes(name));
      }
      if (!window) throw Error(`No native window for ${name}`);
      const viewport = await pages[i].evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const scale = 1216 / window.width;
      const layout = { left: i ? 1312 : 32, top: (this.height - window.height * scale) / 2 - (process.env.LATTICE_FINAL_DEMO ? 40 : 0), scale, insetY: window.height - viewport.height, window, viewport };
      this.windows.push(layout);
      await pages[i].bringToFront();
      const file = join(this.out, `native-${Date.now()}-${i}.mp4`);
      const child = spawn('/tmp/lattice-recordly-capture-v2', [JSON.stringify({ windowId: Number(window.id.split(':')[1]), outputPath: file, fps: 60, capturesSystemAudio: false, capturesMicrophone: false })], { stdio: ['pipe', 'pipe', 'pipe'] });
      const rec = { child, file, started: Date.now(), log: '', done: null };
      rec.done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(rec.log))); });
      child.stdout.on('data', b => { rec.log += b; if (String(b).includes('Recording started')) rec.started = Date.now(); });
      child.stderr.on('data', b => { rec.log += b; });
      this.recorders.push(rec);
      const deadline = Date.now() + 25000;
      while (!rec.log.includes('Recording started') && rec.child.exitCode === null && Date.now() < deadline) await delay(150);
      if (!rec.log.includes('Recording started')) throw Error('Native recorder startup: ' + rec.log);
    }
    const deadline = Date.now() + 20000;
    while (this.recorders.some(r => !r.log.includes('Recording started')) && Date.now() < deadline) await delay(150);
    if (this.recorders.some(r => !r.log.includes('Recording started'))) throw Error('Recordly capture did not start: ' + this.recorders.map(r=>r.log).join('\n'));
    for (const rec of this.recorders) if (rec.child.exitCode !== null) throw Error(rec.log);
    this.startTime = Date.now();
    this.samples.push({ timeMs: 0, cx: .23, cy: .53, cursorType: 'arrow', interactionType: 'move' });
    console.log('Recordly native capture:', JSON.stringify(this.windows.map(w => ({ width: w.window.width, height: w.window.height, viewport: w.viewport }))));
    return this.startTime;
  }
  point(side, x, y, down) {
    const w = this.windows[side];
    if (!w) return;
    const next = { timeMs: Date.now() - this.startTime, cx: (w.left + x * w.scale) / 2560, cy: (w.top + (y + w.insetY) * w.scale) / this.height, cursorType: 'arrow', interactionType: down ? 'click' : 'move' };
    const previous = this.samples.at(-1);
    if (!down && next.timeMs - previous.timeMs > 500) this.samples.push({ ...previous, timeMs: next.timeMs - 480, interactionType: 'move' });
    this.samples.push(next);
  }
  agentPoint(side, x, y) {
    const w = this.windows[side];
    if (!w || !this.startTime) return;
    this.agentSamples.push({ timeMs: Date.now() - this.startTime, side, cx: (w.left + x * w.scale) / 2560, cy: (w.top + (y + w.insetY) * w.scale) / this.height });
  }
  async stop(chapters,typingEvents=[]) {
    this.duration = (Date.now() - this.startTime) / 1000;
    for (const rec of this.recorders) rec.child.stdin.end('stop\n');
    await Promise.all(this.recorders.map(r => r.done));
    await writeFile(join(this.out, 'capture.json'), JSON.stringify({ duration: this.duration, height: this.height, windows: this.windows, chapters, samples: this.samples, agentSamples: this.agentSamples, typingEvents, recorders: this.recorders.map(({file,started,log}) => ({file,offset:(this.startTime-started)/1000,log})) }, null, 2));
    if (process.env.LATTICE_FINAL_DEMO) return; // final-compose handles framing once.
    const input = this.recorders.flatMap(r => ['-ss', String(Math.max(0, (this.startTime - r.started) / 1000)), '-i', r.file]);
    const pieces = this.windows.map((w,i) => `[${i}:v]scale=1216:-2,setsar=1,fps=60,setpts=PTS-STARTPTS[v${i}]`);
    if (process.env.LATTICE_FINAL_DEMO) {
      input.push('-loop','1','-i','/tmp/lattice-recordly-motion/public/wallpapers/sequoia-blue-orange.jpg');
      pieces.push(`[2:v]scale=2560:${this.height}:force_original_aspect_ratio=increase,crop=2560:${this.height},eq=brightness=-0.23:saturation=0.8,fps=60,setsar=1[bg]`);
    } else pieces.push(`color=black:s=2560x${this.height}:r=60:d=${this.duration}[bg]`);
    pieces.push(`[bg][v0]overlay=32:${Math.round(this.windows[0].top)}:shortest=1[a]`);
    pieces.push(`[a][v1]overlay=1312:${Math.round(this.windows[1].top)}:shortest=1[out]`);
    this.source = join(this.out, 'source.mp4');
    await exec('/opt/homebrew/bin/ffmpeg', ['-y','-v','error',...input,'-filter_complex',pieces.join(';'),'-map','[out]','-t',String(this.duration),'-an','-c:v','h264_videotoolbox','-b:v','22M','-pix_fmt','yuv420p','-movflags','+faststart',this.source], { timeout: 600000 });
    await writeFile(`${this.source}.cursor.json`, JSON.stringify({ version: 1, samples: this.samples }));
    return this.source;
  }
  abort() { for (const rec of this.recorders) rec.child.stdin.end('stop\n'); }
}
