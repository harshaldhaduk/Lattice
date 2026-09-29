import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const exec=promisify(execFile),out=resolve(process.env.RECORDLY_OUTPUT_DIR||'artifacts/demo-final-v2');
const old=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
const file=resolve(process.env.RECORDLY_DESTINATION||old.destination||'artifacts/lattice-final-demo.mp4');
const probe=JSON.parse((await exec('/opt/homebrew/bin/ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_type,width,height,r_frame_rate,nb_frames','-of','json',file])).stdout);
assert.equal(probe.streams.length,old.audio?2:1,'Expected video and optional interaction-sound stream only');
if(old.audio)assert.equal(probe.streams[1].codec_type,'audio');
assert.equal(probe.streams[0].width,2560);assert.equal(probe.streams[0].height,1440);
assert.equal(probe.streams[0].r_frame_rate,'60/1');
const capture=JSON.parse(await readFile(join(out,'capture.json'),'utf8'));
const design=JSON.parse(await readFile(join(out,'motion-design.json'),'utf8'));
const metrics=JSON.parse(await readFile(join(out,'render-metrics.json'),'utf8'));
const noticeHolds={};
const chapters=new Set(capture.chapters.map(c=>c.name));
for(const name of ['teammate-guidance','guidance-approved','maya-token-limit','noah-accepts-handoff','noah-own-prompt','returned-to-dashboard','completed-branch-and-pr','fade-to-black'])assert.ok(chapters.has(name),`Missing ${name}`);
const caret=capture.agentSamples.filter(p=>p.side===0&&p.timeMs>=design.trackStart&&p.timeMs<=design.trackEnd);
assert.ok(caret.length>=15,`Need a sampled caret camera track, got ${caret.length}`);
const range=key=>Math.max(...caret.map(p=>p[key]))-Math.min(...caret.map(p=>p[key]));
assert.ok(range('cx')>.02,'Caret must move horizontally');assert.ok(range('cy')>.015,'Caret must move to another line');
const black=(await exec('/opt/homebrew/bin/ffmpeg',['-v','error','-sseof','-0.05','-i',file,'-frames:v','1','-vf','signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-','-f','null','-'])).stdout;
// Limited-range H.264 black is Y=16; permit one code value of encoder rounding.
const finalLuma=[...black.matchAll(/YMAX=(\d+)/g)].map(m=>Number(m[1]));
assert.ok(finalLuma.length && finalLuma.every(y=>y<=17),'Final frame must be encoded black within one luma code value');
const hash=(await exec('/opt/homebrew/bin/ffmpeg',['-v','error','-ss','6','-i',file,'-t','1','-an','-f','framemd5','-'],{maxBuffer:2*1024*1024})).stdout;
const unique=new Set(hash.split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').at(-1).trim())).size;
assert.ok(unique>=50,`Motion sample has only ${unique} unique frames`);
if(design.layout){
  assert.ok(design.layout.activeWidth/2560>.66&&design.layout.activeWidth/2560<.7);
  assert.ok(design.layout.radius>=20);
  assert.ok(chapters.has('dashboard-panel-closed'));
  const chapterTime=name=>capture.chapters.find(c=>c.name===name)?.time;
  for(const [start,end] of [['maya-token-limit','maya-limit-read-complete'],['noah-handoff-notice','noah-handoff-read-complete']]){
    const hold=chapterTime(end)-chapterTime(start);
    assert.ok(hold>=2&&hold<2.5,`Expected a two-second notice hold, got ${hold.toFixed(2)}s`);
    noticeHolds[start]=hold;
  }
  const project=JSON.parse(await readFile(join(out,'lattice.recordly'),'utf8'));
  const readingStart=chapterTime('maya-token-limit')*1000,readingEnd=chapterTime('noah-handoff-read-complete')*1000;
  assert.ok(project.editor.speedRegions.every(r=>r.endMs<=readingStart||r.startMs>=readingEnd),'Do not speed up notification reading time');
}
if(old.audio){
  assert.ok(old.sound.keys>30&&old.sound.clicks>20);
  const ending=(await exec('/opt/homebrew/bin/ffmpeg',['-v','info','-sseof','-0.5','-i',file,'-vn','-af','volumedetect','-f','null','-'])).stderr;
  assert.match(ending,/max_volume: -(?:[7-9]\d|inf)/,'Ending must be silent after the picture fade');
}
const result={...old,destination:file,duration:Number(probe.format.duration),bytes:Number(probe.format.size),frameCount:Number(probe.streams[0].nb_frames),verified:{silent:!old.audio,interactionAudio:!!old.audio,dimensions:'2560x1440',fps:60,fadeToBlack:true,finalMaxLuma:Math.max(...finalLuma),uniqueMotionFramesPerSecond:unique,caretSamples:caret.length,caretHorizontalRange:range('cx'),caretVerticalRange:range('cy'),captions:design.captions.length,...(design.layout?{activeWindowWidth:design.layout.activeWidth,roundedCorners:design.layout.radius,dashboardPanelClosed:true,noticeHoldSeconds:noticeHolds}:{})},metrics:metrics.metrics};
await writeFile(join(out,'manifest.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({file,duration:result.duration,bytes:result.bytes,...result.verified},null,2));
