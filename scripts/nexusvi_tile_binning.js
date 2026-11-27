// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent CPU rasterizer: opaque rectangles, original generated scenes.
const W=256,H=192,T=16,NX=W/T,NY=H/T,BG=0xff101820;
function check(ok,msg){if(!ok)throw Error(msg);}
function clip(r){return [Math.max(0,r.x),Math.max(0,r.y),Math.min(W,r.x+r.w),Math.min(H,r.y+r.h)];}
function ordered(scene){
  const ids=new Set();
  for(const r of scene){
    for(const k of ['id','x','y','w','h','z','color'])check(Number.isSafeInteger(r[k]),'invalid integer');
    check(!ids.has(r.id)&&r.w>0&&r.h>0&&r.w<=4096&&r.h<=4096&&Math.abs(r.x)<=4096&&Math.abs(r.y)<=4096&&r.color>=0&&r.color<=0xffffffff,'invalid rectangle');
    ids.add(r.id);
  }
  return [...scene].sort((a,b)=>a.z-b.z||a.id-b.id);
}
function reference(scene){
  const out=new Uint32Array(W*H);out.fill(BG);
  for(const r of ordered(scene)){
    const [l,t,u,b]=clip(r);
    for(let y=t;y<b;y++)for(let x=l;x<u;x++)out[y*W+x]=r.color;
  }
  return out;
}
function draw(scene,indexed){
  const layers=ordered(scene),out=new Uint32Array(W*H);out.fill(BG);
  const bins=indexed?Array.from({length:NX*NY},()=>[]):null;
  let buildChecks=0,entries=0,checks=0,paint=0;
  if(indexed)for(const r of layers){
    buildChecks++;
    const [l,t,u,b]=clip(r);
    if(l>=u||t>=b)continue;
    for(let y=Math.floor(t/T);y<=Math.floor((b-1)/T);y++)
      for(let x=Math.floor(l/T);x<=Math.floor((u-1)/T);x++){bins[y*NX+x].push(r);entries++;}
  }
  for(let ty=0;ty<NY;ty++)for(let tx=0;tx<NX;tx++){
    const candidates=indexed?bins[ty*NX+tx]:layers;
    for(const r of candidates){
      checks++;
      const l=Math.max(tx*T,r.x),u=Math.min((tx+1)*T,r.x+r.w),t=Math.max(ty*T,r.y),b=Math.min((ty+1)*T,r.y+r.h);
      if(l>=u||t>=b)continue;
      for(let y=t;y<b;y++)out.fill(r.color,y*W+l,y*W+u);
      paint+=(u-l)*(b-t);
    }
  }
  return {out,checks,buildChecks,entries,paint};
}
function verify(scene){
  const a=draw(scene,false),b=draw(scene,true),ref=reference(scene);
  for(let i=0;i<ref.length;i++)check(a.out[i]===ref[i]&&b.out[i]===ref[i],'pixel mismatch '+i);
  check(a.paint===b.paint&&b.checks===b.entries&&a.checks===scene.length*NX*NY,'counter mismatch');
  return [a,b];
}
function rect(id,x,y,w,h,z,color){return{id,x,y,w,h,z,color};}
function tests(){
  check(verify([])[1].entries===0,'empty');
  check(verify([rect(0,0,0,16,16,0,1)])[1].entries===1,'tile boundary');
  check(verify([rect(0,15,15,2,2,0,1)])[1].entries===4,'four tiles');
  check(verify([rect(0,-15,-15,16,16,0,1)])[1].entries===1,'negative clipping');
  check(verify([rect(0,256,0,16,16,0,1)])[1].entries===0,'offscreen');
  check(verify([rect(0,-1,-1,258,194,0,1)])[1].entries===NX*NY,'full screen');
  const a=rect(1,1,1,20,20,2,1),b=rect(2,1,1,20,20,2,2);
  const q=verify([b,a])[1];check(q.out[W+1]===2,'tie order');
  let rejected=false;try{draw([a,a],true);}catch{rejected=true;}check(rejected,'duplicate');
  rejected=false;try{draw([{...a,w:0}],false);}catch{rejected=true;}check(rejected,'invalid size');
  return 9;
}
function rng(seed){let s=seed>>>0;return n=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return Math.floor(s/4294967296*n);};}
function experiment(){
  const results=[];
  for(const profile of ['small','mixed','offscreen','fullscreen']){
    let frames=0,linearChecks=0,indexedChecks=0,buildChecks=0,entries=0,paint=0,peakEntries=0;
    for(const seed of [42,104729,130363]) {
      const rnd=rng(seed);
      for(let frame=0;frame<12;frame++){
        const scene=Array.from({length:96},(_,i)=>{
          let x=rnd(W+48)-24,y=rnd(H+48)-24,w=4+rnd(24),h=4+rnd(24);
          if(profile==='mixed'&&i%4===0){w=40+rnd(160);h=40+rnd(128);}
          if(profile==='offscreen'&&i%3!==0)x+=W+48;
          if(profile==='fullscreen'){x=0;y=0;w=W;h=H;}
          return rect(i,x,y,w,h,rnd(8),(0xff000000+rnd(0x1000000))>>>0);
        });
        const [a,b]=verify(scene);frames++;linearChecks+=a.checks;indexedChecks+=b.checks;
        buildChecks+=b.buildChecks;entries+=b.entries;paint+=b.paint;peakEntries=Math.max(peakEntries,b.entries);
      }
    }
    results.push({profile,frames,linearChecks,indexedChecks,buildChecks,entries,paint,peakEntries});
  }return results;
}
if(typeof module!=='undefined'&&require.main===module)console.log(JSON.stringify({scope:'independent_cpu_tile_binning',tests:tests(),results:experiment()},null,2));
if(typeof module!=='undefined')module.exports={tests,experiment};
