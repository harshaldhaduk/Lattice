// Check motion in the original app recordings, before any camera or pointer FX.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const exec=promisify(execFile),out=resolve(process.env.RECORDLY_OUTPUT_DIR||'artifacts/demo-animations-v0511');
const capture=JSON.parse(await readFile(join(out,'capture.json'),'utf8'));
const times=Object.fromEntries(capture.chapters.map(c=>[c.name,c.time]));
const clicks=capture.samples.filter(p=>p.interactionType==='click'&&p.cx<.5);
const create=clicks.find(p=>p.timeMs/1000>times['dashboard-panel-closed']);
const slider=clicks.filter(p=>p.timeMs/1000<times['strictness-slider']).at(-1);
assert.ok(create&&slider,'Missing recorded setup clicks');
const scenes=[
  {name:'focus-and-form-entrance',start:create.timeMs/1000,duration:.8},
  {name:'strictness-drag',start:slider.timeMs/1000,duration:.8},
  {name:'session-hover-and-fade',start:times['session-hover-start'],duration:times['session-hover-end']-times['session-hover-start']},
];
const recorder=capture.recorders[0],results=[];
for(const scene of scenes){
  const {stdout}=await exec('/opt/homebrew/bin/ffmpeg',['-v','error','-ss',String(scene.start+recorder.offset),'-i',recorder.file,'-t',String(scene.duration),'-an','-vf','fps=30','-f','framemd5','-'],{maxBuffer:4*1024*1024});
  const hashes=stdout.split('\n').filter(line=>line&&!line.startsWith('#')).map(line=>line.split(',').at(-1).trim());
  const unique=new Set(hashes).size;
  assert.ok(unique>=12,`${scene.name}: only ${unique} changing native frames`);
  results.push({...scene,frames:hashes.length,uniqueFrames:unique});
}
await writeFile(join(out,'native-motion-verification.json'),JSON.stringify({source:'Original native-window video, before camera effects',scenes:results},null,2));
console.log(JSON.stringify(results));
