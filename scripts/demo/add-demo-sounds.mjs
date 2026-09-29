// Original synthesized foley: restrained mouse taps and soft mechanical keys.
// Exact captured event times are converted through Recordly's speed regions.
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,join} from 'node:path';
const exec=promisify(execFile),out=resolve(process.env.RECORDLY_OUTPUT_DIR||'artifacts/demo-overlap-audio');
const capture=JSON.parse(await readFile(join(out,'capture.json'),'utf8'));
const project=JSON.parse(await readFile(join(out,'lattice.recordly'),'utf8'));
const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
const video=manifest.destination;
const destination=resolve(process.env.RECORDLY_AUDIO_DESTINATION || 'artifacts/lattice-overlap-demo.mp4');
if(video===destination)throw Error('Render the silent master to a separate path before muxing');
const probe=JSON.parse((await exec('/opt/homebrew/bin/ffprobe',['-v','error','-show_entries','format=duration','-of','json',video])).stdout);
const duration=Number(probe.format.duration),rate=48000,count=Math.ceil(duration*rate);
const left=new Float32Array(count),right=new Float32Array(count);
const speedRegions=project.editor.speedRegions;
function outputTime(timeMs){
  const edges=[0,timeMs,...speedRegions.flatMap(r=>[r.startMs,r.endMs]).filter(t=>t>0&&t<timeMs)].sort((a,b)=>a-b);
  let result=0;
  for(let i=1;i<edges.length;i++){
    const middle=(edges[i-1]+edges[i])/2;
    const speed=speedRegions.find(r=>middle>=r.startMs&&middle<r.endMs)?.speed||1;
    result+=(edges[i]-edges[i-1])/speed;
  }
  return result/1000;
}
let seed=6421;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function tap(time,side,kind){
  const start=Math.round(time*rate),click=kind==='click',agent=kind==='agent';
  const length=Math.round(rate*(click?.075:.065));
  const base=(click?930:kind==='space'?225:330)*(0.9+random()*.2);
  const gain=(click?.18:agent?.037:.063)*(0.85+random()*.3);
  const pan=side===0?-.17:.17,l=Math.sqrt((1-pan)/2),r=Math.sqrt((1+pan)/2);
  let low=0,previous=0;
  for(let i=0;i<length&&start+i<count;i++){
    const t=i/rate,noise=random()*2-1;
    low+=.23*(noise-low);
    const high=noise-previous;previous=noise;
    const attack=Math.min(1,t/.001);
    const body=Math.sin(2*Math.PI*base*t)*Math.exp(-t/(click?.009:.015));
    const texture=low*Math.exp(-t/.012)+high*.22*Math.exp(-t/.0028);
    const release=t>.018?Math.sin(2*Math.PI*base*1.8*(t-.018))*.15*Math.exp(-(t-.018)/.006):0;
    const sample=(body*.65+texture*.55+release)*gain*attack;
    left[start+i]+=sample*l;right[start+i]+=sample*r;
  }
}
let clicks=0,keys=0,agentKeys=0,lastKey=-1;
for(const event of capture.samples.filter(p=>p.interactionType==='click')){
  const t=outputTime(event.timeMs);if(t>duration-1.8)continue;
  tap(t,event.cx<.5?0:1,'click');clicks++;
}
for(const event of capture.typingEvents||[]){
  const t=outputTime(event.timeMs);if(t-lastKey<.052||t>duration-1.8)continue;
  tap(t,event.side,event.kind);lastKey=t;keys++;
}
let lastAgent=-1,previousPoint;
const quietStart=(capture.chapters.find(c=>c.name==='maya-token-limit')?.time??Infinity)*1000;
const quietEnd=(capture.chapters.find(c=>c.name==='noah-handoff-read-complete')?.time??-Infinity)*1000;
for(const event of capture.agentSamples||[]){
  if(event.timeMs>=quietStart&&event.timeMs<=quietEnd)continue;
  const t=outputTime(event.timeMs);
  if(t-lastAgent<.095||t>duration-1.8)continue;
  if(previousPoint&&Math.abs(event.cx-previousPoint.cx)+Math.abs(event.cy-previousPoint.cy)<.0008)continue;
  previousPoint=event;lastAgent=t;tap(t,event.side,'agent');agentKeys++;
}
if(keys<30)throw Error('Missing recorded typing events');
const pcm=Buffer.alloc(count*4);let peak=0;
for(let i=0;i<count;i++){
  const fade=Math.min(1,Math.max(0,(duration-i/rate-.1)/1.4));
  for(const [channel,data] of [left,right].entries()){
    const value=Math.max(-.85,Math.min(.85,data[i]*fade));peak=Math.max(peak,Math.abs(value));
    pcm.writeInt16LE(Math.round(value*32767),i*4+channel*2);
  }
}
const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*4,28);header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
const wav=join(out,'interaction-sounds.wav');await writeFile(wav,Buffer.concat([header,pcm]));
await exec('/opt/homebrew/bin/ffmpeg',['-y','-v','error','-i',video,'-i',wav,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','160k','-t',String(duration),'-movflags','+faststart',destination],{timeout:120000});
const sound={clicks,keys,agentKeys,peakDbFS:20*Math.log10(peak),sampleRate:rate,music:false,voiceover:false,originalSynthesis:true};
await writeFile(join(out,'sound-design.json'),JSON.stringify(sound,null,2));
await writeFile(join(out,'manifest.json'),JSON.stringify({...manifest,silentMaster:video,destination,audio:true,sound},null,2));
console.log(JSON.stringify({destination,...sound}));
