// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent CPU-only opaque compositor. No external assets.
const {Core,trace,oracle,same}=require('./nexusvi_core_compositor.js');
const W=256,H=192,BG=0xff101820,MAX=512;
function check(v,m){if(!v)throw Error(m);}
function validate(r){
  check(Number.isSafeInteger(r.id)&&Number.isSafeInteger(r.x)&&Number.isSafeInteger(r.y)&&Number.isSafeInteger(r.w)&&Number.isSafeInteger(r.h)&&Number.isSafeInteger(r.z)&&Number.isSafeInteger(r.color),'invalid integer');
  check(r.w>0&&r.h>0&&r.w<=4096&&r.h<=4096&&Math.abs(r.x)<=4096&&Math.abs(r.y)<=4096&&r.color>=0&&r.color<=0xffffffff,'invalid rectangle');
}
function equal(a,b){return a&&a.x===b.x&&a.y===b.y&&a.w===b.w&&a.h===b.h&&a.z===b.z&&a.color===b.color;}
function copy(r){return {id:r.id,x:r.x,y:r.y,w:r.w,h:r.h,z:r.z,color:r.color};}
class CoreV2{
  constructor(){
    this.pixels=new Uint32Array(W*H);this.pixels.fill(BG);
    this.previous=new Map();this.scratch=new Map();this.layers=[];
  }
  render(scene){
    check(Array.isArray(scene)&&scene.length<=MAX,'scene limit');
    const scratch=this.scratch;scratch.clear();let changed=scene.length!==this.previous.size;
    // Validate everything before touching the framebuffer or previous snapshot.
    for(const r of scene){
      validate(r);check(!scratch.has(r.id),'duplicate');
      const old=this.previous.get(r.id),unchanged=equal(old,r);
      scratch.set(r.id,unchanged?old:copy(r));if(!unchanged)changed=true;
    }
    if(!changed){scratch.clear();return 'skip';}
    const layers=this.layers;layers.length=0;
    for(const r of scratch.values())layers.push(r);
    layers.sort((a,b)=>a.z-b.z||a.id-b.id);
    // The highest opaque rectangle covering the entire output makes all
    // lower layers invisible. Do not apply this to translucent primitives.
    let first=0,background=BG,occluded=false;
    for(let i=layers.length-1;i>=0;i--){
      const r=layers[i];
      if(r.x<=0&&r.y<=0&&r.x+r.w>=W&&r.y+r.h>=H){
        background=r.color;first=i+1;occluded=true;break;
      }
    }
    this.pixels.fill(background);
    for(let i=first;i<layers.length;i++){
      const r=layers[i],l=Math.max(0,r.x),t=Math.max(0,r.y),u=Math.min(W,r.x+r.w),b=Math.min(H,r.y+r.h);
      if(l>=u||t>=b)continue;
      for(let y=t;y<b;y++)this.pixels.fill(r.color,y*W+l,y*W+u);
    }
    this.scratch=this.previous;this.previous=scratch;this.scratch.clear();
    return occluded?'occluded':'full';
  }
}
function rect(id,x,y,w,h,z,color){return{id,x,y,w,h,z,color};}
function special(seed){
  const base=trace('local',seed);
  // Insert a covering layer below the highest layer, with alternating
  // removal and partial coverage, to test revealing formerly hidden content.
  return base.map((scene,i)=>[...scene,{id:1000,x:0,y:0,w:i%3===0?W-1:W,h:H,z:5,color:0xff321234}].filter(r=>r.id!==1000||i%5!==0));
}
const profiles=['static','local','scroll','churn','dense','cover'];
const seeds=[42,104729,130363],holdout=[32452843,49979687];
function frames(profile,seed){return profile==='cover'?special(seed):trace(profile,seed);}
function verify(){
  let n=0,pixels=0;const paths={skip:0,full:0,occluded:0};
  for(const profile of profiles)for(const seed of [...seeds,...holdout]){
    const c=new CoreV2();
    for(const scene of frames(profile,seed)){paths[c.render(scene)]++;same(c.pixels,oracle(scene));n++;pixels+=W*H;}
  }
  const c=new CoreV2(),a=rect(1,-1,-1,W+2,H+2,1,10),b=rect(2,0,0,16,16,2,20),q=rect(3,8,8,3,3,0,30);
  for(const s of [[q,a,b],[b,a,q],[b,q],[{...a,w:W},b,q],[],[a],[b]]){
    c.render(s);same(c.pixels,oracle(s));
  }
  const mutable={...b};c.render([mutable]);mutable.x=20;c.render([mutable]);same(c.pixels,oracle([mutable]));
  let invalid=0;
  for(const s of [[mutable,mutable],[{...mutable,w:0}],[{...mutable,color:-1}]]){
    try{c.render(s);}catch{invalid++;}
    same(c.pixels,oracle([mutable]));
  }
  check(invalid===3&&c.render([mutable])==='skip','transactional rejection');
  check(Object.values(paths).every(v=>v>0),'missing path');
  return {frames:n,pixelComparisons:pixels,paths,craftedSequences:11};
}
const names=['full','v1','v2'],orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
function median(a){const s=[...a].sort((x,y)=>x-y);return(s[(s.length-1)>>1]+s[s.length>>1])/2;}
function bench(clock,clockName,rounds=12){
  check(Number.isInteger(rounds)&&rounds>=6&&rounds%6===0,'balanced rounds');
  const results=[];
  for(const profile of profiles){
    // Include independent seeds in measured replays.
    const traces=[...seeds,...holdout].map(s=>frames(profile,s)),final=traces.map(t=>oracle(t[t.length-1]));
    function replay(i){
      const outputs=[],start=clock();
      for(const t of traces){
        const c=i===2?new CoreV2():new Core(i===0?'full':'adaptive');
        for(const scene of t)c.render(scene);
        outputs.push(c.pixels);
      }
      const elapsed=clock()-start;check(Number.isFinite(elapsed)&&elapsed>=0,'clock');
      outputs.forEach((o,j)=>same(o,final[j]));return elapsed;
    }
    for(let i=0;i<3;i++)replay(i);
    const samplesMs=Object.fromEntries(names.map(n=>[n,[]]));
    for(let k=0;k<rounds;k++)for(const i of orders[k%6])samplesMs[names[i]].push(replay(i));
    results.push({profile,framesPerSample:240,samplesMs,medianMs:Object.fromEntries(names.map(n=>[n,median(samplesMs[n])]))});
  }return {clock:clockName,rounds,results};
}
if(typeof module!=='undefined'&&require.main===module)console.log(JSON.stringify({scope:'independent_cpu_opaque_compositor_v2',verification:verify(),timing:bench(()=>Number(process.hrtime.bigint())/1e6,'node_monotonic_hrtime_ms')},null,2));
if(typeof module!=='undefined')module.exports={CoreV2,verify,bench};
