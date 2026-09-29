// Timeline-driven window hierarchy, in the 2560 × 1440 composition space.
export function createWindowLayout(capture) {
  const times = Object.fromEntries(capture.chapters.map(c => [c.name, c.time * 1000]));
  const clicks = capture.samples.filter(p => p.interactionType === 'click');
  const trackStart = capture.cameraTrack?.start || times['cursor-tracking-start'];
  const trackEnd = capture.cameraTrack?.end || times['cursor-tracking-end'];
  const firstAfter = (t, side) => clicks.find(c => c.timeMs > t && (c.cx < .5 ? 0 : 1) === side)?.timeMs;
  const events = [
    {time:0,side:null},
    {time:2700,side:0},
    {time:times['invite-teammate']+100,side:1},
    {time:times['teleported-codebase']-600,side:null},
    {time:times['existing-provider-accounts']+400,side:0},
    {time:firstAfter(times['maya-auto-follows-own-agent'],1)-2300,side:1},
    {time:times['follow-live-edits']+100,side:null},
    {time:trackStart-1400,side:0},
    {time:trackEnd+500,side:null},
    {time:times['cursor-tracking-end']+100,side:1},
    {time:times['teammate-guidance']+100,side:0},
    {time:times['guidance-approved']+1600,side:null},
    {time:times['finished-live-change']+200,side:0},
    {time:times['noah-handoff-notice'] ?? firstAfter(times['maya-token-limit'],1)-2100,side:1},
    {time:firstAfter(times['noah-accepts-handoff'],0)-1700,side:0},
    {time:times['maya-follows-noah']+1200,side:null},
    {time:firstAfter(times['maya-follows-noah']+3000,1)-2300,side:1},
    {time:times['noah-own-prompt']+1600,side:null},
    {time:times['both-people-contributed']+100,side:0},
    {time:firstAfter(times['completed-branch-and-pr'],1)-2200,side:1},
    {time:times['session-hover-start']-1000,side:0},
    {time:times['pr-ready-for-review']-500,side:null},
  ].filter(e=>Number.isFinite(e.time)).sort((a,b)=>a.time-b.time);
  return {events,windows:capture.windows,transitionMs:1000,activeWidth:1740,inactiveWidth:1040,radius:24};
}

export function windowRects(layout,time) {
  const pose = side => layout.windows.map((w,i) => {
    const width = side === null ? 1216 : i === side ? layout.activeWidth : layout.inactiveWidth;
    const height = width * w.window.height / w.window.width;
    const x = side === null ? (i ? 1312 : 32) : i === side ? (i ? 756 : 64) : (i ? 1472 : 48);
    const y = side === null ? (1440-height)/2-40 : i === side ? 125 : 385;
    return {x,y,width,height};
  });
  let rects=pose(null),front=null;
  for(const event of layout.events) {
    if(time<event.time)break;
    const previous=rects,target=pose(event.side);
    let u=Math.max(0,Math.min(1,(time-event.time)/layout.transitionMs));
    u=u*u*u*(u*(u*6-15)+10);
    rects=target.map((r,i)=>Object.fromEntries(Object.keys(r).map(k=>[k,previous[i][k]+(r[k]-previous[i][k])*u])));
    if(u>.08)front=event.side;
    if(time<event.time+layout.transitionMs)break;
  }
  return {rects,front};
}

export function remapWindowPoint(layout,point,time=point.timeMs) {
  const side=point.side ?? (point.cx<.5?0:1),base=layout.windows[side];
  const {rects}=windowRects(layout,time),rect=rects[side];
  const u=(point.cx*2560-base.left)/1216;
  const v=(point.cy*1440-base.top)/(base.window.height*base.scale);
  return {...point,cx:(rect.x+u*rect.width)/2560,cy:(rect.y+v*rect.height)/1440};
}
