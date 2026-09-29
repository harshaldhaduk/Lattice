// Fresh native footage, Recordly camera/cursor renderer, then kinetic typography.
// No screenshot loops: every rendered frame is decoded from the native video.
import { chromium } from 'playwright-core';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWindowLayout, remapWindowPoint } from './window-layout.mjs';

const root = await realpath('/tmp/lattice-recordly-motion');
const { createServer } = await import(join(root, 'node_modules/vite/dist/node/index.js'));
const out = resolve(process.env.RECORDLY_OUTPUT_DIR || 'artifacts/demo-final');
const capture = JSON.parse(await readFile(join(out, 'capture.json'), 'utf8'));
const times = Object.fromEntries(capture.chapters.map(c => [c.name,c.time*1000]));
const end = times['fade-to-black'];
const renderEnd=Number(process.env.RECORDLY_PREVIEW_END_MS)||end;
const source = resolve(process.env.RECORDLY_SOURCE || join(out,'source.mp4'));
const probe=JSON.parse((await promisify(execFile)('/opt/homebrew/bin/ffprobe',['-v','error','-show_entries','format=duration','-of','json',source])).stdout);
if(Number(probe.format.duration)<renderEnd/1000-.1)throw Error('Source video ends before the closing hold; recompose with final-frame padding before exporting');
const overlap = process.env.LATTICE_OVERLAP === '1';
const destination = resolve(process.env.RECORDLY_DESTINATION || (overlap ? 'artifacts/lattice-overlap-demo.mp4' : 'artifacts/lattice-final-demo.mp4'));
const trackStart = capture.cameraTrack?.start || times['cursor-tracking-start'];
const trackEnd = capture.cameraTrack?.end || times['cursor-tracking-end'];
const layout = overlap ? createWindowLayout(capture) : null;
let samples = capture.samples;
const clicks = capture.samples.filter(p => p.interactionType === 'click' && p.timeMs < end-6500);
if (layout) {
  const dense=[]; let i=0;
  for(let timeMs=0;timeMs<=end;timeMs+=1000/60){
    while(i<samples.length-2&&samples[i+1].timeMs<timeMs)i++;
    const a=samples[i],b=samples[Math.min(i+1,samples.length-1)];
    const u=Math.max(0,Math.min(1,(timeMs-a.timeMs)/Math.max(1,b.timeMs-a.timeMs)));
    const p=remapWindowPoint(layout,a,timeMs),q=remapWindowPoint(layout,b,timeMs);
    dense.push({timeMs,cx:p.cx+(q.cx-p.cx)*u,cy:p.cy+(q.cy-p.cy)*u,cursorType:'arrow',interactionType:'move'});
  }
  for(const click of clicks)dense.push(remapWindowPoint(layout,click));
  samples=dense.sort((a,b)=>a.timeMs-b.timeMs);
}
const zoomRegions = [];
// One camera target for every click, with anticipatory motion and connected pans.
for (let i=0;i<clicks.length;i++) {
  const c=clicks[i], prev=clicks[i-1], next=clicks[i+1];
  let start=Math.max(1400,c.timeMs-1450), stop=Math.min(end-6500,c.timeMs+2100);
  if (prev) start=Math.max(start,(prev.timeMs+c.timeMs)/2);
  if (next) stop=Math.min(stop,(c.timeMs+next.timeMs)/2);
  if (start<trackEnd && stop>trackStart) {
    if(c.timeMs<trackStart) stop=trackStart-100;
    else if(c.timeMs>trackEnd) start=trackEnd+100;
    else continue;
  }
  if(stop<=start) continue;
  zoomRegions.push({id:`click-${i}`,startMs:start,endMs:stop,depth:overlap?2:4,focus:{cx:c.cx,cy:c.cy-.025},mode:'manual'});
}
zoomRegions.push({id:'agent-caret-tracking',startMs:trackStart,endMs:trackEnd,depth:overlap?4:5,focus:{cx:.25,cy:.5},mode:'manual'});
// Hold the actual limit state long enough to read before crossing to Noah.
const quotaStart=times['maya-token-limit']-700;
const handoffClick=clicks.find(c=>c.timeMs>times['maya-token-limit']&&c.cx>.5);
const quotaEnd=times['noah-handoff-notice'] ?? (handoffClick?handoffClick.timeMs-1550:quotaStart+2400);
for(const r of zoomRegions){
  if(r.startMs<quotaStart&&r.endMs>quotaStart)r.endMs=quotaStart-100;
  if(r.startMs>times['returned-to-dashboard'])r.focus.cy=.51;
}
zoomRegions.push({id:'quota-state',startMs:quotaStart,endMs:quotaEnd,depth:overlap?2:4,focus:{cx:.44,cy:.53},mode:'manual'});
if(times['noah-handoff-notice']){
  const noticeStart=times['noah-handoff-notice'];
  for (const r of zoomRegions) {
    if(r.startMs>=noticeStart&&r.startMs<handoffClick.timeMs)r.startMs=handoffClick.timeMs;
  }
  zoomRegions.push({id:'handoff-notification',startMs:noticeStart,endMs:handoffClick.timeMs,depth:overlap?2:4,focus:{cx:.94,cy:.43},mode:'manual'});
}
if(times['session-hover-start'])zoomRegions.push({id:'session-hover',startMs:times['session-hover-start']-400,endMs:times['session-hover-end'],depth:overlap?2:4,focus:{cx:.23,cy:.51},mode:'manual'});
zoomRegions.sort((a,b)=>a.startMs-b.startMs);
const caption = (start,end,title,eyebrow) => ({start,end,title,eyebrow});
const captions = [
  caption(400,6200,'Build together. Right inside VS Code.','LATTICE · ONE EXTENSION'),
  caption(7900,times['strictness-slider']+1800,'Set how closely your agents coordinate.','CREATE A SESSION'),
  caption(times['invite-teammate']-1000,times['extension-installed']+1000,'Invite a teammate. Bring their agent.','INSTALL & JOIN'),
  caption(times['teleported-codebase']-11000,times['teleported-codebase']+2000,'Join the session. Land in the codebase.','SHARED WORKSPACE'),
  caption(times['existing-provider-accounts']+2200,times['maya-auto-follows-own-agent']-700,'Your existing Codex and Claude sign-ins.','NO SEPARATE API KEY SETUP'),
  caption(times['maya-auto-follows-own-agent'],trackStart-300,'Send a prompt. Follow the work live.','AUTOMATIC SENDER VIEW'),
  caption(trackStart+300,trackEnd,'Every edit. As it happens.','LIVE AGENT CURSOR'),
  caption(times['cursor-tracking-end']+1000,times['teammate-guidance']+1200,'Steer your teammate’s running agent.','SHARED DIRECTION'),
  caption(times['guidance-approved']-600,times['finished-live-change']-1400,'A suggestion becomes a live change.','OWNER APPROVAL · SAME AGENT'),
  caption(times['maya-token-limit']-1200,times['noah-handoff-notice'] ?? times['noah-accepts-handoff']-500,'Maya hit her token limit. Pass to Noah.','KEEP THE TASK MOVING'),
  ...(times['noah-handoff-notice']?[caption(times['noah-handoff-notice']+500,times['noah-accepts-handoff']-300,'Pick up the task. Keep the shared context.','NOAH · CONTINUE ON YOUR ACCOUNT')]:[]),
  caption(times['noah-accepts-handoff'],times['maya-follows-noah']+5500,'The task and shared context come with it.','NOAH CONTINUES · HIS ACCOUNT'),
  caption(times['noah-own-prompt']-4500,times['noah-own-prompt']+4500,'Two people. Both moving the work forward.','YOUR AGENT · YOUR PROMPT'),
  caption(times['both-people-contributed']+2000,times['review-pull-request']+2000,'Review the changes. Publish the pull request.','FROM COLLABORATION TO REVIEW'),
  caption(times['completed-branch-and-pr']-1300,times['pr-ready-for-review']+1000,'Completed work. A review-ready PR.','RETURN → COMPLETED → PULL REQUEST'),
  caption(end-5200,end-1400,'Lattice. Build together.','ONE VS CODE EXTENSION'),
];
let speedRegions = [
  {id:'pace',startMs:0,endMs:trackStart,speed:1.5},
  ...(times['noah-handoff-notice']?[
    {id:'pace-two',startMs:trackEnd,endMs:times['maya-token-limit']-1600,speed:1.5},
    {id:'pace-three',startMs:times['noah-accepts-handoff']+700,endMs:end-6000,speed:1.5},
  ]:[{id:'pace-two',startMs:trackEnd,endMs:end-6000,speed:1.5}]),
];
// Preserve the real-time focus trace, slider, and card-hover/fade animations.
const realTimeRanges = [
  [times['dashboard-panel-closed'], times['strictness-slider']+500],
  [times['extension-installed'], times['teleported-codebase']],
  [times['session-hover-start']-500, times['session-hover-end']+500],
].filter(range=>range.every(Number.isFinite));
for (const [start, stop] of realTimeRanges) {
  speedRegions = speedRegions.flatMap(region => {
    if(region.endMs<=start||region.startMs>=stop)return [region];
    return [
      ...(region.startMs<start?[{...region,id:region.id+'-before',endMs:start}]:[]),
      ...(region.endMs>stop?[{...region,id:region.id+'-after',startMs:stop}]:[]),
    ];
  });
}
const editor={
  wallpaper:'#0b101c',showShadow:false,backgroundBlur:0,borderRadius:0,padding:0,
  zoomMotionBlur:.1,connectZooms:true,zoomInDurationMs:760,zoomOutDurationMs:900,
  connectedZoomDurationMs:850,connectedZoomGapMs:800,zoomInOverlapMs:120,
  zoomInEasing:'recordly',zoomOutEasing:'recordly',connectedZoomEasing:'glide',zoomSmoothness:.7,
  cropRegion:{x:0,y:0,width:1,height:1},zoomRegions,
  trimRegions:capture.duration*1000>renderEnd+100?[{id:'tail',startMs:renderEnd,endMs:capture.duration*1000}]:[],
  speedRegions,showCursor:true,loopCursor:false,cursorStyle:'macos',cursorSize:1,
  cursorSmoothing:.7,cursorSpringStiffnessMultiplier:.92,cursorSpringDampingMultiplier:1.36,cursorSpringMassMultiplier:1.29,
  cursorMotionBlur:.12,cursorClickBounce:1.35,cursorClickBounceDuration:320,cursorSway:.15,cursorClickEffect:'none',
  aspectRatio:'16:9',mp4FrameRate:60,exportQuality:'high',exportFormat:'mp4',exportEncodingMode:'quality',exportPipelineModel:'legacy',exportBackendPreference:'webcodecs',
};
await writeFile(join(out,'lattice.recordly'),JSON.stringify({version:2,videoPath:source,editor},null,2));
await writeFile(join(out,'motion-design.json'),JSON.stringify({captions,trackStart,trackEnd,end,zoomRegions,layout,agentSamples:capture.agentSamples,notes:'Typography, dynamic window layout, and caret tracking require final-export.mjs to reproduce.'},null,2));

const handler=async(req,res,next)=>{
  try {
    if(req.url==='/lattice-export'){res.setHeader('Content-Type','text/html');res.end('<html><body style="margin:0;background:#0b101c"></body></html>');return;}
    if(req.url==='/window-layout.mjs'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(resolve('scripts/demo/window-layout.mjs')));return;}
    if(req.url==='/lattice-wallpaper.jpg'){res.setHeader('Content-Type','image/jpeg');createReadStream(join(root,'public/wallpapers/sequoia-blue-orange.jpg')).pipe(res);return;}
    if(req.url==='/lattice-source.mp4'){
      const {size}=await stat(source),r=req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      const start=r?Number(r[1]):0,stop=r&&r[2]?Math.min(Number(r[2]),size-1):size-1;
      res.writeHead(r?206:200,{'Content-Type':'video/mp4','Content-Length':stop-start+1,'Accept-Ranges':'bytes',...(r?{'Content-Range':`bytes ${start}-${stop}/${size}`}:{})});
      createReadStream(source,{start,end:stop}).pipe(res);return;
    }
    if(req.url==='/lattice-result'&&req.method==='PUT'){await pipeline(req,createWriteStream(destination));res.end('saved');return;}
    const proof=req.url?.match(/^\/proof\/(\d+)\.png$/);
    if(proof&&req.method==='PUT'){await pipeline(req,createWriteStream(join(out,`render-proof-${proof[1]}.png`)));res.end('saved');return;}
    next();
  }catch(e){res.statusCode=500;res.end(String(e));}
};
const server=await createServer({root,configFile:false,resolve:{alias:{'@':join(root,'src')}},plugins:[{name:'lattice-final',configureServer(s){s.middlewares.use(handler)}}],server:{host:'127.0.0.1',port:4318,strictPort:true}});
await server.listen();
let browser;
try {
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',e=>console.log('Renderer:',e.message));
  await page.goto('http://127.0.0.1:4318/lattice-export');
  await page.exposeFunction('reportProgress',p=>console.log(`Final render ${p.percentage.toFixed(1)}% (${p.renderFps?.toFixed(0)||'?'} fps)`));
  const result=await page.evaluate(async({editor,samples,agentSamples,captions,trackStart,trackEnd,end,layout})=>{
    const {VideoExporter}=await import('/src/lib/exporter/videoExporter.ts');
    const {FrameRenderer}=await import('/src/lib/exporter/frameRenderer.ts');
    const original=FrameRenderer.prototype.renderFrame;
    const {windowRects,remapWindowPoint}=await import('/window-layout.mjs');
    const originalFocus=Object.fromEntries(editor.zoomRegions.map(r=>[r.id,{...r.focus}]));
    let composition,comp,wallpaper;
    if(layout){
      composition=document.createElement('canvas');composition.width=3840;composition.height=2160;comp=composition.getContext('2d');
      wallpaper=new Image();wallpaper.src='/lattice-wallpaper.jpg';await wallpaper.decode();
    }
    const clamp=v=>Math.max(0,Math.min(1,v));
    const ease=v=>1-Math.pow(1-clamp(v),3);
    const caret=agentSamples.filter(p=>p.side===0&&p.timeMs>=trackStart-1500&&p.timeMs<=trackEnd+1500).sort((a,b)=>a.timeMs-b.timeMs);
    let caretIndex=0,last=-10;
    const proofs=new Set();
    FrameRenderer.prototype.renderFrame=async function(...args){
      const t=args[1]/1000;
      let compositeFrame;
      if(layout){
        const {rects,front}=windowRects(layout,t);
        comp.save();comp.scale(1.5,1.5);
        const ratio=Math.max(2560/wallpaper.width,1440/wallpaper.height);
        comp.drawImage(wallpaper,(2560-wallpaper.width*ratio)/2,(1440-wallpaper.height*ratio)/2,wallpaper.width*ratio,wallpaper.height*ratio);
        comp.fillStyle='rgba(7,11,25,.42)';comp.fillRect(0,0,2560,1440);
        const order=front===0?[1,0]:[0,1];
        for(const side of order){
          const r=rects[side],base=layout.windows[side];
          comp.save();comp.shadowColor='rgba(0,0,0,.58)';comp.shadowBlur=45;comp.shadowOffsetY=22;
          comp.fillStyle='#202022';comp.beginPath();comp.roundRect(r.x,r.y,r.width,r.height,layout.radius);comp.fill();comp.restore();
          comp.save();comp.beginPath();comp.roundRect(r.x,r.y,r.width,r.height,layout.radius);comp.clip();
          const sourceHeight=Math.round(base.window.height/base.window.width*1824/2)*2;
          comp.drawImage(args[0],base.left*1.5,Math.round(base.top*1.5),1824,sourceHeight,r.x,r.y,r.width,r.height);
          comp.restore();
          comp.strokeStyle='rgba(255,255,255,.16)';comp.lineWidth=1;comp.beginPath();comp.roundRect(r.x+.5,r.y+.5,r.width-1,r.height-1,layout.radius);comp.stroke();
          comp.fillStyle='#fff';comp.font='600 18px -apple-system, sans-serif';comp.letterSpacing='3px';comp.fillText(side?'NOAH':'MAYA',r.x+6,r.y-20);
        }
        comp.restore();
        compositeFrame=new VideoFrame(composition,{timestamp:args[0].timestamp,duration:args[0].duration||16667});
        args[0]=compositeFrame;
        for(const region of this.config.zoomRegions){
          if(region.id==='agent-caret-tracking')continue;
          const point=remapWindowPoint(layout,originalFocus[region.id],t);
          region.focus={cx:point.cx,cy:point.cy};
        }
      }
      if(t>=trackStart-1000&&t<=trackEnd+1000&&caret.length){
        const caretTime=Math.min(t,trackEnd);
        while(caretIndex<caret.length-2&&caret[caretIndex+1].timeMs<caretTime)caretIndex++;
        const a=caret[caretIndex],b=caret[Math.min(caretIndex+1,caret.length-1)];
        const p=clamp((caretTime-a.timeMs)/Math.max(1,b.timeMs-a.timeMs));
        const region=this.config.zoomRegions.find(r=>r.id==='agent-caret-tracking');
        const focus={cx:a.cx+(b.cx-a.cx)*p+.085,cy:a.cy+(b.cy-a.cy)*p-.035,side:0};
        const mapped=layout?remapWindowPoint(layout,focus,t):focus;
        region.focus={cx:mapped.cx,cy:mapped.cy};
      }
      try {await original.apply(this,args);}finally{compositeFrame?.close();}
      const canvas=this.getCanvas(),ctx=canvas.getContext('2d');
      ctx.save();
      const c=captions.find(c=>t>=c.start&&t<c.end);
      // Quiet footer scrim keeps type legible without an opaque caption box.
      const scrim=ctx.createLinearGradient(0,1000,0,1440);
      scrim.addColorStop(0,'rgba(5,8,18,0)');scrim.addColorStop(.4,'rgba(5,8,18,.65)');scrim.addColorStop(.64,'rgba(5,8,18,.90)');scrim.addColorStop(1,'rgba(5,8,18,.95)');
      ctx.globalAlpha=c?ease((t-c.start)/650)*clamp((c.end-t)/450):0;
      ctx.fillStyle=scrim;ctx.fillRect(0,1000,2560,440);
      ctx.globalAlpha=1;
      if(c){
        const incoming=ease((t-c.start)/650),outgoing=clamp((c.end-t)/450);
        const alpha=incoming*outgoing,y=1266+34*(1-incoming)-14*(1-outgoing);
        ctx.globalAlpha=alpha;ctx.textAlign='center';ctx.textBaseline='alphabetic';
        ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=18;
        ctx.fillStyle='#ffffff';ctx.font='500 19px -apple-system, BlinkMacSystemFont, sans-serif';ctx.letterSpacing='4px';
        ctx.fillText(c.eyebrow,1280,y-66);
        ctx.font='600 54px -apple-system, BlinkMacSystemFont, sans-serif';ctx.letterSpacing='-1.1px';
        ctx.fillText(c.title,1280,y,2290);
        ctx.shadowBlur=0;ctx.fillStyle='#ffffff';ctx.globalAlpha=alpha*.7;
        ctx.fillRect(1280-24*incoming,y+35,48*incoming,2);
      }
      // Fade the entire final frame, including the captions, to true black.
      const fade=clamp((t-(end-1800))/1650);
      if(fade){ctx.globalAlpha=fade;ctx.fillStyle='#000';ctx.fillRect(0,0,2560,1440);}
      ctx.restore();
      const proof=captions.findIndex(c=>t>=c.start+1600&&t<c.start+1700);
      if(proof>=0&&!proofs.has(proof)){
        proofs.add(proof);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
        await fetch(`/proof/${proof}.png`,{method:'PUT',body:blob});
      }
    };
    const exporter=new VideoExporter({...editor,videoUrl:location.origin+'/lattice-source.mp4',width:2560,height:1440,frameRate:60,bitrate:26000000,backendPreference:'webcodecs',maxEncodeQueue:30,cursorTelemetry:samples,
      onProgress:p=>{if(p.percentage>=last+5){last=p.percentage;window.reportProgress(p)}}});
    const result=await exporter.export();
    if(!result.success||!result.blob)throw Error(result.error||'No output');
    await fetch('/lattice-result',{method:'PUT',body:result.blob});
    return {success:true,bytes:result.blob.size,metrics:result.metrics,caretSamples:caret.length,proofs:proofs.size};
  },{editor,samples,agentSamples:capture.agentSamples,captions,trackStart,trackEnd,end,layout});
  await writeFile(join(out,'render-metrics.json'),JSON.stringify(result,null,2));
  const old=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
  await writeFile(join(out,'manifest.json'),JSON.stringify({...old,destination,width:2560,height:1440,frameRate:60,audio:false,renderer:'Recordly FrameRenderer + VideoExporter with kinetic typography finishing',windowLayout:layout,zoomRegions:zoomRegions.length,clicks:clicks.length,captions:captions.length,agentCaretSamples:result.caretSamples,...result},null,2));
  console.log(JSON.stringify({destination,...result}));
}finally{await browser?.close();await server.close();}
