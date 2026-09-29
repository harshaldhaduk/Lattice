// Recorded physical mouse/keyboard foley; no generated tones or fake AI keys.
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,join} from 'node:path';
const exec=promisify(execFile),out=resolve(process.env.RECORDLY_OUTPUT_DIR||'artifacts/demo-animations-v0511');
const preview=process.argv.includes('--preview'),rate=48000;
const assets=resolve('artifacts/demo-sounds');
async function decode(file,typing=false){
  const filter='highpass=f=110,lowpass=f=10500'+(typing?',acompressor=threshold=0.008:ratio=6:attack=0.1:release=35:makeup=4':'');
  const {stdout}=await exec('/opt/homebrew/bin/ffmpeg',['-v','error','-i',file,'-af',filter,'-ar',String(rate),'-ac','1','-f','f32le','-'],{encoding:'buffer',maxBuffer:16*1024*1024});
  const data=new Float32Array(stdout.length/4);
  for(let i=0;i<data.length;i++)data[i]=stdout.readFloatLE(i*4);
  return data;
}
function prepare(data,targetPeak){
  let peak=0;for(const v of data)peak=Math.max(peak,Math.abs(v));
  let start=0,end=data.length;
  while(start<end&&Math.abs(data[start])<peak*.015)start++;
  while(end>start&&Math.abs(data[end-1])<peak*.005)end--;
  const trimmed=data.slice(Math.max(0,start-240),Math.min(data.length,end+480));
  for(let i=0;i<trimmed.length;i++)trimmed[i]*=targetPeak/peak;
  return trimmed;
}
const mouse=prepare(await decode(join(assets,'magic-mouse.wav')),.25);
const keyboard=prepare(await decode(join(assets,'imac-keyboard.wav'),true),.32);
let duration=10,manifest,capture,project,silentMaster;
if(!preview){
  manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
  silentMaster=resolve(manifest.silentMaster||manifest.destination);
  capture=JSON.parse(await readFile(join(out,'capture.json'),'utf8'));
  project=JSON.parse(await readFile(join(out,'lattice.recordly'),'utf8'));
  duration=Number(JSON.parse((await exec('/opt/homebrew/bin/ffprobe',['-v','error','-show_entries','format=duration','-of','json',silentMaster])).stdout).format.duration);
}
const count=Math.ceil(duration*rate),left=new Float32Array(count),right=new Float32Array(count);
function mix(data,time,side,gain=1,offset=0,length=data.length){
  const start=Math.round(time*rate),pan=side===0?-.08:.08;
  for(let i=0;i<length&&start+i<count;i++){
    if(start+i<0)continue;
    const edge=Math.min(1,i/96,(length-i)/480);
    const value=data[(offset+i)%data.length]*edge*gain;
    left[start+i]+=value*Math.sqrt((1-pan)/2);
    right[start+i]+=value*Math.sqrt((1+pan)/2);
  }
}
const outputTime=timeMs=>{
  const regions=project.editor.speedRegions;
  const edges=[0,timeMs,...regions.flatMap(r=>[r.startMs,r.endMs]).filter(t=>t>0&&t<timeMs)].sort((a,b)=>a-b);
  let result=0;for(let i=1;i<edges.length;i++){
    const middle=(edges[i-1]+edges[i])/2;
    const ms=(edges[i]-edges[i-1])/(regions.find(r=>middle>=r.startMs&&middle<r.endMs)?.speed||1);
    // Recordly rounds each completed speed segment up to a whole output frame.
    // Match that rounding so clicks do not drift ahead near the end of the edit.
    result+=i<edges.length-1?Math.ceil(ms/1000*project.editor.mp4FrameRate)/project.editor.mp4FrameRate*1000:ms;
  }return result/1000;
};
let clicks=0,keys=0,typingBursts=[];
if(preview){
  for(const time of [.5,1.6,7.5,8.5])mix(mouse,time,0);
  mix(keyboard,2.5,1,1,Math.round(2.2*rate),Math.round(3.8*rate));
}else{
  for(const e of capture.samples.filter(e=>e.interactionType==='click')){
    const time=outputTime(e.timeMs);if(time>duration-1.8)continue;
    mix(mouse,time,e.cx<.5?0:1,1+(clicks%3-1)*.025);clicks++;
  }
  for(const e of capture.typingEvents){
    const time=outputTime(e.timeMs);if(time>duration-1.8)continue;
    const previous=typingBursts.at(-1);
    if(previous&&previous.side===e.side&&time-previous.last<.32){previous.last=time;previous.keys++;}
    else typingBursts.push({start:time,last:time,side:e.side,keys:1});
    keys++;
  }
  typingBursts.forEach((burst,index)=>{
    const length=Math.round((burst.last-burst.start+.1)*rate);
    const offset=Math.round((1.5+index*4.1)*rate)%Math.max(1,keyboard.length-length);
    mix(keyboard,burst.start,burst.side,1,offset,length);
  });
}
const pcm=Buffer.alloc(count*4);let peak=0;
for(let i=0;i<count;i++)for(const [channel,data]of[left,right].entries()){
  const fade=Math.min(1,Math.max(0,(duration-i/rate-.1)/1.4));
  const value=data[i]*fade;peak=Math.max(peak,Math.abs(value));
  if(Math.abs(value)>.95)throw Error('Audio exceeds safe headroom');
  pcm.writeInt16LE(Math.round(value*32767),i*4+channel*2);
}
const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*4,28);header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
const wav=join(out,preview?'recorded-sound-preview.wav':'recorded-interaction-sounds.wav');
await writeFile(wav,Buffer.concat([header,pcm]));
if(preview){console.log(JSON.stringify({preview:wav,peakDbFS:20*Math.log10(peak)}));process.exit(0);}
const destination=resolve(process.env.RECORDLY_AUDIO_DESTINATION||'artifacts/lattice-animations-demo.mp4');
if(destination===silentMaster)throw Error('Preserve the silent master');
await exec('/opt/homebrew/bin/ffmpeg',['-y','-v','error','-i',silentMaster,'-i',wav,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(duration),'-movflags','+faststart',destination],{timeout:120000});
const sound={clicks,keys,typingBursts:typingBursts.length,agentKeys:0,peakDbFS:20*Math.log10(peak),sampleRate:rate,music:false,voiceover:false,originalSynthesis:false,method:'Recorded Magic Mouse clicks and iMac keyboard bursts, timed to real user input',sources:[{author:'Joseph SARDIN',license:'CC0',url:'https://bigsoundbank.com/apple-magic-mouse-simple-clic-s1742.html'},{author:'Joseph SARDIN',license:'CC0',url:'https://bigsoundbank.com/clavier-imac-rapide-s1731.html'}]};
await writeFile(join(out,'sound-design.json'),JSON.stringify({...sound,typingBursts},null,2));
await writeFile(join(out,'manifest.json'),JSON.stringify({...manifest,silentMaster,destination,audio:true,sound},null,2));
console.log(JSON.stringify({destination,...sound}));
