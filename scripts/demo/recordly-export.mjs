import { chromium } from 'playwright-core';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';

const exec = promisify(execFile);
const root = await realpath(process.env.RECORDLY_ROOT || '/tmp/lattice-recordly-motion');
const { createServer } = await import(join(root, 'node_modules/vite/dist/node/index.js'));
const out = resolve(process.env.RECORDLY_OUTPUT_DIR || 'artifacts/demo-recordly');
const capture = JSON.parse(await readFile(join(out, 'capture.json'), 'utf8'));
const times = Object.fromEntries(capture.chapters.map(c => [c.name, c.time * 1000]));
const end = capture.duration * 1000;
const source = join(out, 'source.mp4');
const rendered = join(out, 'recordly-render.mp4');
const destination = resolve(process.env.RECORDLY_DESTINATION || 'artifacts/lattice-recordly-demo.mp4');
const zoomRegions = [];
function zoom(startMs, endMs, cx, cy, depth = 3) {
  if (endMs > startMs) zoomRegions.push({ id: `zoom-${zoomRegions.length}`, startMs, endMs, depth, focus: {cx,cy}, mode:'manual' });
}
zoom(1800, times['strictness-slider'] + 1000, .255, .46);
zoom(times['strictness-slider'] + 1600, times['invite-teammate'] - 500, .35, .44);
zoom(times['invite-teammate'] + 500, times['extension-installed'] + 1000, .76, .42);
zoom(times['extension-installed'] + 1700, times['teleported-codebase'] - 1800, .76, .47);
zoom(times['teleported-codebase'] + 800, times['noah-auto-follows-own-agent'] + 700, .72, .73);
zoom(times['noah-auto-follows-own-agent'] + 900, times['native-live-cursor'] + 500, .72, .42);
zoom(times['native-live-cursor'] + 1100, times['follow-live-edits'] - 1300, .33, .49);
zoom(times['follow-live-edits'] + 1500, times['teammate-guidance'] + 900, .24, .73);
zoom(times['teammate-guidance'] + 1800, times['finished-live-change'] - 3000, .20, .46, 2);
zoom(times['finished-live-change'] + 900, times['maya-auto-follows-own-agent'] + 650, .22, .73);
zoom(times['maya-auto-follows-own-agent'] + 900, times['noah-follows-maya'] - 2100, .23, .46);
zoom(times['noah-follows-maya'] - 1800, times['noah-follows-maya'] + 800, .79, .48);
zoom(times['noah-follows-maya'] + 1800, times['both-people-contributed'] - 2000, .72, .43, 2);
zoom(times['both-people-contributed'] + 800, times['review-pull-request'] + 1600, .28, .50);
zoom(times['review-pull-request'] + 2200, times['pr-ready-for-review'] - 3000, .28, .46, 2);

const editor = {
  wallpaper: '#000000', showShadow: false, shadowIntensity: 0, backgroundBlur: 0,
  zoomMotionBlur: .12, connectZooms: true, zoomInDurationMs: 850, zoomOutDurationMs: 950,
  connectedZoomDurationMs: 1100, connectedZoomGapMs: 1600, zoomInOverlapMs: 120,
  zoomInEasing: 'recordly', zoomOutEasing: 'recordly', connectedZoomEasing: 'glide',
  zoomSmoothness: .65, borderRadius: 1.4,
  padding: {top: 16,bottom: 16,left: 16,right: 16,linked:true},
  cropRegion: {x:0,y:0,width:1,height:1}, zoomRegions, trimRegions: [], speedRegions: [],
  showCursor: true, loopCursor: false, cursorStyle: 'macos', cursorSize: 2.4,
  cursorSmoothing: .67, cursorSpringStiffnessMultiplier: .92,
  cursorSpringDampingMultiplier: 1.36, cursorSpringMassMultiplier: 1.29,
  cursorMotionBlur: .15, cursorClickBounce: 1.5, cursorClickBounceDuration: 350,
  cursorSway: .2, cursorClickEffect: 'none',
  aspectRatio: '16:7', mp4FrameRate: 60, exportQuality: 'high', exportFormat: 'mp4',
  exportEncodingMode: 'quality', exportBackendPreference: 'webcodecs', exportPipelineModel: 'legacy',
};
await writeFile(join(out, 'lattice.recordly'), JSON.stringify({version:2,videoPath:source,editor},null,2));

let browser;
const handler = async (req,res,next) => {
  try {
    if (req.url === '/lattice-export') { res.setHeader('Content-Type','text/html'); res.end('<html><body style="margin:0;background:black"></body></html>'); return; }
    if (req.url === '/lattice-source.mp4') {
      const {size}=await stat(source); const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      const start=range?Number(range[1]):0, stop=range&&range[2]?Math.min(Number(range[2]),size-1):size-1;
      res.writeHead(range?206:200,{'Content-Type':'video/mp4','Content-Length':stop-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${stop}/${size}`}:{})});
      createReadStream(source,{start,end:stop}).pipe(res); return;
    }
    if (req.url === '/lattice-result' && req.method === 'PUT') { await pipeline(req,createWriteStream(rendered));res.end('saved');return; }
    next();
  } catch(e) { res.statusCode=500;res.end(String(e)); }
};
const server = await createServer({root,configFile:false,resolve:{alias:{'@':join(root,'src')}},plugins:[{name:'lattice-render',configureServer(s){s.middlewares.use(handler)}}],server:{host:'127.0.0.1',port:4318,strictPort:true}});
await server.listen();
try {
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('console',m=>{if(m.type()==='error')console.log('Recordly:',m.text().slice(0,300));});
  page.on('pageerror',e=>console.log('Recordly page:',e.message));
  await page.goto('http://127.0.0.1:4318/lattice-export');
  await page.exposeFunction('reportProgress', p=>console.log(`Recordly render ${p.percentage.toFixed(1)}% (${p.renderFps?.toFixed(0)||'?'} fps)`));
  const result=await page.evaluate(async ({editor,samples})=>{
    const {VideoExporter}=await import('/src/lib/exporter/videoExporter.ts');
    let last=-10;
    const exporter=new VideoExporter({...editor,videoUrl:location.origin+'/lattice-source.mp4',width:2560,height:1120,frameRate:60,bitrate:22000000,
      backendPreference:'webcodecs',preferredRenderBackend:'webgl',maxEncodeQueue:30,cursorTelemetry:samples,
      onProgress:p=>{if(p.percentage>=last+5){last=p.percentage;window.reportProgress(p)}}});
    const result=await exporter.export();
    if(!result.success || !result.blob)throw Error(result.error||'No export blob');
    await fetch('/lattice-result',{method:'PUT',body:result.blob});
    return {success:result.success,bytes:result.blob.size,metrics:result.metrics};
  },{editor,samples:capture.samples});
  await writeFile(join(out,'render-metrics.json'),JSON.stringify(result,null,2));
  await exec('/opt/homebrew/bin/ffmpeg',['-y','-v','error','-i',rendered,'-vf','pad=2560:1440:0:160:black','-an','-c:v','h264_videotoolbox','-b:v','22M','-pix_fmt','yuv420p','-movflags','+faststart',destination],{timeout:600000});
  const manifest = JSON.parse(await readFile(join(out,'manifest.json'),'utf8').catch(()=>'{}'));
  await writeFile(join(out,'manifest.json'),JSON.stringify({...manifest,destination,width:2560,height:1440,frameRate:60,audio:false,duration:result.metrics?.effectiveDurationSec,renderer:'Recordly FrameRenderer + VideoExporter',recordlyRevision:'18884285b11b3603fc4ccede89add40e0e4a9bd6',captureMethod:'ScreenCaptureKit isolated native windows',zoomRegions,cursorSamples:capture.samples.length,project:join(out,'lattice.recordly'),metrics:result.metrics},null,2));
  console.log(JSON.stringify({destination,seconds:end/1000,zoomRegions:zoomRegions.length,renderer:'Recordly',...result}));
} finally { await browser?.close();await server.close(); }
