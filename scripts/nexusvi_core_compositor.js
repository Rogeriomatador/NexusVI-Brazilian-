// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent CPU compositor, original synthetic opaque rectangle scenes only.
const W=256,H=192,T=16,NX=W/T,NY=H/T,N=NX*NY,BG=0xff101820;
const fields=['x','y','w','h','z','color'];
function check(v,m){if(!v)throw Error(m);}
function prepare(scene){
  check(Array.isArray(scene)&&scene.length<=512,'scene limit');
  const map=new Map();
  for(const r of scene){
    for(const k of ['id',...fields])check(Number.isSafeInteger(r[k]),'invalid integer');
    check(!map.has(r.id)&&r.w>0&&r.h>0&&r.w<=4096&&r.h<=4096&&Math.abs(r.x)<=4096&&Math.abs(r.y)<=4096&&r.color>=0&&r.color<=0xffffffff,'invalid rectangle');
    map.set(r.id,{...r});
  }
  return map;
}
function sorted(map){return [...map.values()].sort((a,b)=>a.z-b.z||a.id-b.id);}
function tiles(r,visit){
  const l=Math.max(0,r.x),t=Math.max(0,r.y),u=Math.min(W,r.x+r.w),b=Math.min(H,r.y+r.h);
  if(l>=u||t>=b)return;
  for(let y=t>>4;y<=((b-1)>>4);y++)for(let x=l>>4;x<=((u-1)>>4);x++)visit(y*NX+x);
}
function paint(out,r,l,t,u,b){
  l=Math.max(l,r.x);t=Math.max(t,r.y);u=Math.min(u,r.x+r.w);b=Math.min(b,r.y+r.h);
  if(l>=u||t>=b)return;
  for(let y=t;y<b;y++)out.fill(r.color,y*W+l,y*W+u);
}
function full(out,layers){out.fill(BG);for(const r of layers)paint(out,r,0,0,W,H);}
class Core{
  constructor(mode='adaptive'){
    check(['full','dirty','adaptive'].includes(mode),'mode');
    this.mode=mode;this.pixels=new Uint32Array(W*H);this.pixels.fill(BG);this.previous=new Map();
  }
  render(scene){
    const now=prepare(scene);
    if(this.mode==='full'){full(this.pixels,sorted(now));return 'full';}
    const dirty=new Uint8Array(N);let count=0;
    const mark=r=>tiles(r,k=>{if(!dirty[k]){dirty[k]=1;count++;}});
    for(const [id,old] of this.previous){
      const r=now.get(id);
      if(!r||fields.some(k=>r[k]!==old[k])){mark(old);if(r)mark(r);}
    }
    for(const [id,r] of now)if(!this.previous.has(id))mark(r);
    let path='skip';
    if(count){
      const layers=sorted(now);
      if(this.mode==='adaptive'&&count>=N/2){full(this.pixels,layers);path='full';}
      else{
        path=this.mode==='dirty'?'dirty':'binned';
        const bins=this.mode==='adaptive'?Array.from({length:N},()=>[]):null;
        if(bins)for(const r of layers)tiles(r,k=>{if(dirty[k])bins[k].push(r);});
        for(let k=0;k<N;k++)if(dirty[k]){
          const l=k%NX*T,t=Math.floor(k/NX)*T,u=l+T,b=t+T;
          for(let y=t;y<b;y++)this.pixels.fill(BG,y*W+l,y*W+u);
          for(const r of bins?bins[k]:layers)paint(this.pixels,r,l,t,u,b);
        }
      }
    }
    this.previous=now;return path;
  }
}
// Independent pixel-major oracle; no tile traversal or fill implementation.
function oracle(scene){
  const layers=[...scene].sort((a,b)=>a.z-b.z||a.id-b.id),out=new Uint32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    let c=BG;for(const r of layers)if(x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h)c=r.color;
    out[y*W+x]=c;
  }return out;
}
function same(a,b){for(let i=0;i<a.length;i++)check(a[i]===b[i],'pixel mismatch '+i);}
function rng(seed){let s=seed>>>0;return n=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return Math.floor(s/4294967296*n);};}
function trace(profile,seed){
  const r=rng(seed);let a=Array.from({length:32},(_,id)=>({id,x:r(W+32)-16,y:r(H+32)-16,w:8+r(42),h:8+r(42),z:r(8),color:(0xff000000+r(0x1000000))>>>0}));
  const frames=[];
  for(let i=0;i<48;i++){
    if(i&&profile==='local'){const k=i%a.length;a[k]={...a[k],x:a[k].x+3,y:a[k].y-2};}
    if(i&&profile==='scroll')a=a.map(q=>({...q,x:q.x-2,y:q.y+1}));
    if(profile==='dense')a=a.map(q=>({...q,x:0,y:0,w:W,h:H,color:(q.color^(i&1))>>>0}));
    if(i&&profile==='churn'){const k=r(a.length);a[k]={...a[k],x:r(W+32)-16,y:r(H+32)-16,z:r(8),color:(0xff000000+r(0x1000000))>>>0};}
    frames.push(profile==='churn'?a.filter(q=>(q.id+i)%7!==0):[...a]);
  }return frames;
}
const modes=['full','dirty','adaptive'];
function verify(){
  let frames=0,comparisons=0;const paths={skip:0,binned:0,full:0};
  for(const profile of ['static','local','scroll','churn','dense'])for(const seed of [42,104729,130363]){
    const cores=modes.map(m=>new Core(m));
    for(const scene of trace(profile,seed)){
      const expected=oracle(scene);
      for(const core of cores){const path=core.render(scene);same(core.pixels,expected);comparisons+=W*H;if(core.mode==='adaptive')paths[path]++;}
      frames++;
    }
  }
  const c=new Core(),a={id:1,x:15,y:15,w:2,h:2,z:0,color:1},b={...a,id:2,color:2};
  for(const scene of [[],[a,b],[b,a],[a,{...b,z:-1}],[a,{...b,x:-8,y:0}],[],[a],[{...a,color:4}]]){
    c.render(scene);same(c.pixels,oracle(scene));comparisons+=W*H;
  }
  let rejected=false;try{c.render([a,a]);}catch{rejected=true;}check(rejected,'duplicate');
  c.render([{...a,color:4}]);same(c.pixels,oracle([{...a,color:4}]));comparisons+=W*H;
  check(paths.skip>0&&paths.binned>0&&paths.full>0,'missing adaptive path');
  return {frames,comparisons,paths,crafted:9};
}
const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
function median(a){const s=[...a].sort((x,y)=>x-y);return (s[(s.length-1)>>1]+s[s.length>>1])/2;}
function bench(clock,clockName,rounds=12){
  check(rounds>=6&&rounds%6===0,'balanced rounds');
  const results=[];
  for(const profile of ['static','local','scroll','churn','dense']){
    const traces=[42,104729,130363].map(s=>trace(profile,s));
    const final=traces.map(t=>oracle(t[t.length-1]));
    function replay(mode){
      const outputs=[];const start=clock();
      for(const t of traces){const c=new Core(mode);for(const scene of t)c.render(scene);outputs.push(c.pixels);}
      const elapsed=clock()-start;check(Number.isFinite(elapsed)&&elapsed>=0,'invalid clock');
      outputs.forEach((o,i)=>same(o,final[i]));return elapsed;
    }
    for(const mode of modes)replay(mode);
    const samples=Object.fromEntries(modes.map(m=>[m,[]]));
    for(let r=0;r<rounds;r++)for(const i of orders[r%6])samples[modes[i]].push(replay(modes[i]));
    results.push({profile,framesPerSample:144,samplesMs:samples,medianMs:Object.fromEntries(modes.map(m=>[m,median(samples[m])]))});
  }return {clock:clockName,rounds,results};
}
if(typeof module!=='undefined'&&require.main===module){
  const verification=verify(),timing=bench(()=>Number(process.hrtime.bigint())/1e6,'node_monotonic_hrtime_ms');
  console.log(JSON.stringify({scope:'independent_cpu_opaque_compositor',verification,timing},null,2));
}
if(typeof module!=='undefined')module.exports={verify,bench,Core};
