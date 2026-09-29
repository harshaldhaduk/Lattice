import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Demo renderer is shared with the browser as native JavaScript.
import {windowRects,remapWindowPoint} from '../scripts/demo/window-layout.mjs';
const windows=[0,1].map(i=>({left:i?1312:32,top:320,scale:1216/1440,window:{width:1440,height:845}}));
const layout={windows,events:[{time:0,side:null},{time:2000,side:0},{time:6000,side:1},{time:10000,side:null}],transitionMs:1000,activeWidth:1740,inactiveWidth:1040};
test('active actor expands to two-thirds, overlaps, and becomes frontmost',()=>{
  const a=windowRects(layout,3500);
  assert.equal(a.front,0);assert.equal(a.rects[0].width,1740);
  assert.ok(a.rects[0].x+a.rects[0].width>a.rects[1].x);
  const b=windowRects(layout,7500);
  assert.equal(b.front,1);assert.equal(b.rects[1].width,1740);
  assert.ok(b.rects[0].x+b.rects[0].width>b.rects[1].x);
});
test('observation restores equal separate windows and transitions remain continuous',()=>{
  const a=windowRects(layout,11500);
  assert.equal(a.front,null);assert.equal(a.rects[0].width,a.rects[1].width);
  assert.ok(a.rects[0].x+a.rects[0].width<a.rects[1].x);
  for(const t of [2000,3000,6000,7000,10000,11000]){
    const a=windowRects(layout,t-.01),b=windowRects(layout,t+.01);
    assert.ok(Math.abs(a.rects[0].width-b.rects[0].width)<.1);
  }
});
test('cursor coordinates follow the active window geometry',()=>{
  const p=remapWindowPoint(layout,{timeMs:3500,side:0,cx:(32+608)/2560,cy:(320+845*1216/1440/2)/1440});
  const r=windowRects(layout,3500).rects[0];
  assert.ok(Math.abs(p.cx-(r.x+r.width/2)/2560)<1e-8);
  assert.ok(Math.abs(p.cy-(r.y+r.height/2)/1440)<1e-8);
});
