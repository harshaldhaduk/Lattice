// Measure the visible pink agent caret/badge in native video at 20 Hz. This
// avoids webview suspension gaps in DOM telemetry; it does not alter footage.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const exec=promisify(execFile),out=resolve(process.env.RECORDLY_OUTPUT_DIR||'artifacts/demo-final-v2');
const file=join(out,'capture.json'),c=JSON.parse(await readFile(file,'utf8'));
const times=Object.fromEntries(c.chapters.map(x=>[x.name,x.time*1000]));
const follow=c.samples.filter(p=>p.interactionType==='click'&&p.cx>.5&&p.timeMs>times['maya-auto-follows-own-agent']&&p.timeMs<times['follow-live-edits']).at(-1);
if(!follow)throw Error('Missing actual teammate Follow click');
const start=follow.timeMs+2200,end=Math.min(start+4900,times['cursor-tracking-end']);
const rec=c.recorders[0],w=c.windows[0],width=530,height=285,fps=20;
const {stdout}=await exec('/opt/homebrew/bin/ffmpeg',['-v','error','-ss',String(start/1000+rec.offset),'-i',rec.file,'-t',String((end-start)/1000),'-vf',`scale=720:-2,crop=${width}:${height}:28:103,fps=${fps}`,'-pix_fmt','rgb24','-f','rawvideo','-'],{encoding:'buffer',maxBuffer:160*1024*1024,timeout:120000});
const frameBytes=width*height*3,points=[];
for(let frame=0;frame<Math.floor(stdout.length/frameBytes);frame++){
  const base=frame*frameBytes;let minX=width,minY=height,total=0;
  for(let y=0;y<height;y++){
    let count=0,rowMin=width;
    for(let x=0;x<width;x++){
      const at=base+(y*width+x)*3,r=stdout[at],g=stdout[at+1],b=stdout[at+2];
      if(r>185&&g<145&&b>110&&b<200&&r>g*1.55&&b>g*1.12){count++;rowMin=Math.min(rowMin,x);}
    }
    if(count>=9){total+=count;minX=Math.min(minX,rowMin);minY=Math.min(minY,y);}
  }
  if(total<45)continue;
  const x=(minX+28)*2-4,y=(minY+103)*2+31;
  points.push({timeMs:start+frame*1000/fps,side:0,cx:(w.left+x*w.scale)/2560,cy:(w.top+y*w.scale)/1440,measurement:'native-video-color-track'});
}
if(points.length<30)throw Error(`Only ${points.length} visible caret measurements`);
c.domAgentSamples=c.domAgentSamples||c.agentSamples;
c.agentSamples=[...c.domAgentSamples.filter(p=>p.timeMs<start||p.timeMs>end),...points].sort((a,b)=>a.timeMs-b.timeMs);
c.cameraTrack={start,end,samples:points.length,method:'Native video badge/caret color measurement at 20 Hz'};
await writeFile(file,JSON.stringify(c,null,2));
console.log(JSON.stringify(c.cameraTrack));
