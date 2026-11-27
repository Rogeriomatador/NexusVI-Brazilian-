// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Original CPU-only synthetic framebuffer experiment. No external assets.
const W=128,H=96,T=16,BG=0xff101820;
function check(ok,msg){if(!ok)throw new Error(msg);}
function ordered(scene){return [...scene].sort((a,b)=>a.z-b.z||a.id-b.id);}
function reference(scene){
  const layers=ordered(scene),out=new Uint32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    let color=BG;
    for(const r of layers)if(x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h)color=r.color;
    out[y*W+x]=color;
  }
  return out;
}
class DirtyFramebuffer{
  constructor(){this.pixels=new Uint32Array(W*H);this.pixels.fill(BG);this.previous=new Map();}
  render(scene){
    const current=new Map(),dirty=new Set();
    for(const r of scene){
      check(Number.isSafeInteger(r.id)&&!current.has(r.id),'duplicate or invalid ID');
      for(const k of ['x','y','w','h','z','color'])check(Number.isSafeInteger(r[k]),'invalid geometry');
      check(r.w>0&&r.h>0&&r.color>=0&&r.color<=0xffffffff&&Math.abs(r.x)<=4096&&Math.abs(r.y)<=4096&&r.w<=4096&&r.h<=4096,'geometry bounds');
      current.set(r.id,{...r});
    }
    function mark(r){
      const x0=Math.max(0,r.x),y0=Math.max(0,r.y),x1=Math.min(W,r.x+r.w),y1=Math.min(H,r.y+r.h);
      if(x0>=x1||y0>=y1)return;
      for(let ty=Math.floor(y0/T);ty<=Math.floor((y1-1)/T);ty++)
        for(let tx=Math.floor(x0/T);tx<=Math.floor((x1-1)/T);tx++)dirty.add(ty*(W/T)+tx);
    }
    const fields=['x','y','w','h','z','color'];
    for(const [id,old] of this.previous){const r=current.get(id);if(!r||fields.some(k=>r[k]!==old[k])){mark(old);if(r)mark(r);}}
    for(const [id,r] of current)if(!this.previous.has(id))mark(r);
    const layers=ordered(current.values());let redrawPixels=0,paintPixels=0;
    for(const key of dirty){
      const x0=key%(W/T)*T,y0=Math.floor(key/(W/T))*T,x1=x0+T,y1=y0+T;
      for(let y=y0;y<y1;y++)this.pixels.fill(BG,y*W+x0,y*W+x1);
      redrawPixels+=T*T;
      for(const r of layers){
        const l=Math.max(x0,r.x),t=Math.max(y0,r.y),right=Math.min(x1,r.x+r.w),bottom=Math.min(y1,r.y+r.h);
        if(l>=right||t>=bottom)continue;
        for(let y=t;y<bottom;y++)this.pixels.fill(r.color,y*W+l,y*W+right);
        paintPixels+=(right-l)*(bottom-t);
      }
    }
    this.previous=current;return {tiles:dirty.size,redrawPixels,paintPixels};
  }
}
function validate(f,scene){
  const stats=f.render(scene),expected=reference(scene);
  for(let i=0;i<expected.length;i++)check(expected[i]===f.pixels[i],'pixel mismatch at '+i);
  check(stats.tiles<=W*H/(T*T)&&stats.redrawPixels===stats.tiles*T*T,'bad coverage');
  return stats;
}
function rect(id,x,y,w,h,z,color){return{id,x,y,w,h,z,color};}
function tests(){
  const f=new DirtyFramebuffer(),a=rect(1,-4,-4,24,24,0,0xff0000ff),b=rect(2,8,8,20,20,1,0xffff0000);
  check(validate(f,[]).tiles===0,'empty');
  check(validate(f,[a,b]).tiles===4,'initial clipped overlap');
  check(validate(f,[b,a]).tiles===0,'input order irrelevant');
  check(validate(f,[a,{...b,z:-1}]).tiles===4,'z change');
  check(validate(f,[a,{...b,x:120,y:88}]).tiles===5,'move across screen');
  check(validate(f,[a]).tiles===1,'remove');
  check(validate(f,[{...a,color:0xff00ff00}]).tiles===4,'recolor');
  check(validate(f,[]).tiles===4,'clear');
  check(validate(f,[rect(5,-60,0,10,10,1,1)]).tiles===0,'offscreen');
  let rejected=false;try{f.render([a,a]);}catch{rejected=true;}check(rejected,'duplicate accepted');
  check(validate(f,[]).tiles===0,'invalid input mutated state');
  const mutable={...a};validate(f,[mutable]);mutable.x=50;validate(f,[mutable]);
  return 12;
}
function random(seed){let s=seed>>>0;return n=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return Math.floor(s/4294967296*n);};}
function experiment(){
  const profiles=['static','localized','scroll','churn'],seeds=[42,104729,130363],results=[];
  for(const profile of profiles){
    let frames=0,redrawPixels=0,paintPixels=0,fullPixels=0;
    for(const seed of seeds){
      const rnd=random(seed),f=new DirtyFramebuffer();
      let base=Array.from({length:18},(_,i)=>rect(i,rnd(W+24)-12,rnd(H+24)-12,8+rnd(36),8+rnd(36),rnd(8), (0xff000000+rnd(0x1000000))>>>0));
      for(let frame=0;frame<60;frame++){
        if(frame>0){
          if(profile==='localized'){const i=frame%base.length;base[i]={...base[i],x:base[i].x+(frame%2?3:-2),y:base[i].y+1};}
          if(profile==='scroll')base=base.map(r=>({...r,x:r.x-3,y:r.y+1}));
          if(profile==='churn'){const i=rnd(base.length),r=base[i];base[i]={...r,x:rnd(W+24)-12,y:rnd(H+24)-12,z:rnd(8),color:(0xff000000+rnd(0x1000000))>>>0};}
        }
        const scene=profile==='churn'?base.filter(r=>(r.id+frame)%7!==0):base;
        const s=validate(f,scene);frames++;redrawPixels+=s.redrawPixels;paintPixels+=s.paintPixels;fullPixels+=W*H;
      }
    }
    results.push({profile,frames,fullPixels,redrawPixels,paintPixels});
  }return results;
}
if(typeof module!=='undefined'&&require.main===module)console.log(JSON.stringify({scope:'cpu_opaque_rectangle_framebuffer',checks:tests(),results:experiment()},null,2));
if(typeof module!=='undefined')module.exports={tests,experiment};
