// Compose the new native captures; keep the native title bars and restore their
// standard controls where macOS substitutes its screen-sharing indicator.
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
const exec=promisify(execFile),out=resolve(process.env.RECORDLY_OUTPUT_DIR || 'artifacts/demo-final');
const c=JSON.parse(await readFile(join(out,'capture.json'),'utf8'));
const duration=c.chapters.find(p=>p.name==='fade-to-black').time;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  // Keep a 4K source so Recordly close-ups retain native text detail.
  const page=await browser.newPage({viewport:{width:2560,height:1440},deviceScaleFactor:1.5});
  const wallpaper=await readFile('/tmp/lattice-recordly-motion/public/wallpapers/sequoia-blue-orange.jpg');
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;width:2560px;height:1440px;background:#090d18 url(data:image/jpeg;base64,${wallpaper.toString('base64')}) center/cover}body:before{content:'';position:absolute;inset:0;background:#070b19;opacity:.42}.shadow{position:absolute;width:1216px;border-radius:8px;background:#161618;box-shadow:0 28px 70px #0009,0 0 0 1px #ffffff22}.name{position:absolute;top:-43px;left:3px;color:#fff;font:600 19px -apple-system,sans-serif;letter-spacing:4px}</style>${c.windows.map((w,i)=>`<div class="shadow" style="left:${w.left}px;top:${w.top}px;height:${w.window.height*w.scale}px"><div class="name">${i?'NOAH':'MAYA'}</div></div>`).join('')}`);
  await page.screenshot({path:join(out,'background.png')});
  await page.setViewportSize({width:69,height:25});
  await page.setContent('<style>body{margin:0;background:#242424;display:flex;align-items:center;gap:7px;padding:7px 8px}i{display:block;width:10px;height:10px;border-radius:50%;background:#ff6058}i:nth-child(2){background:#ffbd2e}i:nth-child(3){background:#28c840}</style><i></i><i></i><i></i>');
  await page.screenshot({path:join(out,'window-controls.png')});
}finally{await browser.close();}
const inputs=c.recorders.flatMap(r=>['-ss',String(Math.max(0,r.offset)),'-i',r.file]);
inputs.push('-framerate','60','-i',join(out,'background.png'),'-framerate','60','-i',join(out,'window-controls.png'));
// ScreenCaptureKit stops emitting frames when a window becomes static. Extend
// only that final unchanged frame through the closing hold; never cut the
// composition at the first window's last screen update.
const filters=c.windows.map((w,i)=>`[${i}:v]scale=1824:-2,setsar=1,fps=60,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${duration}[v${i}]`);
filters.push('[2:v]loop=-1:1:0,setpts=N/(60*TB),setsar=1[bg]','[3:v]loop=-1:1:0,setpts=N/(60*TB),split=2[chrome0][chrome1]');
filters.push(`[bg][v0]overlay=48:${Math.round(c.windows[0].top*1.5)}:shortest=1[a]`);
filters.push(`[a][v1]overlay=1968:${Math.round(c.windows[1].top*1.5)}:shortest=1[b]`);
filters.push(`[b][chrome0]overlay=51:${Math.round((c.windows[0].top+1)*1.5)}:shortest=1[d]`);
filters.push(`[d][chrome1]overlay=1971:${Math.round((c.windows[1].top+1)*1.5)}:shortest=1[out]`);
await exec('/opt/homebrew/bin/ffmpeg',['-y','-v','error','-filter_complex_threads','2',...inputs,'-filter_complex',filters.join(';'),'-map','[out]','-t',String(duration),'-an','-c:v','h264_videotoolbox','-b:v','38M','-pix_fmt','yuv420p','-movflags','+faststart',join(out,'source.mp4')],{timeout:1200000});
const probe=JSON.parse((await exec('/opt/homebrew/bin/ffprobe',['-v','error','-show_entries','format=duration','-of','json',join(out,'source.mp4')])).stdout);
if(Math.abs(Number(probe.format.duration)-duration)>.1)throw Error('Composition does not cover the complete capture timeline');
await writeFile(join(out,'source.mp4.cursor.json'),JSON.stringify({version:1,samples:c.samples}));
await writeFile(join(out,'manifest.json'),JSON.stringify({width:2560,height:1440,frameRate:60,audio:false,sourceDuration:duration,chapters:c.chapters,nativeTitleBars:true,restoredWindowControls:true,real:['native VS Code windows','installed VSIX','local session relay','workspace teleport','provider adapter','live filesystem changes','agent cursors','teammate steering and owner approval','quota handoff and context continuation','tests','Completed dashboard'],scripted:['agent inference','controlled provider quota error','GitHub PR service #184'],captureMethod:'Recordly ScreenCaptureKit isolated native windows'},null,2));
console.log(JSON.stringify({source:join(out,'source.mp4'),duration,nativeTitleBars:true,restoredWindowControls:true}));
